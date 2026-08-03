#!/usr/bin/env python3
"""Download externally hosted (HubSpot CDN) images into public/images/kb/
and rewrite MDX references to local paths.

Re-runnable: skips downloads that already exist; only rewrites matched URLs.
"""
import concurrent.futures
import hashlib
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'src/content/docs')
OUT = os.path.join(ROOT, 'public/images/kb')

# Non-greedy so a filename containing parentheses (e.g. "Foo (3).png") is
# captured without swallowing the closing markdown paren after the extension.
URL_RE = re.compile(r'https://[^\s"\']+?\.(?:png|jpg|jpeg|gif|webp)(?:\?[^)\s"\']*)?')
HOSTS = ('hubspotusercontent', 'learn.sessionboard.com', 'slack-edge.com')


def local_name(url: str) -> str:
    h = hashlib.sha1(url.encode()).hexdigest()[:8]
    base = urllib.parse.unquote(urllib.parse.urlparse(url).path.rsplit('/', 1)[-1])
    base = re.sub(r'[^A-Za-z0-9._-]+', '-', base)[-80:]
    return f'{h}-{base}'


def download(url: str) -> tuple[str, str | None]:
    name = local_name(url)
    dest = os.path.join(OUT, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return url, name
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'sessionboard-docs-rehost'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        if not data:
            return url, None
        with open(dest, 'wb') as f:
            f.write(data)
        return url, name
    except Exception as e:
        print(f'FAIL {url} -> {e}', file=sys.stderr)
        return url, None


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    files = {}
    urls = set()
    for dirpath, _, names in os.walk(DOCS):
        for fn in names:
            if not fn.endswith('.mdx'):
                continue
            p = os.path.join(dirpath, fn)
            s = open(p).read()
            found = [u for u in URL_RE.findall(s) or [] ]
            # findall with groups returns groups; use finditer instead
            found = [m.group(0) for m in URL_RE.finditer(s) if any(h in m.group(0) for h in HOSTS)]
            if found:
                files[p] = s
                urls.update(found)

    print(f'{len(urls)} unique external images across {len(files)} files')
    mapping = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for url, name in pool.map(download, sorted(urls)):
            if name:
                mapping[url] = f'/images/kb/{name}'

    failed = urls - set(mapping)
    rewritten = 0
    for p, s in files.items():
        s2 = s
        for url, local in mapping.items():
            s2 = s2.replace(url, local)
        if s2 != s:
            open(p, 'w').write(s2)
            rewritten += 1
    print(f'downloaded {len(mapping)}, failed {len(failed)}, rewrote {rewritten} files')
    for u in sorted(failed):
        print('UNRESOLVED:', u)


if __name__ == '__main__':
    main()
