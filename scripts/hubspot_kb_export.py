#!/usr/bin/env python3
"""Export every HubSpot knowledge base article to a local archive.

The KB is no longer served on any domain (learn.sessionboard.com was released
from HubSpot during the migration), so the articles are only reachable through
the CMS GraphQL collector. This is the only remaining source for the original
body HTML, screenshots and callouts.

    export HUBSPOT_PRIVATE_APP_TOKEN=...   # from ~/.zshrc
    python3 scripts/hubspot_kb_export.py

Writes to .kb-archive/:
    index.json          metadata for every article, newest export wins
    html/<slug>.html    raw body HTML, images still pointing at the HubSpot CDN

Re-runnable: overwrites the archive in place.
"""
import argparse
import json
import os
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENDPOINT = "https://api.hubapi.com/collector/graphql"

FIELDS = """
  hs_id hs_name hs_slug hs_path hs_absolute_url hs_state hs_language
  hs_summary hs_meta_description hs_body
  hs_published_at hs_updated_at hs_created_at
  hs_knowledge_category_id
"""


def gql(token: str, query: str) -> dict:
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    if "errors" in payload:
        raise SystemExit("GraphQL error: " + json.dumps(payload["errors"])[:500])
    return payload["data"]


def fetch_all(token: str, page: int = 50) -> list[dict]:
    out, offset = [], 0
    while True:
        data = gql(token, "{ KB { knowledge_article_collection(limit: %d, offset: %d) "
                          "{ total items { %s } } } }" % (page, offset, FIELDS))
        coll = data["KB"]["knowledge_article_collection"]
        items = coll["items"]
        out.extend(items)
        print(f"  fetched {len(out)}/{coll['total']}", file=sys.stderr)
        offset += page
        if not items or offset >= coll["total"]:
            return out


def safe_name(article: dict) -> str:
    """Filesystem-safe stem, preferring the trailing segment of the KB slug."""
    slug = (article.get("hs_slug") or "").rstrip("/").rsplit("/", 1)[-1]
    stem = slug or f"article-{article['hs_id']}"
    return re.sub(r"[^A-Za-z0-9._-]+", "-", stem)[:100]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / ".kb-archive"))
    args = ap.parse_args()

    token = os.environ.get("HUBSPOT_PRIVATE_APP_TOKEN")
    if not token:
        raise SystemExit("HUBSPOT_PRIVATE_APP_TOKEN is not set (see ~/.zshrc)")

    out = pathlib.Path(args.out)
    (out / "html").mkdir(parents=True, exist_ok=True)

    print("exporting HubSpot knowledge base...", file=sys.stderr)
    articles = fetch_all(token)

    index, images, empty = [], 0, 0
    for a in articles:
        body = a.get("hs_body") or ""
        stem = safe_name(a)
        (out / "html" / f"{stem}.html").write_text(body)
        n_img = body.count("<img")
        images += n_img
        empty += not body.strip()
        index.append({
            "id": a["hs_id"],
            "file": f"html/{stem}.html",
            "title": a.get("hs_name"),
            "slug": a.get("hs_slug"),
            "url": a.get("hs_absolute_url"),
            "state": a.get("hs_state"),
            "summary": a.get("hs_summary"),
            "description": a.get("hs_meta_description"),
            "category_id": a.get("hs_knowledge_category_id"),
            "published_at": a.get("hs_published_at"),
            "updated_at": a.get("hs_updated_at"),
            "words": len(re.sub(r"<[^>]+>", " ", body).split()),
            "images": n_img,
        })

    index.sort(key=lambda r: (r["title"] or "").lower())
    (out / "index.json").write_text(json.dumps(index, indent=1) + "\n")

    size = sum(f.stat().st_size for f in (out / "html").iterdir()) / 1e6
    print(f"\n{len(index)} articles -> {out}  ({size:.1f} MB, {images} images"
          + (f", {empty} empty" if empty else "") + ")")


if __name__ == "__main__":
    main()
