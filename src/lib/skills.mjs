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

/** Product groups, in sidebar order. Keys match `product` in the manifest. */
export const SKILL_PRODUCTS = [
  { key: 'program', label: 'Program and speakers' },
  { key: 'awards', label: 'Awards' },
  { key: 'learning', label: 'Learning' },
  { key: 'crm', label: 'CRM' },
  { key: 'registration', label: 'Registration' },
  { key: 'insights', label: 'Reports and insights' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'sites', label: 'Sites' },
  { key: 'attend', label: 'For attendees' },
];

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
    return { type: 'group', label: g.label, entries, collapsed: false, badge: undefined };
  });
  return [{ type: 'group', label: 'Get started', entries: guides, collapsed: false, badge: undefined }, ...groups];
}
