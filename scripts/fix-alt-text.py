#!/usr/bin/env python3
"""Replace counter-suffixed image alt text with the prose it illustrates.

The migration pass that generated alt text keyed off the nearest heading, so a
run of screenshots under one heading came out as "Connect Integration (2)",
"(3)", "(4)". A screen reader reads that as nothing at all.

In a how-to article the sentence directly above a screenshot is almost always a
description of it, so that is what we borrow. Where the surrounding prose is too
thin to describe anything, the old alt text stays -- a vague label beats an
invented one.

    python3 scripts/fix-alt-text.py --dry-run
    python3 scripts/fix-alt-text.py --apply
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'src/content/docs'

IMG = re.compile(r'^!\[([^\]]*)\]\(([^)]+)\)\s*$')
COUNTER = re.compile(r'\s*\(\d+\)$')

# Sentences that lead with these say nothing on their own once lifted out of
# the flow of the page.
WEAK_LEAD = re.compile(
    r'^(?:or|and|then|also|next|finally|note|tip|here|this|that|it|they)\b[,:]?\s+',
    re.I,
)

MAX_LEN = 110
MIN_LEN = 20

# A table row describes the page, not the screenshot.
TABLE_ROW = re.compile(r'^\s*\|')

# Admonitions are addressed to the reader rather than to the image, and the
# migrated ones open with an emoji, so skip past any leading symbols.
ADMONITION = re.compile(
    r'^\W*(?:NOTE|TIP|WARNING|IMPORTANT|CAUTION|REMEMBER|DID YOU KNOW)\b', re.I
)

# Cutting a long sentence often lands on a word that needs the next one.
DANGLING = re.compile(
    r'\s+(?:that|which|and|or|the|a|an|to|of|in|on|by|for|with|from|as|at|is|are'
    r'|was|were|be|been|will|can|you|your|their|its|this|these|those|if|when'
    r'|based|using|into|about)$',
    re.I,
)


def clean(line: str) -> str:
    """Reduce a markdown line to the sentence a reader would hear."""
    s = re.sub(r'!?\[([^\]]*)\]\([^)]*\)', r'\1', line)  # links/images -> label
    s = re.sub(r'<[^>]+>', '', s)                        # jsx + html tags
    s = re.sub(r'[*_`]', '', s)                          # emphasis marks
    s = re.sub(r'^\s*(?:[-*+]|\d+[.)])\s+', '', s)       # list marker
    s = s.replace('\u200b', '').replace('\ufeff', '')    # zero-width leftovers
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def first_sentence(s: str) -> str:
    # Split on sentence end followed by a capital, so "e.g." and "Sessions 2.0"
    # don't get treated as boundaries.
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z])', s)
    return parts[0].strip() if parts else s


def balance(s: str) -> str:
    """Drop a parenthetical that a truncation left hanging open."""
    if s.count('(') > s.count(')'):
        s = s[: s.rindex('(')].rstrip(' ,;:')
    return s


def shorten(s: str, limit: int = MAX_LEN) -> str:
    """Cut to a clause that can stand alone, never mid-thought."""
    if len(s) <= limit:
        return balance(s)
    head = s[:limit]
    # Prefer a clause boundary so the result is a whole thought rather than a
    # sentence with its tail lopped off.
    for sep in ('; ', ', '):
        if sep in head:
            return balance(head[: head.rindex(sep)])
    cut = head.rsplit(' ', 1)[0].rstrip(' ,;:')
    # A clause opener left with only a word or two behind it reads as a
    # sentence cut off mid-breath, so drop the whole opener.
    cut = re.sub(
        r'\s+(?:so that|such that|in order to|so|because|while|although|unless)'
        r'\s+\w+(?:\s+\w+)?$',
        '',
        cut,
        flags=re.I,
    )
    prev = None
    while cut != prev:
        prev = cut
        cut = DANGLING.sub('', cut).rstrip(' ,;:')
    return balance(cut)


def derive(lines: list[str], idx: int) -> str | None:
    """Best descriptive sentence in the few lines above image at `idx`."""
    for j in range(idx - 1, max(-1, idx - 6), -1):
        raw = lines[j]
        if prev := IMG.match(raw):
            # A screenshot directly above with a real description means both
            # illustrate the same step, so inherit rather than invent. Earlier
            # images are fixed first, so the description has already landed.
            above = prev.group(1).strip()
            if above and not COUNTER.search(above):
                return above
            continue
        if raw.lstrip().startswith('#') or TABLE_ROW.match(raw):
            continue
        text = clean(raw)
        if not text or TABLE_ROW.match(text) or ADMONITION.match(text):
            continue
        # Migrated callouts open with a decorative emoji that reads as noise.
        text = re.sub(r'^[^\w"“\'(]+', '', text)
        text = WEAK_LEAD.sub('', text)
        text = first_sentence(text).rstrip(' :.')
        if len(text) < MIN_LEN:
            continue
        # Reference lists are written as "Setting: what it does", and the
        # screenshot belongs to the setting, so the label alone is the caption.
        term = re.match(r'^([A-Z][^:]{9,59}):\s+\S', text)
        text = term.group(1).rstrip() if term else shorten(text)
        # A leading lowercase letter means we sliced into the middle of a
        # thought; capitalise so it reads as a caption.
        return text[0].upper() + text[1:]
    return None


def main() -> None:
    apply = '--apply' in sys.argv
    changed_files = 0
    changed_imgs = 0
    kept = 0
    preview: list[str] = []

    for path in sorted(DOCS.rglob('*.mdx')):
        lines = path.read_text().split('\n')
        dirty = False

        for i, line in enumerate(lines):
            m = IMG.match(line)
            if not m:
                continue
            alt = m.group(1).strip().replace('\u200b', '').replace('\ufeff', '')

            if not COUNTER.search(alt):
                # Invisible characters survived the migration inside otherwise
                # fine alt text; drop them without touching the wording.
                if alt != m.group(1).strip():
                    lines[i] = f'![{alt}]({m.group(2)})'
                    dirty = True
                    changed_imgs += 1
                continue

            new = derive(lines, i)
            if not new:
                kept += 1
                continue

            # Consecutive screenshots of one step share a description, and
            # repeating it is honest — the numbered variants said nothing.
            lines[i] = f'![{new}]({m.group(2)})'
            dirty = True
            changed_imgs += 1
            preview.append(f'{path.relative_to(DOCS)}\n  - {alt}\n  + {new}')

        if dirty:
            changed_files += 1
            if apply:
                path.write_text('\n'.join(lines))

    print('\n'.join(preview))
    verb = 'rewrote' if apply else 'would rewrite'
    print(f'\n{verb} {changed_imgs} alt texts across {changed_files} files; left {kept} alone')


if __name__ == '__main__':
    main()
