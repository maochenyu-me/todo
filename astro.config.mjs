import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

import { siteConfig } from './site.config.ts';

export default defineConfig({
  // site / base 只有一处真相：site.config.ts
  site: siteConfig.site.url,
  base: siteConfig.site.basePath,
  trailingSlash: 'ignore',
  vite: { plugins: [tailwindcss()] },
  integrations: [react(), sitemap()],
});
