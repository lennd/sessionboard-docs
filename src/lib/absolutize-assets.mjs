/**
 * Rewrite root-relative asset URLs in article HTML to absolute ones on the
 * canonical host.
 *
 * On this site `/images/kb/foo.png` resolves against the docs origin and is
 * correct. In the machine index it is a trap: the index exists to be rendered
 * somewhere else — the in-app reader, a Team Lead citation, a support reply —
 * where the same path resolves against that consumer's origin and 404s. The
 * screenshots then fail silently, one broken image at a time, in exactly the
 * content that depends on them most.
 *
 * ASSETS ONLY. Anchor hrefs stay relative on purpose: the reader treats a
 * root-relative href as another help article and navigates to it in-app, so
 * absolutizing links would push readers out to the public site mid-task.
 *
 * The host is passed in rather than read here, because site.json is the one
 * place that knows it.
 */

const ASSET_TAGS = /<(img|source|video|audio)\b([^>]*)>/gi;
const URL_ATTRS = /\b(src|poster)=(["'])(.*?)\2/gi;
const SRCSET_ATTR = /\bsrcset=(["'])(.*?)\1/gi;

/** Root-relative → absolute. Protocol-relative and absolute URLs are left alone. */
const absolutize = (value, origin) =>
  value.startsWith('/') && !value.startsWith('//') ? origin + value : value;

/** srcset is a comma-separated list of "url descriptor" candidates. */
const absolutizeSrcset = (value, origin) =>
  value
    .split(',')
    .map(candidate => {
      const trimmed = candidate.trim();
      if (!trimmed) return null;
      const [url, ...descriptor] = trimmed.split(/\s+/);
      return [absolutize(url, origin), ...descriptor].join(' ');
    })
    .filter(Boolean)
    .join(', ');

/**
 * @param {string} html - rendered article HTML
 * @param {string} host - canonical host, e.g. `learn.sessionboard.com`
 * @returns {string}
 */
export function absolutizeAssets(html, host) {
  if (!html || !host) return html;
  const origin = `https://${host}`;

  return html.replace(ASSET_TAGS, (_tag, name, attrs) => {
    const rewritten = attrs
      .replace(
        URL_ATTRS,
        (_m, attr, quote, value) =>
          `${attr}=${quote}${absolutize(value, origin)}${quote}`,
      )
      .replace(
        SRCSET_ATTR,
        (_m, quote, value) =>
          `srcset=${quote}${absolutizeSrcset(value, origin)}${quote}`,
      );
    return `<${name}${rewritten}>`;
  });
}
