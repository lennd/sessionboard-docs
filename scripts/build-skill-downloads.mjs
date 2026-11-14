#!/usr/bin/env node
/**
 * Public and signed-in copies of the skill downloads (postbuild, over dist/).
 *
 * public/skills/downloads/ holds every skill: the manifest (skills.json), one ZIP per
 * skill, the all-skills bundle and the three Claude plugins, packaged in
 * lennd/sessionboard-mcp-server. Some skills are restricted (their articles are in
 * site.json staffOnly / signedInOnly, src/lib/staff-only.mjs). This writes, under
 * dist/skills/downloads/:
 *
 *   _public/  skills.json and every bundle without any restricted skill (signed-out readers)
 *   _member/  the same without the staff-only skills (signed-in readers)
 *
 * worker.js serves the copy that matches the reader at the usual URLs; a restricted skill's
 * own ZIP answers like its article (src/lib/staff-only.mjs). A bundle README line naming a
 * removed skill (`(\`id\`)`) is dropped too.
 *
 * ZIP rewriting is done here without a dependency: kept entries are copied byte for byte
 * (their compressed data and CRC unchanged); a rewritten README is deflated again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { isSignedInOnlySlug, isStaffOnlySlug } from '../src/lib/staff-only.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));

/** Skill ids hidden from a reader of this tier: 'public' hides both tiers, 'member' the staff tier. */
export function hiddenSkills(ids, tier) {
  return new Set(ids.filter((id) => isStaffOnlySlug(`skills/${id}`, site) && (tier === 'public' || !isSignedInOnlySlug(`skills/${id}`, site))));
}

/** Parse a ZIP's central directory: [{ name, localOffset, cdRecord }]. */
function readEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory record');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const size = 46 + nameLen + extraLen + commentLen;
    entries.push({
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compSize: buf.readUInt32LE(p + 20),
      localOffset: buf.readUInt32LE(p + 42),
      cd: Buffer.from(buf.subarray(p, p + size)),
    });
    p += size;
  }
  return entries;
}

/** The local record (header + data) of an entry. */
function localRecord(buf, e) {
  const o = e.localOffset;
  if (buf.readUInt32LE(o) !== 0x04034b50) throw new Error(`bad local header for ${e.name}`);
  const len = 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28) + e.compSize;
  return Buffer.from(buf.subarray(o, o + len));
}

/**
 * A copy of the ZIP without entries `drop(name)` refuses, with `rewrite(name, text)` applied
 * to text entries it returns a new string for.
 */
export function filterZip(buf, { drop = () => false, rewrite = () => null } = {}) {
  const parts = [];
  const cds = [];
  let offset = 0;
  for (const e of readEntries(buf)) {
    if (drop(e.name)) continue;
    let local = localRecord(buf, e);
    let cd = e.cd;
    if (!e.name.endsWith('/') && (e.method === 0 || e.method === 8)) {
      const nameLen = local.readUInt16LE(26);
      const extraLen = local.readUInt16LE(28);
      const data = local.subarray(30 + nameLen + extraLen);
      const text = (e.method === 8 ? inflateRawSync(data) : data).toString('utf8');
      const next = rewrite(e.name, text);
      if (typeof next === 'string' && next !== text) {
        const raw = Buffer.from(next, 'utf8');
        const comp = e.method === 8 ? deflateRawSync(raw) : raw;
        const crc = crc32(raw) >>> 0;
        local = Buffer.concat([local.subarray(0, 30 + nameLen + extraLen), comp]);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(comp.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(local.readUInt16LE(6) & ~0x0008, 6); // sizes are in the header now
        cd = Buffer.from(cd);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(comp.length, 20);
        cd.writeUInt32LE(raw.length, 24);
        cd.writeUInt16LE(cd.readUInt16LE(8) & ~0x0008, 8);
      }
    }
    cd = Buffer.from(cd);
    cd.writeUInt32LE(offset, 42);
    parts.push(local);
    cds.push(cd);
    offset += local.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(cds.length, 8);
  eocd.writeUInt16LE(cds.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

/** ZIP entry names in a buffer (for tests and checks). */
export const zipNames = (buf) => readEntries(buf).map((e) => e.name);

/** A skill directory segment an entry belongs to (`<id>/SKILL.md`, `…/skills/<id>/…`). */
const entrySkill = (name, ids) => name.split('/').find((seg) => ids.has(seg)) ?? null;

export function buildVariants(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'skills.json'), 'utf8'));
  const ids = manifest.skills.map((s) => s.id);
  const bundles = [manifest.downloads?.bundle, ...Object.values(manifest.downloads?.plugins ?? {})].filter(Boolean);
  const written = [];
  for (const tier of ['public', 'member']) {
    const hidden = hiddenSkills(ids, tier);
    const out = join(dir, `_${tier}`);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'skills.json'), JSON.stringify({ ...manifest, skills: manifest.skills.filter((s) => !hidden.has(s.id)) }, null, 2) + '\n');
    for (const bundle of bundles) {
      const src = join(dir, bundle);
      if (!existsSync(src)) continue;
      const zip = filterZip(readFileSync(src), {
        drop: (name) => entrySkill(name, hidden) !== null,
        rewrite: (name, text) =>
          /readme\.md$/i.test(name) ? text.split('\n').filter((line) => ![...hidden].some((id) => line.includes(`\`${id}\``))).join('\n') : null,
      });
      writeFileSync(join(out, bundle), zip);
    }
    written.push(`${tier}: ${ids.length - hidden.size} of ${ids.length} skills`);
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(ROOT, 'dist/skills/downloads');
  if (!existsSync(join(dir, 'skills.json'))) {
    console.error('No dist/skills/downloads/skills.json — run `npm run build` first.');
    process.exit(1);
  }
  console.log(`Skill downloads: ${buildVariants(dir).join('; ')}`);
}
