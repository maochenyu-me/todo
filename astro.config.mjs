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
  /*
   * CSS 内联（不是「auto」）。
   *
   * 实测对照（本地 4G 限速 + 4× CPU，`scripts/perf-probe.mjs`）：
   *   外链 CSS：2 请求 / 11.8 KB / LCP 560 ms / load 492 ms
   *   内联 CSS：1 请求 / 11.4 KB / LCP 404 ms / load 332 ms
   * 内联更快也**更小**：样式表单独成文件时要多付一组响应头，且首屏多一个渲染阻塞请求。
   * 代价是 CSS 不再跨页缓存（每页多带约 4 KB gzip）——但每页省下的那一次 RTT 是 150ms 量级，
   * 对一本十几页的小簿子，这笔账明显划算。
   *
   * 护栏钉着：`tests/build-guard.test.ts` 断言公开页没有 `<link rel="stylesheet">`，
   * 且内联样式里确实带着设计令牌（`--background`）。
   */
  build: { inlineStylesheets: 'always' },
  vite: { plugins: [tailwindcss()] },
  integrations: [
    react(),
    // `/admin` 带 noindex：一页私人工具不该收进 sitemap。
    // 「noindex」与「请收录我」是互相矛盾的两句话，只能留一句。
    sitemap({ filter: (page) => !new URL(page).pathname.replace(/\/$/, '').endsWith('/admin') }),
  ],
});
