#!/usr/bin/env node
/**
 * Submit every public Help Center URL to IndexNow (Bing, Yandex, Seznam, Naver share one
 * endpoint). Docs CI runs it after each publish (Josh, 2026-11-14: automate submissions);
 * Google reads the sitemap on its own.
 *
 * The key is the one public/<32 hex>.txt file, served at https://<host>/<key>.txt, which
 * IndexNow fetches to prove we own the host (the same key www.sessionboard.com uses). URLs
 * come from the live sitemap, so restricted pages (never in it) are never submitted.
 *
 *   node scripts/indexnow-submit.mjs            # submit
 *   node scripts/indexnow-submit.mjs --dry-run  # print what would be sent
 *
 * Responses: 200 OK, 202 accepted (key check pending), 403 key not verified yet,
 * 422 URLs not on the host, 429 too many requests.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));
const HOST = site.canonicalHost;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH = 10000;

function readKey() {
  const keys = readdirSync(join(ROOT, 'public')).filter((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (keys.length !== 1) throw new Error(`expected one <32 hex>.txt key in public/, found ${keys.length}`);
  const key = readFileSync(join(ROOT, 'public', keys[0]), 'utf8').trim();
  if (`${key}.txt` !== keys[0]) throw new Error(`${keys[0]} must contain its own name`);
  return key;
}

async function sitemapUrls(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (/<sitemapindex/.test(xml)) return (await Promise.all(locs.map(sitemapUrls))).flat();
  return locs;
}

const dryRun = process.argv.includes('--dry-run');
const key = readKey();
const urls = [...new Set(await sitemapUrls(`https://${HOST}/sitemap-index.xml`))].filter((u) => u.startsWith(`https://${HOST}/`));
console.log(`${urls.length} URL(s) for ${HOST}`);
let failed = false;
for (let i = 0; i < urls.length; i += BATCH) {
  const urlList = urls.slice(i, i + BATCH);
  if (dryRun) {
    console.log(`[dry-run] ${urlList.length} URL(s), first ${urlList[0]}`);
    continue;
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList }),
  });
  console.log(`POST ${ENDPOINT} urls=${urlList.length} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  if (res.status >= 300) failed = true;
}
process.exit(failed ? 1 : 0);
