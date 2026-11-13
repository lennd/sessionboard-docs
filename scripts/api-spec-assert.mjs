#!/usr/bin/env node
/**
 * Asserts facts about the published spec that were corrected after being
 * found to contradict the live API. Each entry names the ticket that measured
 * the behaviour, so a later edit that quietly reverts one fails here with the
 * reason instead of shipping.
 *
 * This is not a schema validator. It only pins the specific claims, and it
 * reads the YAML (api-spec/openapi.yaml), which is the source of truth;
 * `npm run api:check` proves the generated JSON matches.
 *
 * Moved from lennd/sessionboard-public-api-docs (retired 2026-11) with the spec.
 *
 * Usage:
 *   npm run api:assert   (also part of npm run api:check)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = yaml.load(
  readFileSync(join(root, 'api-spec', 'openapi.yaml'), 'utf8')
);

const failures = [];
const check = (label, ok) => {
  if (!ok) failures.push(label);
};

const op = (path, method) => {
  const found = spec.paths[path] && spec.paths[path][method];
  if (!found) throw new Error(`no ${method.toUpperCase()} ${path} in the spec`);
  return found;
};

// ── SB-8973 ────────────────────────────────────────────────────────────────
// The five categorization filters are one shared Joi schema in
// sessionboard-public-api (routes/utils/session-attribute-filters.js), and it
// carries `.min(1)`. `[]` is a 400 on all three operations, so the spec has to
// say minItems: 1 or a generated client emits a request the API refuses.
const CATEGORIZATION = [
  'trackIds',
  'levelIds',
  'formatIds',
  'languageIds',
  'tagIds'
];

const filterProps = schema => schema.properties.filters.properties;

const sessionsStatusBody =
  op('/v1/event/{eventId}/sessions/status', 'post').requestBody.content[
    'application/json'
  ].schema;

const bodies = {
  'inline /sessions/status body': filterProps(sessionsStatusBody),
  SessionSearchBody: filterProps(spec.components.schemas.SessionSearchBody),
  SpeakerSearchBody: filterProps(spec.components.schemas.SpeakerSearchBody),
  // SB-9212: Participants carries every Speakers filter with the same schema.
  ParticipantSearchBody: filterProps(
    spec.components.schemas.ParticipantSearchBody
  )
};

// SB-9212: `roleIds` shares uuidArraySchema too, so `[]` is a 400 there as well.
check(
  'SB-9212: ParticipantSearchBody.roleIds declares minItems: 1',
  filterProps(spec.components.schemas.ParticipantSearchBody).roleIds
    .minItems === 1
);

for (const [name, props] of Object.entries(bodies)) {
  for (const field of CATEGORIZATION) {
    check(
      `SB-8973: ${name}.${field} declares minItems: 1`,
      props[field] && props[field].minItems === 1
    );
  }
}

// `sessionIds` shares the same uuidArraySchema, so it is refused empty too.
check(
  'SB-8973: SessionSearchBody.sessionIds declares minItems: 1',
  filterProps(spec.components.schemas.SessionSearchBody).sessionIds.minItems ===
    1
);

// ── SB-9003 / SB-9006 ──────────────────────────────────────────────────────
// The group deletes answer 204 with no body, not the 200 this page used to
// document, and they soft-delete the underlying group — taking the other role
// and every other event with it.
for (const [path, role, other] of [
  ['/v1/event/{eventId}/sponsors/{sponsorId}', 'sponsor', 'exhibitor'],
  ['/v1/event/{eventId}/exhibitors/{exhibitorId}', 'exhibitor', 'sponsor']
]) {
  const del = op(path, 'delete');
  check(`SB-9006: DELETE ${role} documents 204`, Boolean(del.responses['204']));
  check(
    `SB-9006: DELETE ${role} no longer documents 200`,
    !del.responses['200']
  );
  check(
    `SB-9003: DELETE ${role} says the ${other} role goes too`,
    new RegExp(`${other}`, 'i').test(del.description)
  );
  check(
    `SB-9003: DELETE ${role} says other events are affected`,
    /other events/i.test(del.description)
  );

  const restorePath = `${path}/restore`;
  const restore = op(restorePath, 'post');
  check(
    `SB-9003: restore ${role} describes the same reach`,
    /both roles|every event/i.test(restore.description)
  );
  check(
    `SB-9006: restore ${role} documents the 400 for a record that is not deleted`,
    Boolean(restore.responses['400'])
  );
  check(
    `SB-9003: restore ${role} 404 text is not truncated mid-sentence`,
    !/\. or not deleted/.test(restore.responses['404'].description)
  );
}

// ── SB-9006 ────────────────────────────────────────────────────────────────
// Every bulk endpoint returns the aggregate counts as `summary`; the page
// named it `stats`.
const bulk = spec.components.schemas.BulkResponse;
check('SB-9006: BulkResponse names the totals object summary', Boolean(bulk.properties.summary));
check('SB-9006: BulkResponse no longer names it stats', !bulk.properties.stats);

// ── SB-9126 ────────────────────────────────────────────────────────────────
// A dropdown TYPE_MISMATCH lists the field's options. Joined with commas, an
// option whose own label holds a comma read as several options, so the error
// object carries them as an array and the spec has to say so.
const bulkErrorObject = bulk.properties.results.items.properties.error.oneOf.find(
  s => s.type === 'object'
);
const validOptions = bulkErrorObject.properties.valid_options;
check(
  'SB-9126: bulk error object documents valid_options as a string array',
  Boolean(validOptions) &&
    validOptions.type === 'array' &&
    validOptions.items.type === 'string'
);
check(
  'SB-9126: valid_options is scoped to TYPE_MISMATCH',
  Boolean(validOptions) && /TYPE_MISMATCH/.test(validOptions.description)
);
check(
  'SB-9126: the example carries an option that contains a comma',
  Array.isArray(bulkErrorObject.example?.valid_options) &&
    bulkErrorObject.example.valid_options.some(o => o.includes(','))
);
check(
  'SB-9126: the bulk error object has no camelCase validOptions key',
  !('validOptions' in bulkErrorObject.properties) &&
    !('validOptions' in (bulkErrorObject.example || {}))
);

// ── SB-9710 ────────────────────────────────────────────────────────────────
// A log event's `stream` is the stream definition's name in web-api
// (lib/log-export/streams/*.js), not the URL segment: `/v1/logs/audit-trail`
// returns "audit". A SIEM filter built from the URL segment matches nothing.
const LOG_STREAMS = ['api_request', 'security_event', 'audit'];
const streamEnum = spec.components.schemas.LogEvent.properties.stream.enum;
check(
  'SB-9710: LogEvent.stream lists the values the API returns',
  JSON.stringify([...streamEnum].sort()) === JSON.stringify([...LOG_STREAMS].sort())
);
const siemGuide = readFileSync(
  join(root, 'src', 'content', 'docs', 'api', 'guides', 'exporting-logs-to-a-siem.mdx'),
  'utf8'
);
const guideStreams = [...siemGuide.matchAll(/"stream":\s*"([^"]+)"/g)].map(m => m[1]);
check(
  'SB-9710: the SIEM guide example uses a real stream value',
  guideStreams.length > 0 && guideStreams.every(s => LOG_STREAMS.includes(s))
);

if (failures.length) {
  console.error('Spec contract assertions failed:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log('Spec contract assertions passed.');
