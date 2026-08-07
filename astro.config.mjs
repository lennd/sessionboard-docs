// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightLinksValidator from 'starlight-links-validator';
import sidebar from './src/sidebar.json' with { type: 'json' };
import site from './site.json' with { type: 'json' };

export default defineConfig({
  site: `https://${site.canonicalHost}`,
  trailingSlash: 'never',
  // Emit /path.html instead of /path/index.html so Workers assets serve
  // /sessions/create-a-session without a trailing-slash redirect hop.
  build: { format: 'file' },
  integrations: [
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
