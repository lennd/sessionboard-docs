/**
 * Self-serve product scopes (src/data/help-scopes.json).
 *
 * Sessionboard Marketing and Sessionboard Learning customers open the Help
 * Center from their product's Help button as `/?via=marketing` (or
 * `?via=learning`). For the rest of that visit the sidebar and search show only
 * the articles whose frontmatter `products` lists that key, and a bar at the top
 * of the sidebar offers "All of Sessionboard" (`?via=all`), which clears it.
 *
 * The HTML is the same for every reader — the scope is a session cookie read by
 * an inline head script that sets `data-sb-scope` on <html> before first paint,
 * and CSS does the hiding. So an unscoped reader gets exactly the page they got
 * before scopes existed, and nothing about the edge cache changes.
 */

/** `/marketing/advocacy.html#x?y` → `/marketing/advocacy`; `/index` → `/`. */
export function normalizePath(href) {
  let path = String(href ?? '');
  try {
    path = new URL(path, 'https://x.invalid').pathname;
  } catch {
    return '';
  }
  path = path.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '');
  if (path.length > 1) path = path.replace(/\/$/, '');
  return path || '/';
}

/** Docs collection id → the path Starlight links it at. */
export const entryPath = (id) => (id === 'index' ? '/' : `/${id}`);

/** { marketing: ['/marketing/advocacy', …], learning: […] } from the docs collection. */
export function scopePaths(entries, config) {
  const out = Object.fromEntries(Object.keys(config.scopes).map((key) => [key, []]));
  for (const entry of entries) {
    for (const product of entry.data?.products ?? []) {
      if (out[product]) out[product].push(entryPath(entry.id));
    }
  }
  for (const key of Object.keys(out)) out[key].sort();
  return out;
}

/**
 * The inline head script. Runs before the body renders: reads `?via=` (and
 * then drops it from the address bar so a copied link is unscoped), falls back
 * to the cookie, stamps <html data-sb-scope>, and sends a scoped arrival on the
 * home page to the scope's getting-started page.
 */
export function headScript(config, paths) {
  const scopes = Object.fromEntries(
    Object.entries(config.scopes).map(([key, s]) => [key, { label: s.label, home: s.home, paths: paths[key] ?? [] }]),
  );
  return `(function(){
var C=${JSON.stringify(config.cookie)},S=${JSON.stringify(scopes)},d=document,l=location;
var scope=null,via=null;
try{via=new URLSearchParams(l.search).get('via');}catch(e){}
var m=d.cookie.match(new RegExp('(?:^|; )'+C+'=([^;]*)'));
if(m)scope=decodeURIComponent(m[1]);
var tail='; path=/; SameSite=Lax'+(l.protocol==='https:'?'; Secure':'');
if(via!==null){
  if(Object.prototype.hasOwnProperty.call(S,via)){scope=via;d.cookie=C+'='+via+tail;}
  else{scope=null;d.cookie=C+'='+tail+'; Max-Age=0';}
  try{var u=new URL(l.href);u.searchParams.delete('via');history.replaceState(history.state,'',u.pathname+u.search+u.hash);}catch(e){}
}
if(!scope||!Object.prototype.hasOwnProperty.call(S,scope))scope=null;
if(scope){
  d.documentElement.setAttribute('data-sb-scope',scope);
  if(via===scope&&(l.pathname==='/'||l.pathname==='/index.html')){l.replace(S[scope].home);}
}
window.sbHelpScope={scope:scope,scopes:S};
})();`;
}

/**
 * Sidebar CSS: under a scope, hide every link the scope does not tag and every
 * group left empty; without one, hide the scopes' own home pages and the bar.
 * Link <li>s carry `data-products` (SidebarSublist.astro), groups `data-group`.
 */
export function scopeCss(config) {
  const rules = [
    '.sb-scope-bar{display:none}',
    'html:not([data-sb-scope]) .sidebar-content li[data-scope-home]{display:none}',
  ];
  for (const key of Object.keys(config.scopes)) {
    const on = `html[data-sb-scope='${key}']`;
    rules.push(
      `${on} .sb-scope-bar[data-for='${key}']{display:flex}`,
      `${on} .sidebar-content li[data-products]:not([data-products~='${key}']){display:none}`,
      `${on} .sidebar-content li[data-group]:not(:has(li[data-products~='${key}'])){display:none}`,
    );
  }
  // Prev/next follow the full sidebar, so under a scope they would lead out of it.
  rules.push('html[data-sb-scope] .pagination-links{display:none}');
  return rules.join('\n');
}
