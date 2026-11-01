#!/usr/bin/env node
/**
 * Mint a Help Center guest link for someone outside Sessionboard.
 *
 *   GUEST_LINK_SECRET=… node scripts/guest-link.mjs <label> [days=180] [return=/]
 *
 * The secret is the Worker's GUEST_LINK_SECRET (`npx wrangler secret put
 * GUEST_LINK_SECRET`); read it from the environment, never paste it on the
 * command line. The label names who the link is for (letters, digits, `-`,
 * `_`) and ends up in the session cookie as `guest-<label>`, so a visit can be
 * told apart from a customer's in logs. A guest sees the customer Help Center
 * only — never the staff-only sections — and the header shows no account.
 * Rotating GUEST_LINK_SECRET revokes every link ever minted.
 *
 * Prints the full URL on the canonical host and nothing else.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { GUEST_PATH, signGuestLink } from '../src/lib/account-session.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const site = JSON.parse(readFileSync(path.join(root, 'site.json'), 'utf8'));

const [label, daysArg = '180', returnArg = '/'] = process.argv.slice(2);
const secret = process.env.GUEST_LINK_SECRET;
const days = Number(daysArg);
if (!label || !secret || !Number.isFinite(days) || days <= 0) {
  console.error('usage: GUEST_LINK_SECRET=… node scripts/guest-link.mjs <label> [days=180] [return=/]');
  process.exit(2);
}

const token = await signGuestLink(secret, label, Math.round(days * 24 * 60 * 60));
const url = new URL(GUEST_PATH, `https://${site.canonicalHost}`);
url.searchParams.set('t', token);
if (returnArg && returnArg !== '/') url.searchParams.set('return', returnArg);
console.log(url.toString());
