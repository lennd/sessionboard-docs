/**
 * The Skills tab (`/skills`): workflow skills for Claude, ChatGPT and other assistants
 * connected to the Sessionboard MCP server.
 *
 * The skills themselves live in lennd/sessionboard-mcp-server (`skills/<name>/SKILL.md`
 * plus `skills/catalog.json`, checked against the tools the server registers). Its
 * `npm run skills:package -- --out ../sessionboard-docs/public/skills/downloads` writes
 * the zips, the Claude Code plugins and `skills.json` here; `npm run skills:pages` then
 * writes one article per skill under src/content/docs/skills/. Never edit those
 * generated articles or the downloads by hand.
 *
 * src/route-data.ts swaps in this sidebar for every /skills page (the Help Center
 * sidebar, src/sidebar.json, never lists them), the way the API Docs tab does.
 */
import manifest from '../../public/skills/downloads/skills.json' with { type: 'json' };

export const SKILLS_BASE = '/skills';
export const DOWNLOADS = `${SKILLS_BASE}/downloads`;

/**
 * Product groups, in sidebar order. Keys match `product` in the manifest; `badge` is the
 * product mark (src/lib/product-badges.mjs) shown before the group's name.
 */
export const SKILL_PRODUCTS = [
  { key: 'program', label: 'Program and speakers', badge: 'sessions' },
  { key: 'awards', label: 'Awards', badge: 'awards' },
  { key: 'learning', label: 'Learning', badge: 'learning' },
  { key: 'crm', label: 'CRM', badge: 'crm' },
  { key: 'registration', label: 'Registration', badge: 'platform' },
  { key: 'insights', label: 'Reports and insights', badge: 'platform' },
  { key: 'marketing', label: 'Marketing', badge: 'marketing' },
  { key: 'sites', label: 'Sites', badge: 'platform' },
  { key: 'attend', label: 'For attendees', badge: 'platform' },
];

/**
 * "Skills for ▾" (ProductSwitch.astro): which skill groups each self-serve product shows.
 * Platform shows every group. A group maps to the self-serve product built on the same
 * models (Program → Sessions). Josh, 2026-11-13: each self-serve product gets its own set.
 */
export const SKILLS_FOR = {
  sessions: ['program'],
  awards: ['awards'],
  learning: ['learning'],
  crm: ['crm'],
  marketing: ['marketing'],
};
export const SKILLS_FOR_COOKIE = 'sb_skills_for';

/** Skill group keys a product's "Skills for" view shows ([] for a product with none). */
export const skillsFor = (product) => (product === 'platform' ? SKILL_PRODUCTS.map((p) => p.key) : (SKILLS_FOR[product] ?? []));

/** Self-serve products whose view includes a group (Platform always does). */
export const productsForGroup = (group) => ['platform', ...Object.keys(SKILLS_FOR).filter((k) => SKILLS_FOR[k].includes(group))];

/**
 * Inline head script for Skills pages: picks the product view before first paint.
 * `?for=<key>` (the dropdown) wins and is remembered for the visit; then that memory;
 * then the Help Center suite the reader was last in (suites.mjs SUITE_COOKIE); else
 * Platform. Stamps <html data-sb-skills>, which skillsCss() reads.
 */
export function skillsHeadScript(suiteCookie) {
  const keys = ['platform', ...Object.keys(SKILLS_FOR)];
  return `(function(){
var K=${JSON.stringify(keys)},C=${JSON.stringify(SKILLS_FOR_COOKIE)},S=${JSON.stringify(suiteCookie)},d=document,l=location;
var ok=function(k){return K.indexOf(k)>-1;};
var get=function(n){var m=d.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):null;};
var f=null;try{f=new URLSearchParams(l.search).get('for');}catch(e){}
var tail='; path=/; SameSite=Lax'+(l.protocol==='https:'?'; Secure':'');
if(f!==null){if(ok(f))d.cookie=C+'='+f+tail;try{var u=new URL(l.href);u.searchParams.delete('for');history.replaceState(history.state,'',u.pathname+u.search+u.hash);}catch(e){}}
var k=ok(f)?f:get(C);if(!ok(k))k=get(S);if(!ok(k))k='platform';
d.documentElement.setAttribute('data-sb-skills',k);
})();`;
}

/** CSS for the chosen view: hide other products' groups, show the chosen name on the button. */
export function skillsCss() {
  const rules = ['.sb-suite-switch[data-dynamic] .sb-suite-switch-current{display:none}'];
  for (const k of ['platform', ...Object.keys(SKILLS_FOR)]) {
    const on = `html[data-sb-skills='${k}']`;
    rules.push(
      `${on} .sb-suite-switch[data-dynamic] .sb-suite-switch-current[data-key='${k}']{display:contents}`,
      `${on} .sb-suite-switch[data-dynamic] li[data-suite='${k}'] a{background:var(--sl-color-accent-low)}`,
    );
    if (k !== 'platform') rules.push(`${on} [data-skills-for]:not([data-skills-for~='${k}']){display:none!important}`);
  }
  return rules.join('\n');
}

export const GUIDES = [
  { slug: '', label: 'What skills are' },
  { slug: 'install', label: 'Install skills' },
  { slug: 'permissions', label: 'Permissions and control' },
];

export function skillsManifest() {
  return manifest;
}

export function skillsByProduct(skills = manifest.skills) {
  return SKILL_PRODUCTS.map((p) => ({ ...p, skills: skills.filter((s) => s.product === p.key) })).filter(
    (g) => g.skills.length > 0,
  );
}

export const isSkillsPath = (pathname) => {
  const p = pathname.replace(/\.html$/, '').replace(/\/$/, '');
  return p === SKILLS_BASE || (p.startsWith(`${SKILLS_BASE}/`) && !p.startsWith(`${DOWNLOADS}/`));
};

/** The Skills tab's sidebar (Starlight SidebarEntry[]) for a path. */
export function skillsSidebarFor(pathname) {
  const current = pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  const link = (label, href) => ({ type: 'link', label, href, isCurrent: href === current, badge: undefined, attrs: {} });
  const guides = GUIDES.map((g) => link(g.label, g.slug ? `${SKILLS_BASE}/${g.slug}` : SKILLS_BASE));
  const groups = skillsByProduct().map((g) => {
    const entries = g.skills.map((s) => link(s.title, `${SKILLS_BASE}/${s.id}`));
    return { type: 'group', label: g.label, entries, collapsed: false, badge: undefined, sbProduct: g.badge, sbFor: productsForGroup(g.key) };
  });
  return [{ type: 'group', label: 'Get started', entries: guides, collapsed: false, badge: undefined }, ...groups];
}
