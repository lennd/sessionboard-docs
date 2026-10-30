/**
 * The product's deep-link table (`app:` markers), for the signed-in header
 * script (src/scripts/account.mjs) to resolve links against the reader's chosen
 * event or org. Served on its own so ordinary page loads never carry it.
 */
import contract from '../data/product-contract.json';

export const prerender = true;

export function GET() {
  return new Response(JSON.stringify(contract.appRoutes ?? {}), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
