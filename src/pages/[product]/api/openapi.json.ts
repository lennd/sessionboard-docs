/** /sessionboard-<key>/api/openapi.json — one self-serve product's spec (built products only; never in public/). */
import type { APIRoute } from 'astro';
import { builtProducts } from '../../../lib/api-docs/data';
import { PLATFORM } from '../../../lib/api-docs/products.mjs';

export function getStaticPaths() {
  return builtProducts()
    .filter((P) => P.key !== PLATFORM)
    .map((P) => ({ params: { product: P.base.replace(/^\//, '').split('/')[0] }, props: { P } }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.P.spec, null, 2) + '\n', { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
