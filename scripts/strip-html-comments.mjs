#!/usr/bin/env node
/**
 * 构建后剥掉产物 HTML 里的**普通注释**（`npm run build` 的第二段）。
 *
 * 为什么需要：Astro 会把组件模板里的 `<!-- ... -->` 原样发到产物里。本仓的模板注释
 * 写得比较密（每处取舍都留了理由），实测全站 HTML 有 8% 是注释——那是给维护者看的，
 * 不该占用读者的带宽。
 *
 * **必须保留 Astro 自己的水合标记**（`<!--astro:end-->` 之类）：`astro-island` 的
 * 客户端代码靠它判断子节点结束（见 astro 的 client 运行时），剥掉 admin 的 React 岛屿
 * 就再也水合不起来。所以只删「不以 `astro` 开头」的注释。
 *
 * 顺序：`astro build && node scripts/strip-html-comments.mjs`。E2E 的服务脚本
 * （`scripts/e2e-server.mjs`）也调它一次，保证**测试跑的就是剥过的产物**。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

/** 水合/框架标记：`<!--astro:end-->`、`<!--astro:...-->` 一律原样保留。 */
const KEEP = /^<!--\s*astro/i;

/** 剥注释：只处理真正的 HTML 注释块，非贪婪匹配到最近的 `-->`。 */
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (comment) => (KEEP.test(comment) ? comment : ''));
}

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith('.html')) yield path;
  }
}

let files = 0;
let before = 0;
let after = 0;

for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, 'utf8');
  const stripped = stripComments(html);
  if (stripped !== html) {
    writeFileSync(file, stripped);
    files += 1;
    before += html.length;
    after += stripped.length;
  }
}

if (files === 0) {
  console.log('[strip-html-comments] 没有可剥的注释（产物里本来就没有普通注释）');
} else {
  const saved = before - after;
  console.log(
    `[strip-html-comments] ${files} 个页面，剥掉 ${saved} B（${((saved / before) * 100).toFixed(1)}%）`,
  );
}
