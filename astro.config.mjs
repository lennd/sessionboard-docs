// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightLinksValidator from 'starlight-links-validator';
import sitemap from '@astrojs/sitemap';
import sidebar from './src/sidebar.json' with { type: 'json' };
import site from './site.json' with { type: 'json' };
import rehypeAppLinks from './plugins/rehype-app-links.mjs';

// The staff-only enablement section (src/pages/<internalPrefix>/) is unlisted.
// Starlight adds @astrojs/sitemap itself unless one is configured here, so
// this is the only way to keep those URLs out of sitemap.xml.
const INTERNAL = `https://${site.canonicalHost}/${site.internalPrefix}`;

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
    sitemap({ filter: (page) => page !== INTERNAL && !page.startsWith(`${INTERNAL}/`) }),
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
        PageTitle: './src/components/PageTitle.astro',
        Footer: './src/components/Footer.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        SocialIcons: './src/components/SocialIcons.astro',
      },
      sidebar,
      plugins: [starlightLlmsTxt(), starlightLinksValidator({ errorOnRelativeLinks: false })],
      pagination: true,
      lastUpdated: false,
      social: [{ icon: 'external', label: 'sessionboard.com', href: 'https://www.sessionboard.com' }],
    }),
  ],
});
