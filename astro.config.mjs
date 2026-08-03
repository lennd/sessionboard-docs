// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightLinksValidator from 'starlight-links-validator';
import sidebar from './src/sidebar.json' with { type: 'json' };

export default defineConfig({
  site: 'https://learn.sessionboard.com',
  trailingSlash: 'never',
  // Emit /path.html instead of /path/index.html so Workers assets serve
  // /sessions/create-a-session without a trailing-slash redirect hop.
  build: { format: 'file' },
  integrations: [
    starlight({
      title: 'Sessionboard Help Center',
      logo: {
        light: './src/assets/light.svg',
        dark: './src/assets/dark.svg',
        replacesTitle: true,
      },
      favicon: '/favicon.png',
      customCss: ['./src/styles/custom.css'],
      sidebar,
      plugins: [starlightLlmsTxt(), starlightLinksValidator({ errorOnRelativeLinks: false })],
      pagination: false,
      lastUpdated: false,
      social: [{ icon: 'external', label: 'sessionboard.com', href: 'https://www.sessionboard.com' }],
    }),
  ],
});
