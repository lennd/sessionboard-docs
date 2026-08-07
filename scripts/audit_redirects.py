#!/usr/bin/env python3
"""
Audit the legacy-URL 301 surface end-to-end.

The article export is not the URL surface: HubSpot omits category pages from its
own sitemap, keeps serving an older `/en/migrated/knowledge-base/` prefix, and
301s some slugs to paths that 404. So URLs are enumerated from several
independent sources and every one is driven through the deployed Worker.

Sources:
  1. Live HubSpot sitemap        — what HubSpot serves today
  2. Google Search Console       — indexed URLs HubSpot omits from its sitemap
                                   (optional; needs GOOGLE_APPLICATION_CREDENTIALS)
  3. redirects-301.csv           — every slug we have ever mapped
  4. In-app links                — grepped from the product repos (optional)

Usage:
  cd sessionboard-docs
  npm run audit:redirects                                   # sitemap + CSV + GSC
  python3 scripts/audit_redirects.py --no-gsc               # skip Search Console
  python3 scripts/audit_redirects.py --base https://sessionboard-docs.sessionboard.workers.dev

Search Console needs `googleapiclient` and a service-account key; both are found
automatically (see `_gsc_interpreter` and `_default_credentials`), so no venv or
env var has to be set by hand.

Exit code is non-zero if any URL fails to reach a live page, so this can gate a
release. URLs that fall through to the generic support page are reported but do
not fail the run — for genuinely deleted articles that is the right destination.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAM = ROOT.parent / "sessionboard-tam"
LIVE_SITEMAP = "https://learn.sessionboard.com/sitemap.xml"
# Where the Worker answers. The legacy `learn` host is a URL *source*, not a base:
# HubSpot still serves it (see the 1034 note in LAUNCH.md), so legacy paths are
# verified against the canonical host, which handles them identically.
DEFAULT_BASE = "https://help.sessionboard.com"
FALLBACK = "/faq/who-can-i-contact-for-additional-assistance"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126"
# Image assets HubSpot serves on this domain. Redirecting an <img> request to an
# HTML page is worse than letting it 404, so these are excluded by design.
ASSET_PREFIXES = ("/hs-fs/", "/hubfs/", "/_hcms/", "/hs/")


def _default_credentials() -> str | None:
    """The GA4/GSC service-account key, wherever it already lives."""
    env = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if env and Path(env).expanduser().exists():
        return str(Path(env).expanduser())
    key = Path.home() / "keys" / "sessionboard-ga4-mcp.json"
    return str(key) if key.exists() else None


def _gsc_interpreter() -> str | None:
    """
    An interpreter that can import googleapiclient. The Search Console deps live
    in the growth-pages venv rather than this repo, so rather than make the
    caller remember that path, find it and re-exec into it.
    """
    candidates = [sys.executable,
                  str(TAM / "growth-pages" / ".venv" / "bin" / "python"),
                  str(TAM / ".venv" / "bin" / "python")]
    for py in candidates:
        if not Path(py).exists():
            continue
        probe = subprocess.run([py, "-c", "import googleapiclient"], capture_output=True)
        if probe.returncode == 0:
            return py
    return None


def curl(url: str, fmt: str = "%{http_code} %{redirect_url}") -> str:
    return subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", fmt, "-A", UA,
         "-H", "Cache-Control: no-cache", "--max-time", "30", url],
        capture_output=True, text=True,
    ).stdout.strip()


def sitemap_paths(url: str) -> set[str]:
    xml = subprocess.run(["curl", "-s", "-A", UA, url], capture_output=True, text=True).stdout
    return {
        loc.split("learn.sessionboard.com", 1)[1]
        for loc in re.findall(r"<loc>(.*?)</loc>", xml)
        if "learn.sessionboard.com" in loc
    }


def csv_paths() -> set[str]:
    with (ROOT / "redirects-301.csv").open() as fh:
        rows = list(csv.DictReader(fh))
    out = set()
    for r in rows:
        u = (r.get("old_url") or "").strip()
        if "learn.sessionboard.com" in u:
            out.add(u.split("learn.sessionboard.com", 1)[1])
    return out


def gsc_paths(days: int = 480) -> set[str]:
    """Pages with search data. Catches URLs absent from HubSpot's sitemap."""
    sys.path.insert(0, str(TAM / "scripts"))
    from googleapiclient.discovery import build  # noqa: E402
    from gsc_submit_sitemap import _load_credentials  # noqa: E402

    svc = build("searchconsole", "v1", credentials=_load_credentials(), cache_discovery=False)
    end = datetime.date.today() - datetime.timedelta(days=2)
    start = end - datetime.timedelta(days=days)
    out, start_row = set(), 0
    while True:
        resp = svc.searchanalytics().query(
            siteUrl="sc-domain:sessionboard.com",
            body={
                "startDate": start.isoformat(), "endDate": end.isoformat(),
                "dimensions": ["page"], "rowLimit": 25000, "startRow": start_row,
                "dimensionFilterGroups": [{"filters": [{
                    "dimension": "page", "operator": "contains",
                    "expression": "learn.sessionboard.com"}]}],
            },
        ).execute()
        rows = resp.get("rows", [])
        out |= {r["keys"][0].split("learn.sessionboard.com", 1)[1] for r in rows}
        if len(rows) < 25000:
            return out
        start_row += 25000


def inapp_paths() -> set[str]:
    dirs = [ROOT.parent / r / "src" for r in
            ("sessionboard-web-api", "sessionboard-web-ui-v2", "sessionboard-web-ui")]
    dirs = [str(d) for d in dirs if d.exists()]
    if not dirs:
        return set()
    res = subprocess.run(
        ["rg", "-o", "--no-heading", "--no-filename",
         r"https?://learn\.sessionboard\.com[^\"'\` <)\\]*", *dirs],
        capture_output=True, text=True,
    )
    return {ln.split("learn.sessionboard.com", 1)[1] or "/"
            for ln in res.stdout.splitlines() if ln.strip()}


def check(base: str, path: str) -> dict:
    sep = "&" if "?" in path else "?"
    out = curl(f"{base}{path}{sep}cb=audit").split(" ", 1)
    code = out[0]
    loc = (out[1] if len(out) > 1 else "").strip().replace(base, "").split("?")[0]
    target_code = curl(base + loc, "%{http_code}") if code == "301" and loc else ""
    return {"path": path, "code": code, "target": loc, "target_code": target_code}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE, help="host serving the Worker")
    ap.add_argument("--sitemap", default=LIVE_SITEMAP)
    ap.add_argument("--no-gsc", dest="gsc", action="store_false",
                    help="skip Search Console (offline / no credentials)")
    ap.add_argument("--workers", type=int, default=10)
    ap.set_defaults(gsc=True)
    args = ap.parse_args()

    if args.gsc and os.environ.get("_AUDIT_REEXEC") != "1":
        py = _gsc_interpreter()
        if py and py != sys.executable:
            env = {**os.environ, "_AUDIT_REEXEC": "1"}
            creds = _default_credentials()
            if creds:
                env["GOOGLE_APPLICATION_CREDENTIALS"] = creds
            return subprocess.run([py, __file__, *sys.argv[1:]], env=env).returncode
        if creds := _default_credentials():
            os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", creds)

    paths = set()
    for label, fn in (
        ("live sitemap", lambda: sitemap_paths(args.sitemap)),
        ("redirects-301.csv", csv_paths),
        ("in-app links", inapp_paths),
    ):
        try:
            found = fn()
            paths |= found
            print(f"  {label:20} {len(found):4} URLs")
        except Exception as exc:  # a missing optional source must not abort the audit
            print(f"  {label:20} skipped ({exc})")

    if args.gsc:
        if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
            print("  Search Console       skipped (no service-account key found)")
        else:
            try:
                found = gsc_paths()
                paths |= found
                print(f"  {'Search Console':20} {len(found):4} URLs")
            except Exception as exc:
                print(f"  {'Search Console':20} skipped ({exc})")

    assets = {p for p in paths if p.startswith(ASSET_PREFIXES)}
    targets = sorted(p for p in paths if p.startswith("/") and p not in assets)
    print(f"\nverifying {len(targets)} URLs against {args.base} "
          f"({len(assets)} HubSpot asset URLs excluded by design)\n")

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(lambda p: check(args.base, p), targets))

    # The contact-support article is itself the fallback target, so an explicit
    # mapping to it is a real mapping rather than a fall-through.
    redirect_map = json.loads((ROOT / "redirects-map.json").read_text())
    explicit = {slug for slug, target in redirect_map.items() if target == FALLBACK}

    def is_fallthrough(r: dict) -> bool:
        if r["target"] != FALLBACK:
            return False
        slug = re.sub(r"^/(?:en/)?(?:migrated/)?knowledge-base/?", "", r["path"].split("?")[0])
        return slug not in explicit and re.sub(r"^\d+-", "", slug) not in {
            re.sub(r"^\d+-", "", s) for s in explicit
        }

    ok = [r for r in results if r["code"] == "301" and r["target_code"] == "200"]
    fallback = [r for r in ok if is_fallthrough(r)]
    failed = [r for r in results if r not in ok]

    print(f"  reach a live page (301 -> 200): {len(ok)}/{len(results)}")
    print(f"  fell through to the fallback:   {len(fallback)}")
    print(f"  FAILED:                         {len(failed)}")

    if fallback:
        print("\nfell through (expected for deleted articles; check none are live):")
        for r in fallback:
            print(f"    {r['path']}")
    if failed:
        print("\nFAILED — these would 404 or loop after cutover:")
        for r in failed:
            print(f"    {r['code']} target={r['target_code'] or '-'}  {r['path']} -> {r['target']}")
        return 1

    print("\nAll legacy URLs resolve to a live page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
