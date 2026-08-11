#!/usr/bin/env python3
"""Put back the bold lead-in labels the HTML-to-markdown conversion dropped.

HubSpot wrote setting lists as "<strong>Alias</strong>: Adjust the name…", and
that bold is what lets a reader skim a list of a dozen settings. Conversion
lost it on roughly half the pages, which is most of what "rough formatting when
bullet points are in use" looks like on the page.

Only re-bolds a label the archived HTML actually had in a <strong> or <b>, so
nothing is invented — pages hand-written after the migration are left alone.
"""
import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kb_restore import ARCHIVE, load_pairs  # noqa: E402

# A list item opening with "Label: rest of sentence" and no emphasis yet.
LABELLED = re.compile(r"^(\s*(?:[-*+]|\d+[.)])\s+)([A-Z][^:*_\n]{0,48}?):(\s+\S)")
STRONG = re.compile(r"<(?:strong|b)\b[^>]*>(.*?)</(?:strong|b)>", re.S | re.I)


def bold_labels(text: str, allowed: set[str]) -> tuple[str, int]:
    changed = 0

    def sub(m: re.Match) -> str:
        nonlocal changed
        label = m.group(2).strip()
        if label.casefold() not in allowed:
            return m.group(0)
        changed += 1
        return f"{m.group(1)}**{label}:**{m.group(3)}"

    out_lines = []
    in_fence = False
    for line in text.split("\n"):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        out_lines.append(line if in_fence else LABELLED.sub(sub, line))
    return "\n".join(out_lines), changed


ANY_ITEM = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+\S")
BOLD_LABEL = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+\*\*[^*]+?:?\*\*")
# A label may introduce a sentence ("Alias: adjust…") or a nested list ("Task Type:").
PLAIN_LABEL = re.compile(r"^(\s*)((?:[-*+]|\d+[.)])\s+)([A-Z][^:*_\n]{0,48}?):(\s+\S|\s*$)")


def match_siblings(text: str) -> tuple[str, int]:
    """Bold the stragglers in a list whose siblings are already bold.

    HubSpot bolded most items in a settings list but missed one or two, which
    reads as an oversight rather than a distinction.
    """
    lines = text.split("\n")
    changed = 0
    block: list[int] = []
    in_fence = False

    def flush() -> None:
        nonlocal changed
        by_indent: dict[int, list[int]] = {}
        for i in block:
            by_indent.setdefault(len(ANY_ITEM.match(lines[i]).group(1)), []).append(i)
        for siblings in by_indent.values():
            bold = [i for i in siblings if BOLD_LABEL.match(lines[i])]
            plain = [i for i in siblings if not BOLD_LABEL.match(lines[i])
                     and PLAIN_LABEL.match(lines[i])]
            if len(bold) < 2 or len(bold) <= len(siblings) // 2:
                continue
            for i in plain:
                m = PLAIN_LABEL.match(lines[i])
                lines[i] = (f"{m.group(1)}{m.group(2)}**{m.group(3)}:**"
                            f"{m.group(4)}{lines[i][m.end():]}")
                changed += 1
        block.clear()

    for i, line in enumerate(lines):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        if in_fence:
            continue
        if ANY_ITEM.match(line):
            block.append(i)
        elif not line.strip() or line.startswith(" "):
            continue          # blank lines and indented content stay inside the list
        else:
            flush()           # a paragraph, heading or JSX tag ends the list
    flush()

    return "\n".join(lines), changed


def strong_phrases(article_html: str) -> set[str]:
    """Every phrase the article emphasised, normalised for comparison."""
    out = set()
    for raw in STRONG.findall(article_html):
        text = html.unescape(re.sub(r"<[^>]+>", "", raw))
        text = text.replace("\xa0", " ").strip().rstrip(":").strip()
        if text:
            out.add(text.casefold())
    return out


def main() -> None:
    write = "--write" in sys.argv
    restored = matched = files = 0

    # Where an archived article exists, its <strong> tags are the source of truth.
    from_archive = {}
    for pair in load_pairs():
        allowed = strong_phrases((ARCHIVE / pair["article"]["file"]).read_text())
        if allowed:
            from_archive[pair["file"]] = allowed

    docs = ARCHIVE.parent / "src/content/docs"
    for f in sorted(docs.rglob("*.mdx")):
        original = f.read_text()
        text, a = bold_labels(original, from_archive.get(f, set()))
        text, b = match_siblings(text)
        if text == original:
            continue
        files += 1
        restored += a
        matched += b
        print(f"  {f.relative_to(docs)}: {a} from archive, {b} matched to siblings")
        if write:
            f.write_text(text)

    verb = "re-bolded" if write else "would re-bold"
    print(f"\n{verb} {restored + matched} list label(s) across {files} page(s) "
          f"({restored} restored from the archive, {matched} matched to siblings)")
    if not write:
        print("re-run with --write to apply")


if __name__ == "__main__":
    main()
