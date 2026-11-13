/** llms.txt for one product's API docs: its guides, every endpoint, and its spec. */
import { listOperations } from './urls.mjs';

export function apiLlmsTxt(P, host, title) {
  const base = `https://${host}`;
  const spec = P.spec;
  const lines = [
    `# ${title}`,
    '',
    `> ${spec.info?.description ?? 'REST API for Sessionboard.'} Base URLs: ${(spec.servers || []).map((s) => `${s.url} (${s.description})`).join(', ')}.`,
    '',
    `- [OpenAPI spec (JSON)](${base}${P.base}/openapi.json)`,
    '',
    '## Guides',
    '',
    ...Object.entries(P.source?.guides ?? {}).map(([route, g]) => `- [${g.title}](${base}/${route})`),
  ];
  const byTag = new Map();
  for (const o of listOperations(spec, P.base)) {
    const list = byTag.get(o.tag) ?? [];
    list.push(`- [${o.summary}](${base}${o.href}): ${o.method.toUpperCase()} ${o.path}`);
    byTag.set(o.tag, list);
  }
  lines.push('', '## API reference');
  for (const [tag, list] of byTag) lines.push('', `### ${tag}`, '', ...list);
  return lines.join('\n') + '\n';
}
