/** /sessionboard-<key>/api/llms.txt — one self-serve product's API docs for agents (built products only). */
import type { APIRoute } from 'astro';
import site from '../../../../site.json';
import { builtProducts } from '../../../lib/api-docs/data';
import { PLATFORM } from '../../../lib/api-docs/products.mjs';
import { apiLlmsTxt } from '../../../lib/api-docs/llms.mjs';

export function getStaticPaths() {
  return builtProducts()
    .filter((P) => P.key !== PLATFORM)
    .map((P) => ({ params: { product: P.base.replace(/^\//, '').split('/')[0] }, props: { P } }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(apiLlmsTxt(props.P, site.canonicalHost, `Sessionboard ${props.P.label} API`), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
