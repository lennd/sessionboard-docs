#!/usr/bin/env python3
"""Lift screenshots out of the markup HubSpot wrapped them in.

The KB editor let authors drop an image inside a heading, inside bold, or at the
end of a sentence with no break. Converted straight to markdown that produces
`### ![](...)` (a heading with no text, and no heading in the outline),
`**![](...)**`, or a paragraph with an image welded onto its last word. All
three also hide the image from scripts/fix-alt-text.py, which reads a line at a
time, so they stay permanently alt-less.

Runs over every page; safe to re-run.

    python3 scripts/normalize_images.py --dry-run
    python3 scripts/normalize_images.py --apply
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / 'src/content/docs'

IMG = r'!\[[^\]]*\]\([^)]+\)'
TABLE_ROW = re.compile(r'^\s*\|')

RULES: list[tuple[str, re.Pattern, str]] = [
    # A heading whose entire text is an image has no heading text at all.
    ('heading', re.compile(rf'^[ \t]*#{{2,6}}[ \t]*({IMG})[ \t]*$', re.M), r'\1'),
    # Emphasis around a lone image styles nothing and often arrives unbalanced,
    # sometimes with pandoc's escaped hard break stuck between image and marker.
    ('emphasis', re.compile(rf'^([ \t]*)\*{{1,3}}({IMG})\\?\*{{0,3}}[ \t]*$', re.M), r'\1\2'),
    # "1.  1.  1.  ![](...)" — nested single-item lists collapsed by pandoc.
    ('nested-list', re.compile(rf'^([ \t]*)(?:\d+\.[ \t]+){{2,}}({IMG})', re.M), r'\1\2'),
    ('nested-bullet', re.compile(rf'^([ \t]*)(?:[-*][ \t]+){{2,}}({IMG})', re.M), r'\1- \2'),
]

# An image welded to the end of a sentence, or to the start of the next one.
# Both are left alone inside tables, where a cell legitimately holds text and a
# screenshot side by side.
TRAILING = re.compile(rf'(?<=\S)[ \t]*({IMG})[ \t]*$', re.M)
LEADING = re.compile(rf'({IMG})(?=[^\s|)\]])')


# HubSpot had no way to float a screenshot beside a paragraph, so authors used a
# borderless two-column table with an empty header row. Converted to markdown it
# becomes a real table with blank headers, and the screenshot inside a cell is
# invisible to every line-based tool we have.
LAYOUT_TABLE = re.compile(
    r'^\|[ \t]*\|[ \t]*\|[ \t]*\n\|[-: \t]+\|[-: \t]+\|[ \t]*\n'
    rf'\|(?P<text>[^|\n]*?)\|[ \t]*(?P<img>{IMG})[ \t]*\|[ \t]*$',
    re.M,
)


def unwrap_layout_table(m: re.Match) -> str:
    text = m.group('text').strip()
    return f'{text}\n\n{m.group("img")}' if text else m.group('img')


def fix(text: str) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}
    text, n = LAYOUT_TABLE.subn(unwrap_layout_table, text)
    if n:
        counts['layout-table'] = n
    for name, pattern, repl in RULES:
        text, n = pattern.subn(repl, text)
        if n:
            counts[name] = counts.get(name, 0) + n

    out, trail, lead = [], 0, 0
    for line in text.split('\n'):
        if not TABLE_ROW.match(line):
            if TRAILING.search(line):
                line = TRAILING.sub(r'\n\n\1', line)
                trail += 1
            if LEADING.search(line):
                line = LEADING.sub(r'\1\n\n', line)
                lead += 1
        out.append(line)
    if trail:
        counts['trailing'] = trail
    if lead:
        counts['leading'] = lead
    text = '\n'.join(out)

    # Unwrapping can leave a stray emphasis marker on its own line.
    text = re.sub(r'^[ \t]*\*{1,3}[ \t]*$', '', text, flags=re.M)
    return re.sub(r'\n{3,}', '\n\n', text), counts


def main() -> None:
    apply = '--apply' in sys.argv
    total: dict[str, int] = {}
    files = 0
    for path in sorted(DOCS.rglob('*.mdx')):
        original = path.read_text()
        fixed, counts = fix(original)
        if fixed == original:
            continue
        files += 1
        for k, v in counts.items():
            total[k] = total.get(k, 0) + v
        print(f'{path.relative_to(DOCS)}: ' + ', '.join(f'{k} x{v}' for k, v in counts.items()))
        if apply:
            path.write_text(fixed)

    verb = 'fixed' if apply else 'would fix'
    summary = ', '.join(f'{k} x{v}' for k, v in sorted(total.items())) or 'nothing'
    print(f'\n{verb} {summary} across {files} files')


if __name__ == '__main__':
    main()
