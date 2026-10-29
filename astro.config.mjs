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
  integrations: [
    react(),
    // `/admin` 带 noindex：一页私人工具不该收进 sitemap。
    // 「noindex」与「请收录我」是互相矛盾的两句话，只能留一句。
    sitemap({ filter: (page) => !new URL(page).pathname.replace(/\/$/, '').endsWith('/admin') }),
  ],
});
