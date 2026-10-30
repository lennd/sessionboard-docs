// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightLinksValidator from 'starlight-links-validator';
import sitemap from '@astrojs/sitemap';
import sidebar from './src/sidebar.json' with { type: 'json' };
import site from './site.json' with { type: 'json' };
import rehypeAppLinks from './plugins/rehype-app-links.mjs';
import { isStaffOnlyHref, staffOnlyGlobs } from './src/lib/staff-only.mjs';

// The staff-only enablement section (src/pages/<internalPrefix>/) is unlisted.
// Starlight adds @astrojs/sitemap itself unless one is configured here, so
// this is the only way to keep those URLs out of sitemap.xml.
const INTERNAL = `https://${site.canonicalHost}/${site.internalPrefix}`;
// Pages with `unlisted: true` in frontmatter (src/content.config.ts) — reached
// only from a link we email, so kept out of the sitemap as well as noindexed.
const UNLISTED = new Set([`https://${site.canonicalHost}/help/release-notes/email`]);

export default defineConfig({
  site: `https://${site.canonicalHost}`,
  trailingSlash: 'never',
  // Emit /path.html instead of /path/index.html so Workers assets serve
  // /sessions/create-a-session without a trailing-slash redirect hop.
  build: { format: 'file' },
  markdown: {
    // Turns `[label](app:RouteId)` into a data-sb-route marker the in-app
    // reader resolves against the reader's own event. Throws on an unknown id.
    rehypePlugins: [rehypeAppLinks],
  },
  integrations: [
    // Staff-only sections (site.json `staffOnly`, src/lib/staff-only.mjs) stay out too.
    sitemap({
      filter: (page) =>
        page !== INTERNAL &&
        !page.startsWith(`${INTERNAL}/`) &&
        !UNLISTED.has(page.replace(/\.html$/, '')) &&
        !isStaffOnlyHref(page, site),
    }),
    starlight({
      title: 'Sessionboard Help Center',
      logo: {
        light: './src/assets/wordmark-light.png',
        dark: './src/assets/wordmark-dark.png',
        replacesTitle: true,
        alt: 'Sessionboard',
      },
      favicon: '/favicon.png',
      customCss: ['./src/styles/custom.css'],
      components: {
        Head: './src/components/Head.astro',
        Sidebar: './src/components/Sidebar.astro',
        PageTitle: './src/components/PageTitle.astro',
        Footer: './src/components/Footer.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        SocialIcons: './src/components/SocialIcons.astro',
      },
      sidebar,
      // Keeps staff-only pages out of the Pagefind index.
      routeMiddleware: './src/route-data.ts',
      plugins: [
        starlightLlmsTxt({ exclude: staffOnlyGlobs(site) }),
        // /_account/sign-in (the 404 page's sign-in link) is a Worker route, not a page.
        starlightLinksValidator({ errorOnRelativeLinks: false, exclude: ['/_account/**'] }),
      ],
      pagination: true,
      lastUpdated: false,
      social: [{ icon: 'external', label: 'sessionboard.com', href: 'https://www.sessionboard.com' }],
    }),
  ],
});
