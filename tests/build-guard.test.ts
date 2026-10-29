/**
 * 构建产物护栏：**公开页面**的体积与隐私红线，盯的是 `dist/`（先 `npm run build`）。
 *
 * ## 为什么测试构建产物
 *
 * 这个站的卖点是「公开页零 JS、后台数据绝不漏进公开产物」。这类约束在源码层
 * 测不出来——一个手滑的 `<script>`、一个把数据 serialize 进 frontmatter 的改法，
 * 只有盯着最终 HTML 才拦得住。所以这些测试读 `dist/`，坏一处就红。
 *
 * ## 与既有护栏的关系
 *
 * - `publish.test.ts` 的「模块卫生」守卫管源码（publish.ts 不进 node:*）；
 *   这里管产物（dist 里不出现任务标题、不出现 React 运行时）。
 * - 「首页不含历史任务标题」失败时**修实现，不许改测试**（brief 明文）。
 *
 * 基线（2026-10-29，Task 14 验收）：29 个公开页合计内联 JS 1224 B、0 岛屿。
 * 这里用比基线更宽的硬上限（单页 < 2000 B）当护栏——收紧去改实现，别放宽这个数。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { siteConfig } from '../site.config';

const dist = 'dist';

/** 递归收集 dist 下所有 .html（POSIX 风格相对路径，稳定排序）。 */
function allHtml(dir = dist, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) {
      out.push(...allHtml(full, rel));
    } else if (name.endsWith('.html')) {
      out.push(rel);
    }
  }
  return out.sort();
}

const pages = allHtml();
const html = (rel: string) => readFileSync(join(dist, rel), 'utf8');
const scriptsOf = (source: string) => source.match(/<script\b[\s\S]*?<\/script>/g) ?? [];

/** 公开页 = dist 下所有 HTML；admin 是私人工具，单独一组断言。 */
const publicPages = pages.filter((p) => !p.startsWith('admin'));

describe('必需页面均生成', () => {
  const required = [
    'index.html',
    'archive/index.html',
    'stats/index.html',
    'admin/index.html',
    'tags/index.html',
  ];
  for (const rel of required) {
    test(`存在 ${rel}`, () => {
      expect(pages).toContain(rel);
    });
  }

  test('calendar 与 date 目录有页面', () => {
    expect(pages.some((p) => p.startsWith('calendar/'))).toBe(true);
    expect(pages.some((p) => p.startsWith('date/'))).toBe(true);
  });
});

describe('前台页面零 JS（除主题引导脚本）', () => {
  const INLINE_BUDGET = 2000;

  test('每个公开页 <script> 总数 <= 2（主题引导 + Astro 仅存的小引导）', () => {
    for (const rel of publicPages) {
      // Vitest 的 Chai 子集没有 toHaveLengthLessOrEqual；count 上手写。
      expect(scriptsOf(html(rel)).length, `${rel}`).toBeLessThanOrEqual(2);
    }
  });

  test('每个公开页内联脚本总长 < 2000 B', () => {
    for (const rel of publicPages) {
      const total = scriptsOf(html(rel))
        .filter((s) => !/\bsrc=/.test(s))
        .reduce((sum, s) => sum + s.length, 0);
      expect(total, rel).toBeLessThan(INLINE_BUDGET);
    }
  });

  test('公开页不含外部脚本引用（/_astro/*.js、react、client.*.js）', () => {
    for (const rel of publicPages) {
      const source = html(rel);
      expect(source, rel).not.toMatch(/\/_astro\/[^"']*\.js/);
      expect(source, rel).not.toMatch(/react/);
      expect(source, rel).not.toMatch(/client\.[^"']*\.js/);
    }
  });
});

describe('隐私：任务数据不漏进公开产物', () => {
  test('首页 HTML 不含归档区任务标题', () => {
    // 用真实归档数据当探针：归档标题绝不允许出现在首页（/ 只渲染今天与近期）。
    const index = html('index.html');
    const archiveDir = join('src', 'data', 'archive');
    let probed = 0;
    for (const year of readdirSync(archiveDir)) {
      for (const name of readdirSync(join(archiveDir, year))) {
        const entry = JSON.parse(readFileSync(join(archiveDir, year, name), 'utf8')) as {
          tasks: { title: string }[];
        };
        for (const { title } of entry.tasks) {
          probed += 1;
          expect(index.includes(title), `归档标题泄漏进首页：${title}`).toBe(false);
        }
      }
    }
    // 探针为 0 说明数据目录被挪走了，测试失去意义——让它响亮地失败。
    expect(probed).toBeGreaterThan(0);
  });

  test('公开页不含 ADMIN 的敏感配置（KDF 串、token 键名）', () => {
    for (const rel of publicPages) {
      const source = html(rel);
      expect(source, rel).not.toMatch(/pbkdf2\$/);
      expect(source, rel).not.toMatch(/todo\.gh\.token/);
    }
  });
});

describe('admin 页', () => {
  const admin = html('admin/index.html');

  test('含 noindex', () => {
    expect(admin).toMatch(/<meta[^>]*name="robots"[^>]*content="noindex"/);
  });

  test('admin 允许加载 React 岛屿（对照：公开页不允许）', () => {
    expect(admin).toMatch(/\/_astro\//);
  });
});

describe('canonical 与 base 前缀', () => {
  // site.url 可能带尾斜杠；base 为 "/"（根部署）时前缀就是 origin 本身。
  const origin = new URL(siteConfig.site.url).origin;
  const baseNoSlash = siteConfig.site.basePath.replace(/\/+$/, '');

  test('每个公开页都有 canonical，指向 site.url(+base) 下的自身地址或其规范副本', () => {
    for (const rel of publicPages) {
      const match = html(rel).match(/<link rel="canonical" href="([^"]+)"/);
      expect(match, `${rel} 缺 canonical`).not.toBeNull();
      const href = match![1];

      // 自身地址。非 ASCII 路径（中文标签）在产物里是百分号编码，与 URL 语义一致。
      const urlPath =
        rel === 'index.html' ? '/' : `/${encodeURI(rel.replace(/\/index\.html$/, ''))}`;
      const own = `${origin}${baseNoSlash}${urlPath}`;

      // 产物的两种合法形态：目录 index 页由 pathname 推导 → 带尾斜杠；
      // 参数页走显式 canonicalHref → 不带。两种都算「指向自身」。
      const allowed = [own, `${own}/`];

      // 两处已文档化的重复内容页，canonical 指向副本的规范地址：
      // - 今天页 `/date/<today>` 是 `/` 的可渲染副本（date/[date].astro）；
      // - 最新月份页是 `/calendar/` 的副本（calendar/[month].astro）。
      if (rel.startsWith('date/')) allowed.push(`${origin}${baseNoSlash}/`);
      if (rel.startsWith('calendar/')) allowed.push(`${origin}${baseNoSlash}/calendar/`);

      expect(allowed, rel).toContain(href);
    }
  });
});
