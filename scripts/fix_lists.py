#!/usr/bin/env python3
"""Repair the list formatting the HubSpot export mangled.

Three defects, all from the same migration:

1. Zero-width-space lines. HubSpot padded its editor with a lone U+200B. In
   markdown that is a paragraph, so it terminates whatever list it lands in.

2. Flattened nesting. Parent bullets were written as "-  Item" — a dash and
   *two* spaces — putting the item's content at column 3 while its children
   were indented by 2. CommonMark nests a child only at or past the parent's
   content column, so every child rendered as a sibling: on the ASP page the
   caveat "Sessions that have passed will not sync into ASP" read as if it
   were a synced field of its own.

3. Screenshots at column 0 between two steps. A column-0 paragraph ends the
   list, so a procedure became one <ol> per step and the screenshot floated
   loose instead of belonging to the step it illustrates.

Only whitespace moves — no prose is rewritten. Re-runnable: repaired lists are
fixed points.
"""
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "src/content/docs"

MARKER = re.compile(r"^(\s*)([-*+]|\d+[.)])(\s+)(?=\S)")
FENCE = re.compile(r"^\s*(```|~~~)")
IMAGE = re.compile(r"^!\[[^\]]*\]\([^)]*\)\s*$")


def split_frontmatter(text: str) -> tuple[str, str]:
    """YAML sequences look exactly like markdown lists — never touch them."""
    m = re.match(r"^---\n.*?\n---\n", text, flags=re.S)
    return (m.group(0), text[m.end():]) if m else ("", text)


def strip_zero_width(lines: list[str]) -> tuple[list[str], int]:
    keep = [l for l in lines if not (l.strip("\u200b \t") == "" and "\u200b" in l)]
    return keep, len(lines) - len(keep)


def renest(lines: list[str]) -> tuple[list[str], int]:
    out: list[str] = []
    # Each frame: (original indent, new indent, new content column)
    stack: list[tuple[int, int, int]] = []
    shift = 0          # column delta to apply to the current item's continuations
    in_fence = False
    changed = 0

    for line in lines:
        if FENCE.match(line):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue

        m = MARKER.match(line)
        if m:
            indent, bullet = len(m.group(1)), m.group(2)
            content_col = len(m.group(0))

            while stack and indent < stack[-1][0]:
                stack.pop()

            # A child must start at its parent's content column, which is wider
            # for an ordered marker ("1. ") than a bullet ("- ").
            if stack and indent > stack[-1][0]:
                new_indent = stack[-1][2]
                stack.append((indent, new_indent, new_indent + len(bullet) + 1))
            elif stack:
                new_indent = stack[-1][1]
                stack[-1] = (indent, new_indent, new_indent + len(bullet) + 1)
            else:
                # Keep the outermost level where it is: a list inside a <Step>
                # or other JSX block is indented on purpose, and pulling it out
                # to column 0 would close the component early.
                new_indent = indent
                stack.append((indent, new_indent, indent + len(bullet) + 1))

            rebuilt = " " * new_indent + bullet + " " + line[content_col:]
            shift = (new_indent + len(bullet) + 1) - content_col
            if rebuilt != line:
                changed += 1
            out.append(rebuilt)
            continue

        if not line.strip():
            out.append(line)
            continue

        # A line indented past the innermost marker continues that item; one at
        # or left of the outermost marker ends the list entirely.
        indent = len(line) - len(line.lstrip())
        if stack and indent >= stack[-1][0] + 1:
            out.append(" " * max(0, indent + shift) + line.lstrip())
        elif stack and indent > stack[0][0]:
            out.append(line)
        else:
            stack.clear()
            shift = 0
            out.append(line)

    return out, changed


def adopt_step_images(lines: list[str]) -> tuple[list[str], int]:
    """Indent a screenshot that sits between two steps into the step above it."""
    out = list(lines)
    changed = 0
    in_fence = False
    in_list = False

    for i, line in enumerate(lines):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if MARKER.match(line):
            in_list = True
            continue
        if not line.strip():
            continue
        if in_list and IMAGE.match(line):
            # Only adopt the image if the list actually resumes below it.
            nxt = next((l for l in lines[i + 1:] if l.strip()), "")
            m = MARKER.match(nxt)
            if m and not IMAGE.match(nxt):
                out[i] = " " * len(m.group(0)) + line
                changed += 1
            continue
        # Any other block-level content ends the list.
        if len(line) - len(line.lstrip()) == 0:
            in_list = False

    return out, changed


def rejoin_orphaned_first_item(lines: list[str]) -> tuple[list[str], int]:
    """Pull a sub-list's first item back down to its siblings.

    Conversion left the opening item of a nested <ol> at the parent's level,
    so a procedure read "…2. Under Options, click Sync" and then restarted at
    "1." before continuing "2., 3." one level in. An item numbered 2 can never
    open a list, so a lone "1." followed by a deeper "2." is always this bug.
    """
    out = list(lines)
    changed = 0
    in_fence = False

    for i, line in enumerate(lines):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = MARKER.match(line)
        if not m or m.group(2) not in ("1.", "1)"):
            continue
        indent = len(m.group(1))

        nxt = next((MARKER.match(l) for l in lines[i + 1:] if MARKER.match(l)), None)
        if not nxt or nxt.group(2) not in ("2.", "2)"):
            continue
        deeper = len(nxt.group(1))
        if deeper <= indent:
            continue

        out[i] = " " * deeper + line.lstrip()
        changed += 1

    return out, changed


def main() -> None:
    write = "--write" in sys.argv
    totals = {"zwsp": 0, "nesting": 0, "images": 0, "orphans": 0}
    files = 0
    for f in sorted(DOCS.rglob("*.mdx")):
        original = f.read_text()
        frontmatter, body = split_frontmatter(original)
        lines = body.split("\n")
        lines, zwsp = strip_zero_width(lines)
        lines, nesting = renest(lines)
        lines, images = adopt_step_images(lines)
        lines, orphans = rejoin_orphaned_first_item(lines)
        fixed = frontmatter + "\n".join(lines)
        if fixed == original:
            continue
        files += 1
        totals["zwsp"] += zwsp
        totals["nesting"] += nesting
        totals["images"] += images
        totals["orphans"] += orphans
        print(f"  {f.relative_to(DOCS)}: {nesting} re-indented, "
              f"{images} image(s) adopted, {orphans} orphan(s), {zwsp} blank junk")
        if write:
            f.write_text(fixed)
    verb = "fixed" if write else "would fix"
    print(f"\n{verb} across {files} page(s): "
          f"{totals['nesting']} list lines re-indented, "
          f"{totals['images']} step screenshots adopted, "
          f"{totals['orphans']} orphaned sub-list openers rejoined, "
          f"{totals['zwsp']} zero-width-space lines removed")
    if not write:
        print("re-run with --write to apply")


if __name__ == "__main__":
    main()
