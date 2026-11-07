/**
 * Render the spec's Markdown descriptions to HTML at build time, with links to Mintlify
 * pages rewritten to their /api equivalents (same rules as the ported guides).
 */
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import spec from '../../data/api/openapi.json' with { type: 'json' };
import { operationIndex, rewriteHref } from './urls.mjs';

let processor;
const index = operationIndex(spec);
const cache = new Map();

export async function renderMarkdown(text) {
  if (!text) return '';
  if (cache.has(text)) return cache.get(text);
  processor ??= await createMarkdownProcessor({ syntaxHighlight: false, gfm: true, smartypants: false });
  const { code } = await processor.render(String(text));
  const html = code.replace(/href="(\/[^"]*)"/g, (m, href) => {
    const next = rewriteHref(href, index);
    return next ? `href="${next}"` : m;
  });
  cache.set(text, html);
  return html;
}
