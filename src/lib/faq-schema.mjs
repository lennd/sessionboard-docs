/**
 * FAQPage JSON-LD for /faq/* articles.
 *
 * Each article is one question (its title) plus the concise answer a reader
 * sees first. Pages that also contain real Q&A pairs — Accordion titles, or
 * headings that end with a question mark — add those too. The answer text is
 * the visible copy, with Markdown and components stripped, capped so a long
 * procedure does not become the whole schema answer.
 */

const MAX_ANSWER = 600;
const MIN_ANSWER = 24;
const SKIP_HEADING = /^(related|still stuck\??|why use it)$/i;

export function stripMarkdown(src) {
  return String(src || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*import\s+.+$/gm, ' ')
    .replace(/<Accordion\b[^>]*>/gi, ' ')
    .replace(/<\/Accordion>/gi, ' ')
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ')
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/[*_~`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function concise(text) {
  const clean = stripMarkdown(text);
  if (clean.length <= MAX_ANSWER) return clean;
  const slice = clean.slice(0, MAX_ANSWER);
  const stop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (stop >= 80) return slice.slice(0, stop + 1).trim();
  const space = slice.lastIndexOf(' ');
  return (space > 80 ? slice.slice(0, space) : slice).trim();
}

/** The first visible paragraph, skipping imports, components, and headings. */
export function firstProse(body) {
  const buf = [];
  for (const line of String(body || '').split('\n')) {
    const t = line.trim();
    if (!buf.length) {
      if (!t || t.startsWith('import ') || t.startsWith('<') || t.startsWith('#') || t.startsWith('---') || t.startsWith('![') || t.startsWith('|')) {
        continue;
      }
      buf.push(t);
      continue;
    }
    if (!t || t.startsWith('#') || t.startsWith('<') || t.startsWith('![') || t.startsWith('|') || t.startsWith('import ')) break;
    buf.push(t);
  }
  return buf.join(' ');
}

function pageAnswer(body, description) {
  const prose = firstProse(body);
  if (stripMarkdown(prose).length >= MIN_ANSWER) return prose;
  const desc = String(description || '').trim();
  if (desc.length >= MIN_ANSWER) return desc;
  return prose || desc;
}

export function faqMainEntity({ title, description, body }) {
  const source = String(body || '');
  const entities = [];
  const seen = new Set();
  const push = (name, text) => {
    const question = String(name || '').replace(/\s+/g, ' ').trim();
    const answer = concise(text);
    if (!question || answer.length < MIN_ANSWER) return;
    const key = question.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ name: question, text: answer });
  };

  push(title, pageAnswer(source, description));

  const accordion = /<Accordion\b[^>]*\btitle="([^"]+)"[^>]*>([\s\S]*?)<\/Accordion>/gi;
  for (const match of source.matchAll(accordion)) push(match[1], match[2]);

  const parts = source.split(/^(#{2,3}[ \t]+.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i].replace(/^#{2,3}[ \t]+/, '').trim();
    if (!heading.endsWith('?') || SKIP_HEADING.test(heading)) continue;
    push(heading, parts[i + 1] || '');
  }

  return entities;
}

export function faqPageNode({ slug, title, description, body, canonical }) {
  if (!slug || !String(slug).startsWith('faq/')) return null;
  const mainEntity = faqMainEntity({ title, description, body });
  if (!mainEntity.length) return null;
  return {
    '@type': 'FAQPage',
    '@id': `${canonical}#faq`,
    url: canonical,
    mainEntity: mainEntity.map((q) => ({
      '@type': 'Question',
      name: q.name,
      acceptedAnswer: { '@type': 'Answer', text: q.text },
    })),
  };
}
