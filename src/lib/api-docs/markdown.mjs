/**
 * Render the spec's Markdown descriptions to HTML at build time, with links to Mintlify
 * pages rewritten to their Help Center equivalents (same rules as the ported guides).
 * `index` is the product's operation index; `fallback` Platform's.
 */
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { rewriteHref } from './urls.mjs';

let processor;
const cache = new Map();

export async function renderMarkdown(text, { index, fallback = null, registry = null } = {}) {
  if (!text) return '';
  const key = `${index?.ops?.[0]?.href ?? ''}\u0000${text}`;
  if (cache.has(key)) return cache.get(key);
  processor ??= await createMarkdownProcessor({ syntaxHighlight: false, gfm: true, smartypants: false });
  const { code } = await processor.render(String(text));
  const html = index
    ? code.replace(/href="(\/[^"]*)"/g, (m, href) => {
        const next = rewriteHref(href, index, { registry, fallback });
        return next ? `href="${next}"` : m;
      })
    : code;
  cache.set(key, html);
  return html;
}
