#!/usr/bin/env python3
"""Generate branded 1200x630 Open Graph share images for every docs page.

Design matches sessionboard-tam/growth-pages/og.py (light card, top blue strip,
wordmark, eyebrow pill, fitted title, path label) so support pages share the
growth-page visual identity when shared on LinkedIn/Slack.

Usage: python3 scripts/generate-og.py [--force]
Requires cairosvg (pip install cairosvg). Fonts are vendored in assets/fonts.
"""
from __future__ import annotations

import base64
import html
import os
import re
import sys
from pathlib import Path

try:
    import cairosvg
except ImportError:
    sys.exit('cairosvg required: pip install cairosvg (or run with growth-pages .venv python)')

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'src/content/docs'
OUT = ROOT / 'public/og'
FONTS = ROOT / 'assets/fonts'
WORDMARK = ROOT / 'assets/sessionboard-wordmark.webp.b64.txt'

OG_W, OG_H = 1200, 630
FONT = "'Plus Jakarta Sans', sans-serif"

# Growth palette (growth.css / og.py)
INK = '#1b2742'
MUTED_INK = '#5b667d'
LIGHT_MUTED = '#949db0'
PRIMARY = '#1e62d8'
PILL_BG = '#e9f1fe'
WHITE = '#ffffff'
BG_TOP = '#f8faff'
BG_BOTTOM = '#ffffff'
BORDER = '#e8ecf4'
CARD_MUTED = '#f6f8fb'

TITLE_CONFIGS = [(46, 56, 38, 2), (42, 52, 42, 2), (38, 48, 44, 3), (34, 42, 48, 3)]


def esc(t: str) -> str:
    return html.escape(t or '', quote=True)


def clean(t: str) -> str:
    return re.sub(r'\s+', ' ', (t or '').strip())


def font_defs() -> str:
    faces = []
    for weight, name in ((400, 'PlusJakartaSans-Regular.ttf'), (600, 'PlusJakartaSans-SemiBold.ttf')):
        p = FONTS / name
        if p.exists():
            b64 = base64.b64encode(p.read_bytes()).decode('ascii')
            faces.append(
                f"@font-face{{font-family:'Plus Jakarta Sans';font-weight:{weight};"
                f"src:url('data:font/truetype;charset=utf-8;base64,{b64}') format('truetype');}}"
            )
    return f'<style>{"".join(faces)}</style>'


def wrap_lines(text: str, max_chars: int, max_lines: int) -> list[str]:
    words = clean(text).split()
    lines: list[str] = []
    i = 0
    while i < len(words) and len(lines) < max_lines:
        cur: list[str] = []
        while i < len(words):
            trial = ' '.join(cur + [words[i]]) if cur else words[i]
            if len(trial) <= max_chars:
                cur.append(words[i])
                i += 1
            else:
                break
        if cur:
            lines.append(' '.join(cur))
        else:
            lines.append(words[i][: max_chars - 1] + '…')
            i += 1
    if i < len(words) and lines:
        lines[-1] = (lines[-1] + ' …')[: max_chars + 2]
        if not lines[-1].endswith('…'):
            lines[-1] = lines[-1].rstrip() + '…'
    return lines


def fit_title(title: str) -> tuple[list[str], int, int]:
    source = clean(title)
    for fs, lh, max_chars, max_lines in TITLE_CONFIGS:
        lines = wrap_lines(source, max_chars, max_lines)
        if '…' not in ' '.join(lines) and ' '.join(lines) == source:
            return lines, fs, lh
    fs, lh, max_chars, max_lines = TITLE_CONFIGS[-1]
    return wrap_lines(source, max_chars, max_lines), fs, lh


def docs_visual() -> str:
    """Mini article card with steps — the docs-flavored right-side motif."""
    rows = ''
    for n, y in enumerate((170, 240, 310), start=1):
        rows += f'''
    <circle cx="762" cy="{y + 14}" r="16" fill="{PILL_BG}"/>
    <text x="762" y="{y + 19}" text-anchor="middle" fill="{PRIMARY}" font-family="{FONT}" font-size="15" font-weight="600">{n}</text>
    <rect x="792" y="{y}" width="316" height="28" rx="8" fill="{CARD_MUTED}"/>
    <rect x="804" y="{y + 10}" width="{230 - n * 30}" height="8" rx="4" fill="{BORDER}"/>'''
    return f'''
  <g>
    <rect x="720" y="96" width="416" height="418" rx="18" fill="{WHITE}" stroke="{BORDER}" stroke-width="1.5"/>
    <rect x="744" y="124" width="120" height="12" rx="5" fill="{PRIMARY}" opacity="0.85"/>
    <rect x="744" y="148" width="300" height="8" rx="4" fill="{BORDER}"/>
    {rows}
    <rect x="744" y="392" width="160" height="36" rx="8" fill="{PRIMARY}"/>
    <text x="824" y="415" text-anchor="middle" fill="{WHITE}" font-family="{FONT}" font-size="14" font-weight="600">Open the guide</text>
    <text x="744" y="480" fill="{LIGHT_MUTED}" font-family="{FONT}" font-size="15" font-weight="500">Sessionboard Help Center</text>
  </g>'''


def render_svg(title: str, subtitle: str, eyebrow: str, path_label: str) -> str:
    wordmark = WORDMARK.read_text().strip() if WORDMARK.exists() else ''
    title_lines, tfs, tlh = fit_title(title)
    sub_lines = wrap_lines(subtitle, 48, 2)

    title_y = 208
    tspans = ''.join(
        f'<tspan x="72" dy="{0 if i == 0 else tlh}">{esc(l)}</tspan>' for i, l in enumerate(title_lines)
    )
    sub_y = title_y + len(title_lines) * tlh + 18
    sspans = ''.join(
        f'<tspan x="72" dy="{0 if i == 0 else 32}">{esc(l)}</tspan>' for i, l in enumerate(sub_lines)
    )
    wordmark_block = (
        f'<image href="{wordmark}" x="72" y="56" width="248" height="50" preserveAspectRatio="xMinYMid meet"/>'
        if wordmark
        else ''
    )
    eyebrow_w = min(max(len(eyebrow) * 11 + 36, 120), 460)

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{OG_W}" height="{OG_H}" viewBox="0 0 {OG_W} {OG_H}" role="img" aria-label="{esc(title)}">
  <defs>
    {font_defs()}
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{BG_TOP}"/><stop offset="100%" stop-color="{BG_BOTTOM}"/>
    </linearGradient>
    <radialGradient id="glow" cx="88%" cy="18%" r="42%">
      <stop offset="0%" stop-color="{PRIMARY}" stop-opacity="0.12"/><stop offset="100%" stop-color="{PRIMARY}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{OG_W}" height="{OG_H}" fill="url(#bg)"/>
  <rect width="{OG_W}" height="{OG_H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="{OG_W}" height="4" fill="{PRIMARY}"/>
  {wordmark_block}
  <rect x="72" y="130" width="{eyebrow_w}" height="32" rx="16" fill="{PILL_BG}"/>
  <text x="90" y="151" fill="{PRIMARY}" font-family="{FONT}" font-size="13" font-weight="600" letter-spacing="0.08em">{esc(eyebrow.upper())}</text>
  <text x="72" y="{title_y}" fill="{INK}" font-family="{FONT}" font-size="{tfs}" font-weight="600" letter-spacing="-0.02em">{tspans}</text>
  <text x="72" y="{sub_y}" fill="{MUTED_INK}" font-family="{FONT}" font-size="22" font-weight="400">{sspans}</text>
  {docs_visual()}
  <rect x="0" y="{OG_H - 52}" width="{OG_W}" height="52" fill="{WHITE}" stroke="{BORDER}" stroke-width="1"/>
  <text x="72" y="{OG_H - 20}" fill="{LIGHT_MUTED}" font-family="{FONT}" font-size="16" font-weight="500">{esc(path_label)}</text>
</svg>'''


def frontmatter(path: Path) -> dict:
    s = path.read_text()
    m = re.match(r'\A---\n(.*?)\n---', s, re.S)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        km = re.match(r'^(\w+):\s*(.*)$', line)
        if km:
            out[km.group(1)] = km.group(2).strip().strip('"').strip("'")
    return out


def og_key(slug: str) -> str:
    return 'home' if slug in ('', 'index') else slug.replace('/', '--')


def main() -> None:
    import json

    force = '--force' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    crumbs = json.loads((ROOT / 'src/breadcrumbs.json').read_text())

    made = skipped = 0
    for mdx in sorted(DOCS.rglob('*.mdx')):
        slug = str(mdx.relative_to(DOCS)).removesuffix('.mdx')
        slug = '' if slug == 'index' else slug
        fm = frontmatter(mdx)
        title = fm.get('title') or slug
        subtitle = fm.get('description') or ''
        first = re.split(r'(?<=[.!?])\s+', clean(subtitle), maxsplit=1)[0]
        if len(first) > 140:
            first = first[:137].rstrip() + '…'
        section = (crumbs.get(slug) or {}).get('section') or 'Help Center'
        path_label = f'learn.sessionboard.com/{slug}' if slug else 'learn.sessionboard.com'

        png = OUT / f'{og_key(slug)}.png'
        if not force and png.exists() and png.stat().st_mtime > mdx.stat().st_mtime:
            skipped += 1
            continue
        svg = render_svg(title, first, section, path_label)
        cairosvg.svg2png(bytestring=svg.encode(), write_to=str(png), output_width=OG_W, output_height=OG_H)
        made += 1
    print(f'og images: generated {made}, up-to-date {skipped}')


if __name__ == '__main__':
    main()
