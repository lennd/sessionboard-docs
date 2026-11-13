/**
 * Product badges: the mark shown next to a product's name wherever the Help
 * Center names a product (the "Help for" switcher, a suite's title, the
 * product scope bar, the API Docs product switcher). Same marks and tones as
 * the Products menu on sessionboard.com (sessionboard-tam
 * growth-pages/home2027/selfserve_products.py MENU, icons from
 * pricing_platform.py, tones from selfserve.css) and the in-app
 * SelfServeProductIcon (web-ui-v2). Josh, 2026-11-06.
 *
 * Icons are the site's own 24px line icons (stroke, currentColor), inlined so
 * there is no icon dependency. Contrast of icon on badge (WCAG 1.4.11, 3:1 for
 * graphics): light 4.4–4.9:1, dark 7.7–9:1. Shared by
 * src/components/ProductBadge.astro and any page script that needs the mark.
 */
export const PRODUCT_BADGES = {
  platform: {
    name: 'Platform',
    // "program": a calendar sheet
    paths: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9h17M8 3v3M16 3v3M7.5 13h4M7.5 16h7"/>',
    light: { fg: '#1e62d8', bg: '#e8f0ff' },
    dark: { fg: '#a9c4f5', bg: 'rgb(30 98 216 / 0.25)' },
  },
  marketing: {
    name: 'Marketing',
    paths: '<path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
    light: { fg: '#6d4bd8', bg: '#ece7fb' },
    dark: { fg: '#c9bcf7', bg: 'rgb(109 75 216 / 0.25)' },
  },
  learning: {
    name: 'Learning',
    paths: '<path d="m2.5 9 9.5-4.5L21.5 9 12 13.5Z"/><path d="M6.5 11v4.5c1.6 1.5 3.4 2.2 5.5 2.2s3.9-.7 5.5-2.2V11M21.5 9v5"/>',
    light: { fg: '#b45309', bg: '#fbefdf' },
    dark: { fg: '#f5c98f', bg: 'rgb(180 83 9 / 0.25)' },
  },
  awards: {
    name: 'Awards',
    paths: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
    light: { fg: '#be2459', bg: '#fbe4ec' },
    dark: { fg: '#f3a6c0', bg: 'rgb(190 36 89 / 0.25)' },
  },
  sessions: {
    name: 'Sessions',
    // the site's "mic"; green from the in-app switcher (web-ui-v2 components/apps/appIcons.ts)
    paths: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
    light: { fg: '#047857', bg: '#dcf3ea' },
    dark: { fg: '#6ee7b7', bg: 'rgb(4 120 87 / 0.25)' },
  },
  crm: {
    name: 'CRM',
    // people; cyan from the in-app switcher (web-ui-v2 SelfServeProductIcon)
    paths: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    light: { fg: '#0e7490', bg: '#dcf1f6' },
    dark: { fg: '#8fdcec', bg: 'rgb(14 116 144 / 0.25)' },
  },
};

/**
 * The badge as an HTML string, for page scripts that build menus at runtime.
 * Decorative (aria-hidden) unless `label` is given, because it sits beside the
 * product's name. Colors come from the "Product badges" block in
 * src/styles/custom.css via `data-product` (tests/product-badges.test.mjs keeps
 * the two in step).
 */
export function productBadgeHtml(product, { size = 'sm', label = null } = {}) {
  const badge = PRODUCT_BADGES[product];
  if (!badge) return '';
  const a11y = label ? `role="img" aria-label="${String(label).replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return `<span class="sb-product-badge" data-product="${product}" data-size="${size}" ${a11y}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">${badge.paths}</svg></span>`;
}
