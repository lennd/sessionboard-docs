#!/usr/bin/env python3
"""Generate branded 1200x630 Open Graph share images for every docs page.

Simple and clean, per the CFP/EventSites edge share-image pattern: signature
Sessionboard gradient with soft pastel bubbles, one centered white card with
the wordmark, a section eyebrow pill, and the page title. Colors and type
follow growth-org/assets/DESIGN.md (Plus Jakarta Sans 600, -0.025em).

Usage: python3 scripts/generate-og.py [--force]
Requires cairosvg (pip install -r requirements.txt). Fonts vendored in assets/fonts.
"""
from __future__ import annotations

import base64
import html
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

# DESIGN.md tokens
INK = '#14192b'
MUTED = '#5b667d'
LIGHT_MUTED = '#949db0'
PRIMARY = '#1e62d8'
PILL_BG = '#e9f1fe'
WHITE = '#ffffff'
CARD_BORDER = '#e9eaf0'
# Signature hero gradient + blue bubble shades
GRAD_A = '#efedff'
GRAD_B = '#e2ecff'
BLUES = ['#b8d1ff', '#cbdcff', '#9cc0f4']

# (font-size, line-height, max-chars, max-lines) — centered card fits ~2 lines
TITLE_CONFIGS = [(56, 68, 30, 2), (48, 60, 36, 2), (42, 52, 42, 2), (36, 46, 46, 3)]

# Deterministic bubble layout: (cx, cy, r, blue index, opacity) — few, subtle
BUBBLES = [
    (96, 88, 78, 0, 0.40),
    (1144, 176, 104, 1, 0.45),
    (150, 552, 48, 2, 0.30),
    (1076, 556, 66, 0, 0.35),
]


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


def bubbles_svg() -> str:
    out = ''
    for cx, cy, r, bi, op in BUBBLES:
        out += f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{BLUES[bi]}" opacity="{op}"/>\n  '
    return out


def render_svg(title: str, eyebrow: str, path_label: str) -> str:
    wordmark = WORDMARK.read_text().strip() if WORDMARK.exists() else ''
    title_lines, tfs, tlh = fit_title(title)
    cx = OG_W / 2

    # Card sized to content (wordmark → pill → title), centered on the canvas
    wm_w, wm_h = 240, 48
    pill_h = 34
    pad_top, gap_wm_pill, gap_pill_title, pad_bottom = 52, 28, 34, 54
    title_block_h = (len(title_lines) - 1) * tlh + tfs
    card_w = 1000
    card_h = pad_top + wm_h + gap_wm_pill + pill_h + gap_pill_title + title_block_h + pad_bottom
    card_x = (OG_W - card_w) / 2
    card_y = (OG_H - card_h) / 2 - 12

    wm_y = card_y + pad_top
    pill_y = wm_y + wm_h + gap_wm_pill
    pill_w = min(max(len(eyebrow) * 10.5 + 40, 130), 560)
    title_y = pill_y + pill_h + gap_pill_title + tfs * 0.78  # first-line baseline

    tspans = ''.join(
        f'<tspan x="{cx}" dy="{0 if i == 0 else tlh}">{esc(l)}</tspan>' for i, l in enumerate(title_lines)
    )
    wordmark_block = (
        f'<image href="{wordmark}" x="{cx - wm_w / 2}" y="{wm_y}" width="{wm_w}" height="{wm_h}" '
        f'preserveAspectRatio="xMidYMid meet"/>'
        if wordmark
        else ''
    )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{OG_W}" height="{OG_H}" viewBox="0 0 {OG_W} {OG_H}" role="img" aria-label="{esc(title)}">
  <defs>
    {font_defs()}
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0.18">
      <stop offset="7%" stop-color="{GRAD_A}"/><stop offset="99%" stop-color="{GRAD_B}"/>
    </linearGradient>
  </defs>
  <rect width="{OG_W}" height="{OG_H}" fill="url(#bg)"/>
  {bubbles_svg()}
  <rect x="{card_x}" y="{card_y + 8}" width="{card_w}" height="{card_h}" rx="28" fill="#14192b" opacity="0.06"/>
  <rect x="{card_x}" y="{card_y}" width="{card_w}" height="{card_h}" rx="28" fill="{WHITE}" stroke="{CARD_BORDER}" stroke-width="1.5"/>
  {wordmark_block}
  <rect x="{cx - pill_w / 2}" y="{pill_y}" width="{pill_w}" height="{pill_h}" rx="{pill_h / 2}" fill="{PILL_BG}"/>
  <text x="{cx}" y="{pill_y + 22.5}" text-anchor="middle" fill="{PRIMARY}" font-family="{FONT}" font-size="14" font-weight="600" letter-spacing="0.08em">{esc(eyebrow.upper())}</text>
  <text x="{cx}" y="{title_y}" text-anchor="middle" fill="{INK}" font-family="{FONT}" font-size="{tfs}" font-weight="600" letter-spacing="-0.025em">{tspans}</text>
  <text x="{cx}" y="{OG_H - 34}" text-anchor="middle" fill="{LIGHT_MUTED}" font-family="{FONT}" font-size="17" font-weight="500">{esc(path_label)}</text>
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
        section = (crumbs.get(slug) or {}).get('section') or 'Help Center'
        path_label = f'learn.sessionboard.com/{slug}' if slug else 'learn.sessionboard.com'

        png = OUT / f'{og_key(slug)}.png'
        if not force and png.exists() and png.stat().st_mtime > mdx.stat().st_mtime:
            skipped += 1
            continue
        svg = render_svg(title, section, path_label)
        cairosvg.svg2png(bytestring=svg.encode(), write_to=str(png), output_width=OG_W, output_height=OG_H)
        made += 1
    print(f'og images: generated {made}, up-to-date {skipped}')


if __name__ == '__main__':
    main()
