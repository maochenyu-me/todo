/**
 * `GET /manifest.webmanifest`（构建期静态生成）。
 *
 * 为什么用端点而不是 `public/` 静态文件：`start_url`、`scope` 和图标路径都必须跟着
 * base 前缀走（GH Pages 项目站是 `/todo/`），静态文件没有模板能力，硬编码绝对地址
 * 又会在换部署平台时悄悄失效。端点在构建期跑一次，`withBase()` 是唯一真相。
 *
 * 图标由 `scripts/gen-icons.mjs` 生成（提交在 `public/icons/`）。
 */

import type { APIRoute } from 'astro';

import { siteConfig } from '../../site.config';
import { withBase } from '../lib/urls';

export const GET: APIRoute = () => {
  const manifest = {
    name: siteConfig.site.title,
    short_name: siteConfig.site.title,
    description: siteConfig.site.tagline,
    lang: siteConfig.site.lang,
    // standalone：从主屏点开时没有浏览器地址栏，像「一本自己的本子」
    display: 'standalone',
    // 颜色取自 global.css 的令牌（浅色 --background / --seal），改动时两边一起改
    background_color: '#f6f3ea',
    theme_color: '#f6f3ea',
    start_url: withBase('/'),
    scope: withBase('/'),
    icons: [
      { src: withBase('/icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: withBase('/icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
      {
        src: withBase('/icons/icon-maskable-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
};
