#!/usr/bin/env python3
"""Rebuild a docs page from its archived HubSpot article.

During the migration 35 pages were rewritten by hand instead of being run
through the HTML importer, which dropped their screenshots, callouts and a lot
of body copy. This converts the archived HubSpot HTML (see
scripts/hubspot_kb_export.py) back into MDX that matches our conventions:

    hs-callout-type-*      -> <Note> / <Tip> / <Warning>
    Arcade/Guidde iframes  -> the standard responsive <iframe /> block
    <h3>/<h4>              -> shifted so the shallowest heading is <h2>

Frontmatter is always kept from the existing page, so title, description and
sidebar metadata survive. Images keep their HubSpot CDN URLs; run
scripts/rehost-images.py afterwards to pull them local.

    python3 scripts/kb_restore.py --list
    python3 scripts/kb_restore.py --path /integrations/cvent
    python3 scripts/kb_restore.py --min-loss 120 --write
"""
import argparse
import csv
import html as htmllib
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "src/content/docs"
ARCHIVE = ROOT / ".kb-archive"

CALLOUTS = {"tip": "Tip", "note": "Note", "caution": "Warning", "warning": "Warning"}
# HubSpot-era "contact us" banners; our pages carry a standard footer instead.
BOILERPLATE = re.compile(r"need assistance|contact sessionboard", re.I)
EMBED_STYLE = ('style={{width:"100%",aspectRatio:"16/9",border:0,borderRadius:"12px"}}')


def pandoc(fragment: str) -> str:
    # HubSpot's editor pads layout with &nbsp; paragraphs and trailing <br>s;
    # pandoc faithfully turns those into stray "\" lines and empty list items.
    fragment = fragment.replace("&nbsp;", " ")
    fragment = re.sub(r"<p>(?:\s|<br\s*/?>)*</p>", "", fragment)
    fragment = re.sub(r"(?:<br\s*/?>\s*)+</(p|li|td)>", r"</\1>", fragment)
    if not fragment.strip():
        return ""
    md = subprocess.run(
        ["pandoc", "-f", "html", "-t", "gfm-raw_html", "--wrap=none"],
        input=fragment, capture_output=True, text=True, check=True,
    ).stdout
    return re.sub(r"\n{3,}", "\n\n", md).strip()


def balanced_div(s: str, start: int) -> int:
    """Index just past the </div> that closes the <div> opening at `start`."""
    depth = 0
    for m in re.finditer(r"<div\b|</div>", s[start:]):
        depth += 1 if m.group(0) != "</div>" else -1
        if depth == 0:
            return start + m.end()
    return len(s)


def take_embeds(s: str, sink: list) -> str:
    """Swap iframes for markers so pandoc's gfm-raw_html can't strip them."""
    def sub(m):
        src = htmllib.unescape(re.search(r'src="([^"]+)"', m.group(0)).group(1))
        t = re.search(r'title="([^"]*)"', m.group(0))
        title = htmllib.unescape(t.group(1)) if t else ""
        sink.append(f'<iframe src="{src}" title="{title}" loading="lazy" '
                    f"allowfullscreen {EMBED_STYLE} />")
        return f"<p>@@EMBED{len(sink) - 1}@@</p>"
    return re.sub(r"<iframe\b[^>]*>.*?</iframe>|<iframe\b[^>]*/?>", sub, s, flags=re.S)


def flatten_untranslatable_tables(html: str) -> str:
    """Keep the cells of tables pandoc would throw away.

    A GFM pipe table can't hold block content, so when a cell contains a list
    pandoc gives up and emits the literal string "[TABLE]" — silently losing
    the whole table. HubSpot used tables for layout rather than data, so unwrap
    exactly the ones pandoc refuses and let the cells stand on their own.
    Cells are concatenated bare: wrapping them in <div> would break the
    depth counting in balanced_div().
    """
    def sub(m: re.Match) -> str:
        table = m.group(0)
        probe = subprocess.run(
            ["pandoc", "-f", "html", "-t", "gfm-raw_html", "--wrap=none"],
            input=table, capture_output=True, text=True,
        ).stdout.strip()
        if probe != "[TABLE]":
            return table
        return "\n".join(re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", table, re.S))
    return re.sub(r"<table\b.*?</table>", sub, html, flags=re.S)


def convert(body: str) -> tuple[str, set]:
    """HubSpot article HTML -> MDX body plus the set of components used."""
    embeds: list[str] = []
    body = flatten_untranslatable_tables(body)
    body = take_embeds(body, embeds)

    used, parts, i = set(), [], 0
    pattern = re.compile(r'<div[^>]*(?:data-hs-callout-type="(\w+)"'
                         r'|class="(intercom-interblocks-callout)")[^>]*>')
    while (m := pattern.search(body, i)):
        end = balanced_div(body, m.start())
        inner = body[m.end():end - len("</div>")]
        parts.append(("html", body[i:m.start()]))
        kind = CALLOUTS.get(m.group(1) or "", "Note")
        text = re.sub(r"<[^>]+>", " ", inner)
        if not BOILERPLATE.search(text):
            parts.append(("callout", (kind, inner)))
            used.add(kind)
        i = end
    parts.append(("html", body[i:]))

    out = []
    for kind, payload in parts:
        if kind == "html":
            md = pandoc(payload)
            if md:
                out.append(md)
        else:
            tag, inner = payload
            md = pandoc(inner)
            if md:
                out.append(f"<{tag}>\n{md}\n</{tag}>")
    # Tidy first, then restore the embeds: the iframes carry a JSX style
    # attribute whose braces must not be escaped as literal prose.
    md = tidy("\n\n".join(out))
    for n, frame in enumerate(embeds):
        md = md.replace(f"@@EMBED{n}@@", frame)
    if "[TABLE]" in md:
        raise SystemExit("pandoc dropped a table it could not represent; "
                         "flatten_untranslatable_tables() missed a case")
    return md, used


def tidy(md: str) -> str:
    """Strip the migration artifacts STYLE.md bans, before they reach a page."""
    md = re.sub(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$", "", md, flags=re.M)  # HubSpot rules
    md = re.sub(r"[\u200b-\u200d\ufeff]", "", md)
    md = md.replace("\xa0", " ")
    md = re.sub(r"^[ \t]*\\\s*$", "", md, flags=re.M)   # pandoc hard-break leftovers
    md = re.sub(r"[ \t]*\\$", "", md, flags=re.M)       # ...and trailing ones
    md = re.sub(r"^([ \t]*)- -[ \t]+", r"\1- ", md, flags=re.M)
    md = re.sub(r"^[ \t]*(?:&nbsp;)+[ \t]*$", "", md, flags=re.M)   # spacer paragraphs
    md = md.replace("&nbsp;", " ")
    md = re.sub(r"^#{2,6}\s*$", "", md, flags=re.M)                 # empty headings

    # HubSpot pasted the page's own headings at the top as jump links. Starlight
    # renders a real table of contents, and these anchors don't survive anyway.
    def drop_toc(m):
        items = [l for l in m.group(0).strip().split("\n") if l.strip()]
        anchors = sum(1 for i in items if re.search(r"\]\(#", i))
        return "" if len(items) >= 2 and anchors / len(items) >= 0.6 else m.group(0)
    # HubSpot's editor double-spaced list items, so the jump links arrive as
    # bullets separated by blank lines rather than as one contiguous block.
    md = re.sub(r"(?:^[-*] .+\n(?:[ \t]*\n)?){2,}", drop_toc, md, flags=re.M)

    md = re.sub(r"^(#{2,6})\s*\*\*(.+?)\*\*\s*$", r"\1 \2", md, flags=re.M)  # bold headings
    md = re.sub(r"^(#{2,6})\s+(.*?)\s*:\s*$", r"\1 \2", md, flags=re.M)      # trailing colon

    # MDX reads { and } as expressions; HubSpot prose contains both as literals.
    md = re.sub(r"(?<!`)([{}])(?!`)", lambda m: "\\" + m.group(1), md)

    levels = [len(h) for h in re.findall(r"^(#{2,6}) ", md, flags=re.M)]
    if levels and (shift := min(levels) - 2) > 0:
        md = re.sub(r"^(#{2,6}) ", lambda m: "#" * (len(m.group(1)) - shift) + " ",
                    md, flags=re.M)
    return re.sub(r"\n{3,}", "\n\n", md).strip() + "\n"


def load_pairs() -> list[dict]:
    """docs path -> archived article, using the migration redirect table."""
    index = {r["slug"].rstrip("/").rsplit("/", 1)[-1]: r
             for r in json.loads((ARCHIVE / "index.json").read_text()) if r.get("slug")}
    pairs = []
    for r in csv.DictReader(open(ROOT / "redirects-301.csv")):
        art = index.get(r["old_url"].rstrip("/").rsplit("/", 1)[-1])
        f = DOCS / (r["new_path"].lstrip("/") + ".mdx")
        if not art or not f.exists():
            continue
        cur = re.sub(r"^---.*?---", "", f.read_text(), flags=re.S)
        cur = re.sub(r"^import .*$", "", cur, flags=re.M)
        pairs.append({
            "path": r["new_path"], "file": f, "article": art,
            "disposition": r.get("disposition", ""),
            "loss": art["words"] - len(cur.split()),
            "img_loss": art["images"] - cur.count("!["),
        })
    return pairs


def restore(pair: dict, write: bool) -> None:
    src = (ARCHIVE / pair["article"]["file"]).read_text()
    md, used = convert(src)
    original = pair["file"].read_text()
    fm = re.match(r"^---.*?---\n", original, flags=re.S)
    frontmatter = fm.group(0) if fm else ""

    imports = f"\nimport {{ {', '.join(sorted(used))} }} from '@compat';\n" if used else ""
    new = f"{frontmatter}{imports}\n{md}"

    if write:
        pair["file"].write_text(new)
        print(f"  wrote {pair['path']}  (+{pair['loss']} words, "
              f"+{pair['img_loss']} images)")
    else:
        print(f"--- {pair['path']} (preview) " + "-" * 30)
        print(new[:1200])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", help="single docs path, e.g. /integrations/cvent")
    ap.add_argument("--min-loss", type=int, help="restore every page missing >= N words")
    ap.add_argument("--list", action="store_true", help="show candidates and exit")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    if not (ARCHIVE / "index.json").exists():
        raise SystemExit("no archive - run scripts/hubspot_kb_export.py first")
    pairs = load_pairs()

    if args.list:
        print(f"{'words':>7} {'imgs':>5}  disposition    page")
        for p in sorted(pairs, key=lambda x: -x["loss"]):
            if p["loss"] > 0 or p["img_loss"] > 0:
                print(f'{p["loss"]:>+7} {p["img_loss"]:>+5}  {p["disposition"]:<14} {p["path"]}')
        return

    if args.path:
        sel = [p for p in pairs if p["path"] == args.path]
        if not sel:
            raise SystemExit(f"no archived article mapped to {args.path}")
    elif args.min_loss is not None:
        sel = [p for p in pairs if p["loss"] >= args.min_loss]
    else:
        raise SystemExit("pass --path, --min-loss or --list")

    print(f"{len(sel)} page(s)")
    for p in sorted(sel, key=lambda x: -x["loss"]):
        restore(p, args.write)
    if args.write:
        print("\nnext: python3 scripts/rehost-images.py && npm run check:style")


if __name__ == "__main__":
    main()
