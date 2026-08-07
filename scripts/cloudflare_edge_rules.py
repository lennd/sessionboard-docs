#!/usr/bin/env python3
"""
Manage the Cloudflare edge rules that protect the Help Center from scraping.

WHY THIS EXISTS AS CODE

worker.js already blocks scrapers by name (see BLOCKED_BOTS) and withholds the
bulk exports. That handles the honest crawler that identifies itself. It cannot
touch the one we actually care about: a competitor pointing a headless browser
with a Chrome user-agent at all 239 pages. The Worker has no cross-request
state, so "this IP just read the entire Help Center in ninety seconds" is not a
judgement it can make. Only the edge can, which is what these rules add.

THE HAZARD THAT SHAPES THE DESIGN

The zone is sessionboard.com — the same zone as app. and api. and the marketing
site. Bot protection here is not a docs-local decision:

  * Super Bot Fight Mode is documented as protecting "entire domains without
    endpoint restrictions". It CANNOT be scoped to a hostname. Turning it on
    naively puts it in front of api.sessionboard.com, where "definitely
    automated" is a fair description of every integration we have — Grip,
    Gleanin, SSO callbacks, customer API clients.
  * cf.bot_management.score, which would let us write one tidy scoped rule, is
    an Enterprise-only field. sessionboard.com is on Business, so it does not
    exist for us.

So the shape is forced. WAF custom rules run BEFORE Super Bot Fight Mode and can
skip it, and rate limiting rules take an expression and can be scoped. We use
custom rules to fence SBFM into the docs hosts, and a rate limiting rule that
only ever counts docs traffic. Nothing here can match an app or API request.

ORDER MATTERS. Deploy the skip rule BEFORE enabling Super Bot Fight Mode in the
dashboard. The other order leaves a window where SBFM policies the whole zone,
which is an outage on api. rather than a bad afternoon.

WHAT THIS SCRIPT WILL NOT DO

Enabling Super Bot Fight Mode itself. Cloudflare's own docs: "Updating Super Bot
Fight Mode rules via the Rulesets API is no longer supported and may cause
unexpected behavior if you do so." It is a dashboard toggle, and --check prints
the click path.

USAGE

  python3 scripts/cloudflare_edge_rules.py             # check: scopes + current state + planned diff
  python3 scripts/cloudflare_edge_rules.py --apply     # create/update the rules

  npm run cf:check
  npm run cf:apply

TOKEN

Reads CLOUDFLARE_API_TOKEN. The deploy token in ~/.zshrc is Workers-scoped and
CANNOT do this — it reads the zone and lists rulesets, then gets "request is not
authorized" on rule contents. --check tells you exactly which scope is missing.
A token that works needs, on sessionboard.com:

  Zone > Zone            > Read
  Zone > Firewall Services > Edit    (WAF custom rules + rate limiting rules)

Hosts come from site.json, so a host change does not need an edit here.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.cloudflare.com/client/v4"
ROOT = Path(__file__).resolve().parent.parent
ZONE_NAME = "sessionboard.com"

# Tagged so re-running updates in place instead of stacking duplicates. Rules are
# matched on description, so do not reword these without also renaming deployed rules.
SKIP_RULE_DESC = "[docs] Super Bot Fight Mode applies to the Help Center only"
RATELIMIT_RULE_DESC = "[docs] Throttle page-walking scrapers on the Help Center"

# A human reading docs does not open 45 distinct pages a minute; a scraper walking
# the site does nothing else. Assets are excluded because one page pulls a dozen of
# them and would trip the counter on ordinary browsing. Verified bots (Googlebot,
# Bingbot) are exempt — throttling them would cost exactly the search visibility
# the Help Center exists for.
RATE_REQUESTS = 45
RATE_PERIOD = 60
RATE_TIMEOUT = 3600

# Managed Challenge, not Block. A false positive on a shared corporate NAT is a
# real risk, and a challenge is invisible to a real browser while still being
# fatal to a headless scraper. Blocking outright would mean a customer's whole
# office silently loses the support site.
RATE_ACTION = "managed_challenge"

ASSET_RE = r"\.(css|js|mjs|map|png|jpg|jpeg|gif|svg|webp|avif|ico|woff|woff2|ttf|eot|xml|txt|json)$"


def docs_hosts() -> list[str]:
    site = json.loads((ROOT / "site.json").read_text())
    return [site["canonicalHost"], *site.get("legacyHosts", [])]


def host_set(hosts: list[str]) -> str:
    return "{" + " ".join(f'"{h}"' for h in hosts) + "}"


def api(path: str, token: str, method: str = "GET", body: dict | None = None) -> tuple[bool, dict]:
    req = urllib.request.Request(
        f"{API}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return True, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return False, json.loads(e.read())
        except Exception:
            return False, {"errors": [{"message": f"HTTP {e.code}"}]}
    except Exception as e:  # network, DNS, timeout
        return False, {"errors": [{"message": str(e)}]}


def errmsg(payload: dict) -> str:
    errs = payload.get("errors") or []
    parts = []
    for e in errs:
        m = e.get("message", "")
        for c in e.get("error_chain", []) or []:
            m += f" ({c.get('message')})"
        parts.append(m)
    return "; ".join(parts) or "unknown error"


def rules_for(hosts: list[str]) -> tuple[dict, dict]:
    hs = host_set(hosts)

    skip = {
        "description": SKIP_RULE_DESC,
        # Everything that is NOT the Help Center bypasses SBFM. Written as a
        # negation on purpose: a hostname added to the zone later is protected
        # from SBFM by default, rather than silently opted in.
        "expression": f"not (http.host in {hs})",
        "action": "skip",
        "action_parameters": {"phases": ["http_request_sbfm"]},
        "enabled": True,
    }

    ratelimit = {
        "description": RATELIMIT_RULE_DESC,
        "expression": (
            f"(http.host in {hs}"
            f' and not cf.client.bot'
            f' and not http.request.uri.path matches "{ASSET_RE}")'
        ),
        "action": RATE_ACTION,
        "ratelimit": {
            # cf.colo.id is required alongside ip.src below Enterprise; counting is
            # per-datacenter, so effective global throughput is somewhat higher than
            # RATE_REQUESTS. That is fine — this is a speed bump, not a quota.
            "characteristics": ["ip.src", "cf.colo.id"],
            "period": RATE_PERIOD,
            "requests_per_period": RATE_REQUESTS,
            "mitigation_timeout": RATE_TIMEOUT,
        },
        "enabled": True,
    }
    return skip, ratelimit


def get_zone(token: str) -> str | None:
    ok, d = api(f"/zones?name={ZONE_NAME}", token)
    if not ok or not d.get("success") or not d.get("result"):
        print(f"  ✗ cannot read zone {ZONE_NAME}: {errmsg(d)}")
        return None
    return d["result"][0]["id"]


def get_entrypoint(zone: str, phase: str, token: str) -> tuple[bool, dict | None, str]:
    """Entrypoint ruleset for a phase. 404 just means nothing is configured yet."""
    ok, d = api(f"/zones/{zone}/rulesets/phases/{phase}/entrypoint", token)
    if ok and d.get("success"):
        return True, d["result"], ""
    msg = errmsg(d)
    if "not found" in msg.lower() or "does not exist" in msg.lower():
        return True, None, ""
    return False, None, msg


def upsert(zone: str, phase: str, rule: dict, token: str, apply: bool) -> str:
    ok, existing, msg = get_entrypoint(zone, phase, token)
    if not ok:
        return f"✗ cannot read {phase}: {msg}"

    rules = (existing or {}).get("rules", []) or []
    match = next((r for r in rules if r.get("description") == rule["description"]), None)

    if match:
        same = (
            match.get("expression") == rule["expression"]
            and match.get("action") == rule["action"]
            and match.get("enabled") == rule.get("enabled")
            and match.get("ratelimit", {}) == rule.get("ratelimit", {})
            and match.get("action_parameters", {}) == rule.get("action_parameters", {})
        )
        if same:
            return "= already deployed and identical"
        if not apply:
            return "~ would UPDATE the deployed rule (it has drifted from this spec)"
        ok, d = api(
            f"/zones/{zone}/rulesets/{existing['id']}/rules/{match['id']}",
            token,
            "PATCH",
            rule,
        )
        return "✓ updated" if ok and d.get("success") else f"✗ update failed: {errmsg(d)}"

    if not apply:
        return "+ would CREATE this rule"

    if existing:
        ok, d = api(f"/zones/{zone}/rulesets/{existing['id']}/rules", token, "POST", rule)
    else:
        # No ruleset in this phase yet, so create the entrypoint with the rule in it.
        ok, d = api(
            f"/zones/{zone}/rulesets",
            token,
            "POST",
            {
                "name": f"default ({phase})",
                "kind": "zone",
                "phase": phase,
                "rules": [rule],
            },
        )
    return "✓ created" if ok and d.get("success") else f"✗ create failed: {errmsg(d)}"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="deploy the rules (default is a dry run)")
    args = p.parse_args()

    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        print("CLOUDFLARE_API_TOKEN is not set.")
        return 2

    hosts = docs_hosts()
    print(f"Help Center hosts (from site.json): {', '.join(hosts)}")
    print(f"Mode: {'APPLY' if args.apply else 'check only (no changes)'}\n")

    zone = get_zone(token)
    if not zone:
        return 1
    print(f"zone {ZONE_NAME} = {zone}")

    # Fail loudly and specifically on the common case: the Workers deploy token.
    ok, _, msg = get_entrypoint(zone, "http_request_firewall_custom", token)
    if not ok:
        print(f"\n  ✗ This token cannot read firewall rules: {msg}")
        print("    It is almost certainly the Workers deploy token, which is zone-read only.")
        print("    Create a token with Zone > Firewall Services > Edit on sessionboard.com:")
        print("      https://dash.cloudflare.com/profile/api-tokens")
        return 1

    skip, ratelimit = rules_for(hosts)

    print("\n1. WAF custom rule — fence SBFM into the docs hosts")
    print(f"   {skip['expression']}")
    print(f"   action: skip {skip['action_parameters']['phases']}")
    print(f"   -> {upsert(zone, 'http_request_firewall_custom', skip, token, args.apply)}")

    print(f"\n2. Rate limiting rule — {RATE_REQUESTS} pages/{RATE_PERIOD}s per IP, then {RATE_ACTION} for {RATE_TIMEOUT}s")
    print(f"   {ratelimit['expression']}")
    print(f"   -> {upsert(zone, 'http_ratelimit', ratelimit, token, args.apply)}")

    print("\n3. Super Bot Fight Mode — DASHBOARD ONLY, and only after step 1 is deployed")
    print("   Cloudflare does not support setting this over the API.")
    print("   Security > Settings > filter 'Bot traffic' > Super Bot Fight Mode")
    print("     Definitely automated : Block")
    print("     Likely automated     : Managed Challenge")
    print("     Verified bots        : Allow      <- keeps Googlebot and Bingbot indexing us")
    print("     Static resources     : off        <- assets are public; protecting them only burns CPU")
    if not args.apply:
        print("\nNothing was changed. Re-run with --apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
