/**
 * /api/llms.txt — the Platform API docs for agents (Mintlify served one at its root): every
 * guide and endpoint page, plus the OpenAPI spec. The site-wide /llms.txt
 * (starlight-llms-txt) already includes the guide pages but not the generated endpoints.
 */
import type { APIRoute } from 'astro';
import site from '../../../site.json';
import { apiProduct } from '../../lib/api-docs/data';
import { apiLlmsTxt } from '../../lib/api-docs/llms.mjs';

export const GET: APIRoute = () =>
  new Response(apiLlmsTxt(apiProduct('platform'), site.canonicalHost, 'Sessionboard Public API'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
