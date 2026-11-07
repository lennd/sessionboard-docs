/**
 * Reading the synced OpenAPI 3.1 spec (src/data/api/openapi.json) for the endpoint pages:
 * $ref resolution, parameter and schema shapes, generated examples and code samples.
 * Only local refs (#/components/...) occur in the spec; anything else is shown as-is.
 */

export function refName(ref) {
  return typeof ref === 'string' ? ref.split('/').pop() : null;
}

export function resolveRef(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node, key) => (node == null ? node : node[key]), spec);
}

/** Follow $ref chains on a node. Returns { node, name } where name is the last ref's name. */
export function deref(spec, node) {
  let name = null;
  const seen = new Set();
  while (node && node.$ref && !seen.has(node.$ref)) {
    seen.add(node.$ref);
    name = refName(node.$ref);
    const target = resolveRef(spec, node.$ref);
    // Sibling keys next to a $ref (description, nullable...) override the target's.
    const { $ref, ...rest } = node;
    node = target ? { ...target, ...rest } : rest;
  }
  return { node: node || {}, name };
}

/** Merge allOf members into one object schema (properties, required, description). */
export function flatten(spec, schema, depth = 0) {
  const { node, name } = deref(spec, schema);
  if (!node.allOf || depth > 8) return { schema: node, name };
  const merged = { ...node, properties: { ...(node.properties || {}) }, required: [...(node.required || [])] };
  delete merged.allOf;
  for (const part of node.allOf) {
    const { schema: p } = flatten(spec, part, depth + 1);
    if (p.type && !merged.type) merged.type = p.type;
    Object.assign(merged.properties, p.properties || {});
    merged.required.push(...(p.required || []));
    if (!merged.description && p.description) merged.description = p.description;
    if (p.items && !merged.items) merged.items = p.items;
    if (p.enum && !merged.enum) merged.enum = p.enum;
  }
  if (!Object.keys(merged.properties).length) delete merged.properties;
  return { schema: merged, name };
}

/** Human type label: "string", "integer<int64>", "Session[]", "string | null". */
export function typeLabel(spec, schema) {
  const { schema: s, name } = flatten(spec, schema);
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const nullable = types.includes('null') || s.nullable === true;
  const main = types.filter((t) => t !== 'null');
  let label;
  if (s.oneOf || s.anyOf) {
    label = (s.oneOf || s.anyOf).map((v) => typeLabel(spec, v)).join(' | ');
  } else if (main[0] === 'array' || s.items) {
    label = `${typeLabel(spec, s.items || {})}[]`;
  } else if (main.length) {
    label = main.join(' | ');
    if (s.format) label += `<${s.format}>`;
    if (name && main[0] === 'object') label = name;
  } else if (name) {
    label = name;
  } else if (s.properties) {
    label = 'object';
  } else {
    label = 'any';
  }
  return nullable && !label.includes('null') ? `${label} | null` : label;
}

/** Child properties to render under a schema (objects, arrays of objects, first oneOf). */
export function childProperties(spec, schema) {
  let { schema: s } = flatten(spec, schema);
  if (s.items) s = flatten(spec, s.items).schema;
  if (!s.properties && (s.oneOf || s.anyOf)) {
    const variants = (s.oneOf || s.anyOf).map((v) => flatten(spec, v).schema).filter((v) => v.properties);
    if (variants.length) s = variants[0];
  }
  if (!s.properties) return [];
  const required = new Set(s.required || []);
  return Object.entries(s.properties).map(([name, prop]) => ({ name, schema: prop, required: required.has(name) }));
}

/** oneOf / anyOf alternatives (on the schema or its array items), each with its own fields. */
export function variants(spec, schema) {
  let { schema: s } = flatten(spec, schema);
  if (s.items) s = flatten(spec, s.items).schema;
  const list = s.oneOf || s.anyOf;
  if (!list) return [];
  const real = list.filter((v) => {
    const t = flatten(spec, v).schema.type;
    return t !== 'null' && !(Array.isArray(t) && t.length === 1 && t[0] === 'null');
  });
  return real.map((v, i) => {
    const { schema: vs, name } = flatten(spec, v);
    return { label: `Option ${i + 1}`, name, description: vs.description, type: typeLabel(spec, v), fields: childProperties(spec, v) };
  });
}

/** Facts worth a line under a field: enum, default, format bounds, example. */
export function schemaFacts(spec, schema) {
  const { schema: s } = flatten(spec, schema);
  const base = s.items ? flatten(spec, s.items).schema : s;
  const facts = [];
  const enumValues = base.enum ?? s.enum;
  if (enumValues) facts.push(['Allowed values', enumValues.map((v) => JSON.stringify(v)).join(', ')]);
  if (s.default !== undefined) facts.push(['Default', JSON.stringify(s.default)]);
  for (const [k, label] of [
    ['minimum', 'Minimum'],
    ['maximum', 'Maximum'],
    ['minLength', 'Min length'],
    ['maxLength', 'Max length'],
    ['minItems', 'Min items'],
    ['maxItems', 'Max items'],
    ['pattern', 'Pattern'],
  ])
    if (s[k] !== undefined) facts.push([label, String(s[k])]);
  if (s.example !== undefined && typeof s.example !== 'object') facts.push(['Example', JSON.stringify(s.example)]);
  return facts;
}

/** Operation parameters (path-item + operation level), resolved, grouped by location. */
export function parameters(spec, item, op) {
  const byKey = new Map();
  for (const p of [...(item.parameters || []), ...(op.parameters || [])]) {
    const { node } = deref(spec, p);
    byKey.set(`${node.in}:${node.name}`, node);
  }
  const groups = { path: [], query: [], header: [], cookie: [] };
  for (const p of byKey.values()) (groups[p.in] ||= []).push(p);
  return groups;
}

export function requestBody(spec, op) {
  if (!op.requestBody) return null;
  const { node } = deref(spec, op.requestBody);
  const [contentType, media] = Object.entries(node.content || {})[0] || [];
  if (!contentType) return null;
  return { contentType, required: !!node.required, description: node.description, schema: media.schema, media };
}

export function responses(spec, op) {
  return Object.entries(op.responses || {}).map(([status, r]) => {
    const { node } = deref(spec, r);
    const [contentType, media] = Object.entries(node.content || {})[0] || [];
    return { status, description: node.description || '', contentType, schema: media?.schema, media, headers: node.headers };
  });
}

// ---------------------------------------------------------------- examples

function placeholder(s, name) {
  if (s.format === 'uuid') return '3c90c3cc-0d44-4b50-8888-8dd25736052a';
  if (s.format === 'date-time') return '2026-01-15T09:30:00Z';
  if (s.format === 'date') return '2026-01-15';
  if (s.format === 'email') return 'jane@example.com';
  if (s.format === 'uri' || s.format === 'url') return 'https://example.com';
  if (/(^|_)id$|Id$/.test(name || '')) return '<string>';
  return '<string>';
}

/** An example value for a schema: its example, then default, enum, then a placeholder. */
export function exampleFor(spec, schema, name = '', depth = 0, seen = new Set()) {
  if (!schema || depth > 7) return null;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return {};
    seen = new Set(seen).add(schema.$ref);
  }
  const { schema: s } = flatten(spec, schema);
  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.enum?.length) return s.enum.find((v) => v !== null) ?? s.enum[0];
  if (s.oneOf || s.anyOf) return exampleFor(spec, (s.oneOf || s.anyOf)[0], name, depth + 1, seen);
  const types = Array.isArray(s.type) ? s.type.filter((t) => t !== 'null') : [s.type];
  const t = types[0] || (s.properties ? 'object' : s.items ? 'array' : undefined);
  switch (t) {
    case 'object': {
      const out = {};
      for (const [k, v] of Object.entries(s.properties || {})) out[k] = exampleFor(spec, v, k, depth + 1, seen);
      if (!s.properties && s.additionalProperties && typeof s.additionalProperties === 'object') out.key = exampleFor(spec, s.additionalProperties, 'key', depth + 1, seen);
      return out;
    }
    case 'array':
      return s.items ? [exampleFor(spec, s.items, name, depth + 1, seen)] : [];
    case 'integer':
      return s.minimum ?? 123;
    case 'number':
      return s.minimum ?? 123.45;
    case 'boolean':
      return true;
    case 'string':
      return placeholder(s, name);
    default:
      return null;
  }
}

/** Named examples for a media object: explicit examples first, else one generated from the schema. */
export function mediaExamples(spec, media, schema) {
  if (media?.examples && Object.keys(media.examples).length) {
    return Object.entries(media.examples).map(([key, ex]) => {
      const { node } = deref(spec, ex);
      return { label: node.summary || key, value: node.value };
    });
  }
  if (media?.example !== undefined) return [{ label: 'Example', value: media.example }];
  if (schema) return [{ label: 'Example', value: exampleFor(spec, schema) }];
  return [];
}

// ---------------------------------------------------------------- code samples

export function authOf(spec, op) {
  const sec = op.security ?? spec.security ?? [];
  const names = sec.flatMap((s) => Object.keys(s));
  if (!names.length) return { kind: 'none' };
  const schemes = spec.components?.securitySchemes || {};
  const first = schemes[names[0]];
  if (first?.type === 'apiKey') return { kind: 'apiKey', header: first.name, also: names.slice(1).map((n) => schemes[n]) };
  if (first?.type === 'http') return { kind: 'bearer' };
  return { kind: 'none' };
}

/** Build the sample request once: URL with path params as placeholders and required query params. */
export function sampleRequest(spec, o) {
  const params = parameters(spec, o.item, o.op);
  const server = spec.servers?.[0]?.url || '';
  const url = server + o.path;
  const query = params.query.filter((p) => p.required).map((p) => [p.name, String(exampleFor(spec, p.schema || {}, p.name) ?? '')]);
  const body = requestBody(spec, o.op);
  const bodyExample = body ? mediaExamples(spec, body.media, body.schema)[0]?.value : undefined;
  const auth = authOf(spec, o.op);
  const headers = [];
  if (auth.kind === 'apiKey') headers.push([auth.header, '<api-token>']);
  if (auth.kind === 'bearer') headers.push(['Authorization', 'Bearer <access-token>']);
  for (const p of params.header) if (p.required) headers.push([p.name, `<${p.name}>`]);
  if (body && body.contentType === 'application/json') headers.push(['Content-Type', 'application/json']);
  const form = body && body.contentType === 'application/x-www-form-urlencoded';
  return { method: o.method.toUpperCase(), url, query, headers, body: bodyExample, form };
}

const qs = (query) => (query.length ? '?' + query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '');
const json = (v, indent = 2) => JSON.stringify(v, null, indent);
const indentAll = (text, pad) => text.split('\n').map((l, i) => (i ? pad + l : l)).join('\n');

export function codeSamples(r) {
  const fullUrl = r.url + qs(r.query);
  const hasBody = r.body !== undefined;
  const formBody = hasBody && r.form ? new URLSearchParams(Object.entries(r.body || {}).map(([k, v]) => [k, String(v)])).toString() : null;
  const bodyText = hasBody ? (formBody ?? json(r.body)) : null;
  const headers = r.form && hasBody ? [...r.headers, ['Content-Type', 'application/x-www-form-urlencoded']] : r.headers;

  const curl = [`curl --request ${r.method} \\`, `  --url '${fullUrl}'${headers.length || hasBody ? ' \\' : ''}`];
  headers.forEach(([k, v], i) => curl.push(`  --header '${k}: ${v}'${i < headers.length - 1 || hasBody ? ' \\' : ''}`));
  if (hasBody) curl.push(`  --data '${bodyText.replace(/'/g, "'\\''")}'`);

  const jsHeaders = headers.length ? `\n  headers: ${indentAll(json(Object.fromEntries(headers)), '  ')},` : '';
  const jsBody = hasBody ? `\n  body: ${formBody ? `'${formBody}'` : `JSON.stringify(${indentAll(json(r.body), '  ')})`},` : '';
  const js = `const response = await fetch('${fullUrl}', {\n  method: '${r.method}',${jsHeaders}${jsBody}\n});\n\nconst data = await response.json();\nconsole.log(data);`;

  const pyArgs = [`    "${r.url}"`];
  if (r.query.length) pyArgs.push(`    params=${json(Object.fromEntries(r.query), 4).replace(/\n/g, '\n    ')}`);
  if (headers.length) pyArgs.push(`    headers=${json(Object.fromEntries(headers), 4).replace(/\n/g, '\n    ')}`);
  if (hasBody) pyArgs.push(formBody ? `    data=${json(r.body, 4).replace(/\n/g, '\n    ')}` : `    json=${toPython(r.body).replace(/\n/g, '\n    ')}`);
  const python = `import requests\n\nresponse = requests.request(\n    "${r.method}",\n${pyArgs.join(',\n')},\n)\n\nprint(response.json())`;

  const phpHeaders = headers.map(([k, v]) => `        "${k}: ${v}",`).join('\n');
  const php = [
    '<?php',
    '',
    '$curl = curl_init();',
    '',
    'curl_setopt_array($curl, [',
    `    CURLOPT_URL => "${fullUrl}",`,
    '    CURLOPT_RETURNTRANSFER => true,',
    `    CURLOPT_CUSTOMREQUEST => "${r.method}",`,
    hasBody ? `    CURLOPT_POSTFIELDS => '${bodyText.replace(/'/g, "\\'")}',` : null,
    headers.length ? `    CURLOPT_HTTPHEADER => [\n${phpHeaders}\n    ],` : null,
    ']);',
    '',
    '$response = curl_exec($curl);',
    'curl_close($curl);',
    '',
    'echo $response;',
  ]
    .filter((l) => l !== null)
    .join('\n');

  const goBody = hasBody ? `strings.NewReader(\`${bodyText}\`)` : 'nil';
  const go = [
    'package main',
    '',
    'import (',
    '\t"fmt"',
    '\t"io"',
    '\t"net/http"',
    hasBody ? '\t"strings"' : null,
    ')',
    '',
    'func main() {',
    `\treq, _ := http.NewRequest("${r.method}", "${fullUrl}", ${goBody})`,
    ...headers.map(([k, v]) => `\treq.Header.Add("${k}", "${v}")`),
    '',
    '\tres, _ := http.DefaultClient.Do(req)',
    '\tdefer res.Body.Close()',
    '\tbody, _ := io.ReadAll(res.Body)',
    '',
    '\tfmt.Println(string(body))',
    '}',
  ]
    .filter((l) => l !== null)
    .join('\n');

  const javaBody = hasBody ? `HttpRequest.BodyPublishers.ofString(${JSON.stringify(bodyText)})` : 'HttpRequest.BodyPublishers.noBody()';
  const java = [
    'HttpRequest request = HttpRequest.newBuilder()',
    `    .uri(URI.create("${fullUrl}"))`,
    ...headers.map(([k, v]) => `    .header("${k}", "${v}")`),
    `    .method("${r.method}", ${javaBody})`,
    '    .build();',
    '',
    'HttpResponse<String> response = HttpClient.newHttpClient()',
    '    .send(request, HttpResponse.BodyHandlers.ofString());',
    '',
    'System.out.println(response.body());',
  ].join('\n');

  return [
    { label: 'cURL', lang: 'bash', code: curl.join('\n') },
    { label: 'JavaScript', lang: 'js', code: js },
    { label: 'Python', lang: 'python', code: python },
    { label: 'PHP', lang: 'php', code: php },
    { label: 'Go', lang: 'go', code: go },
    { label: 'Java', lang: 'java', code: java },
  ];
}

function toPython(v, pad = '') {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  const inner = pad + '    ';
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => inner + toPython(x, inner)).join(',\n')}\n${pad}]` : '[]';
  const entries = Object.entries(v);
  return entries.length ? `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${toPython(x, inner)}`).join(',\n')}\n${pad}}` : '{}';
}
