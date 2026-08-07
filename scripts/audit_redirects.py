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
  python3 scripts/audit_redirects.py                        # sitemap + CSV
  python3 scripts/audit_redirects.py --gsc                  # + Search Console
  python3 scripts/audit_redirects.py --base https://learn.sessionboard.com

Exit code is non-zero if any URL fails to reach a live page, so this can gate a
release. URLs that land on the generic fallback are reported but do not fail the
run — for genuinely deleted articles that is the correct destination.
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
LIVE_SITEMAP = "https://learn.sessionboard.com/sitemap.xml"
DEFAULT_BASE = "https://sessionboard-docs.sessionboard.workers.dev"
FALLBACK = "/faq/who-can-i-contact-for-additional-assistance"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126"
# Image assets HubSpot serves on this domain. Redirecting an <img> request to an
# HTML page is worse than letting it 404, so these are excluded by design.
ASSET_PREFIXES = ("/hs-fs/", "/hubfs/", "/_hcms/", "/hs/")


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
    sys.path.insert(0, str(ROOT.parent / "sessionboard-tam" / "scripts"))
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
    ap.add_argument("--gsc", action="store_true", help="include Search Console URLs")
    ap.add_argument("--workers", type=int, default=10)
    args = ap.parse_args()

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
            print("  Search Console      skipped (set GOOGLE_APPLICATION_CREDENTIALS)")
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
