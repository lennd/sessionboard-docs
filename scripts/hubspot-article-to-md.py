#!/usr/bin/env python3
"""Convert a live HubSpot KB article page to Markdown with frontmatter.

Usage: python3 scripts/hubspot-article-to-md.py <url-or-html-file> [--body-only]

Extracts the article body from the HubSpot KB page markup, converts it to
GitHub-flavored Markdown via pandoc, and prints MDX with title/description
frontmatter (or just the body with --body-only, for diffing).
"""
import html
import re
import subprocess
import sys
import urllib.request


def fetch(source: str) -> str:
    if source.startswith("http"):
        req = urllib.request.Request(source, headers={"User-Agent": "sessionboard-docs-sync"})
        with urllib.request.urlopen(req) as resp:
            return resp.read().decode("utf-8", errors="replace")
    with open(source) as f:
        return f.read()


def extract_body(page: str) -> str:
    """Return the inner HTML of the article body wrapper, balanced on divs."""
    start = page.find('<div class="container-fluid article-wrapper">')
    if start == -1:
        raise SystemExit("article-wrapper div not found")
    depth = 0
    i = start
    tag = re.compile(r"<div\b|</div>")
    for m in tag.finditer(page, start):
        depth += 1 if m.group(0) != "</div>" else -1
        if depth == 0:
            i = m.end()
            break
    body = page[start:i]
    # Drop related-articles and feedback blocks if present inside the wrapper
    body = re.sub(r'<div class="hs-kb-related-articles".*', "", body, flags=re.S)
    # Drop the duplicated H1 title and subtitle header block (frontmatter covers it)
    body = re.sub(r"<h1[^>]*>.*?</h1>", "", body, count=1, flags=re.S)
    return body


def to_markdown(body_html: str) -> str:
    md = subprocess.run(
        ["pandoc", "-f", "html", "-t", "gfm-raw_html", "--wrap=none"],
        input=body_html, capture_output=True, text=True, check=True,
    ).stdout
    # Collapse >2 blank lines
    md = re.sub(r"\n{3,}", "\n\n", md).strip() + "\n"
    return md


def meta(page: str, name: str) -> str:
    m = re.search(rf'<meta[^>]+(?:name|property)="{name}"[^>]+content="([^"]*)"', page)
    if not m:
        m = re.search(rf'<meta[^>]+content="([^"]*)"[^>]+(?:name|property)="{name}"', page)
    return html.unescape(m.group(1)).strip() if m else ""


def main() -> None:
    source = sys.argv[1]
    body_only = "--body-only" in sys.argv
    page = fetch(source)
    md = to_markdown(extract_body(page))
    if body_only:
        print(md, end="")
        return
    title = meta(page, "og:title") or re.sub(r"\s*\|.*$", "", meta(page, "title"))
    desc = meta(page, "description").replace('"', "'")
    print(f'---\ntitle: "{title}"\ndescription: "{desc}"\n---\n\n{md}', end="")


if __name__ == "__main__":
    main()
