/**
 * /api/llms.txt — the Platform API docs for agents (Mintlify served one at its root): every
 * guide and endpoint page, plus the OpenAPI spec. The site-wide /llms.txt
 * (starlight-llms-txt) already includes the guide pages but not the generated endpoints.
 */
import type { APIRoute } from 'astro';
import site from '../../../site.json';
import { apiProduct } from '../../lib/api-docs/data';
import { apiLlmsTxt } from '../../lib/api-docs/llms.mjs';
// The public spec: signed-in-only operations (site.json signedInOnly.apiTags) left out.
import publicSpec from '../../data/api/openapi.public.json';
import { isStaffOnlySlug } from '../../lib/staff-only.mjs';

const platform = apiProduct('platform');
const guides = Object.fromEntries(Object.entries(platform.source?.guides ?? {}).filter(([route]) => !isStaffOnlySlug(route, site)));

export const GET: APIRoute = () =>
  new Response(apiLlmsTxt({ ...platform, spec: publicSpec, source: { ...platform.source, guides } }, site.canonicalHost, 'Sessionboard Public API'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
