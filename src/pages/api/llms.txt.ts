/**
 * /api/llms.txt — the API Docs tab for agents (Mintlify served one at its root): every
 * guide and endpoint page, plus the raw OpenAPI spec. The site-wide /llms.txt
 * (starlight-llms-txt) already includes the guide pages but not the generated endpoints.
 */
import type { APIRoute } from 'astro';
import site from '../../../site.json';
import spec from '../../data/api/openapi.json';
import source from '../../data/api/source.json';
import { listOperations } from '../../lib/api-docs/urls.mjs';

export const GET: APIRoute = () => {
  const base = `https://${site.canonicalHost}`;
  const lines = [
    '# Sessionboard Public API',
    '',
    `> ${spec.info?.description ?? 'REST API for Sessionboard.'} Base URLs: ${(spec.servers || []).map((s: { url: string; description?: string }) => `${s.url} (${s.description})`).join(', ')}.`,
    '',
    `- [OpenAPI spec (YAML)](${base}/api/openapi.yaml)`,
    `- [OpenAPI spec (JSON)](${base}/api/openapi.json)`,
    '',
    '## Guides',
    '',
    ...Object.entries(source.guides as Record<string, { title: string }>).map(([route, g]) => `- [${g.title}](${base}/${route})`),
  ];
  const byTag = new Map<string, string[]>();
  for (const o of listOperations(spec)) {
    const list = byTag.get(o.tag) ?? [];
    list.push(`- [${o.summary}](${base}${o.href}): ${o.method.toUpperCase()} ${o.path}`);
    byTag.set(o.tag, list);
  }
  lines.push('', '## API reference');
  for (const [tag, list] of byTag) lines.push('', `### ${tag}`, '', ...list);
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
