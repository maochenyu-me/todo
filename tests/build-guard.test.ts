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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

/** 把所有公开页拼在一起——用于断言「全站级」的样式/脚本形态（如内联 CSS）。 */
const readAllPagesHtml = () => pages.map((rel) => html(rel)).join('\n');
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
    // date/ 页只为「有文件的日子」生成：站点有数据时必须存在，
    // 数据目录被清空（用户清库自测）时一条都没有才是对的。
    const dataDir = join('src', 'data', 'todos');
    const hasData = existsSync(dataDir) && readdirSync(dataDir).some((n) => n.endsWith('.json'));
    expect(pages.some((p) => p.startsWith('date/'))).toBe(hasData);
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

describe('隐私：任务数据不漏进公开产物', () => {  test('首页 HTML 不含归档区任务标题', () => {
    // 用真实归档数据当探针：归档标题绝不允许出现在首页（/ 只渲染今天与近期）。
    // 探针为 0（数据目录刚清空、还没写第一条）时本断言平凡成立——
    // 那是「空白站点」而不是「数据目录被挪走」，不许响亮失败。
    const index = html('index.html');
    const archiveDir = join('src', 'data', 'archive');
    let probed = 0;
    for (const year of readdirSync(archiveDir, { withFileTypes: true })) {
      if (!year.isDirectory()) continue; // 跳过 .gitkeep 这类占位文件
      for (const name of readdirSync(join(archiveDir, year.name))) {
        const entry = JSON.parse(readFileSync(join(archiveDir, year.name, name), 'utf8')) as {
          tasks: { title: string }[];
        };
        for (const { title } of entry.tasks) {
          probed += 1;
          expect(index.includes(title), `归档标题泄漏进首页：${title}`).toBe(false);
        }
      }
    }
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

  /**
   * 图标路径必须跟着 base 走。
   *
   * 这条守卫的由来：`BaseLayout` 原本写的是 `${import.meta.env.BASE_URL}favicon.svg`，
   * 而 Astro 7 的 BASE_URL **不带尾斜杠**（`/repo`），于是子路径部署时产物里是
   * `/repofavicon.svg` —— 一个 404，而且只有在 DevTools 的 Network 面板里才看得见，
   * 页面上毫无症状。改成 `withBase('/favicon.svg')` 后两种部署形态都正确。
   *
   * 断言写成"所有站内绝对路径都必须以 base 开头"，而不是只盯 favicon：
   * 同一个坑对任何 `href="/..."` 的硬编码都成立。
   */
  test('所有站内绝对路径都带 base 前缀（防止 /repofavicon.svg 这类拼接错误）', () => {
    const pages = [...publicPages, 'admin/index.html'];
    for (const rel of pages) {
      const source = html(rel);
      // 取出所有 href/src 的站内绝对路径（`//` 开头是协议相对外链，跳过）。
      const roots = [...source.matchAll(/(?:href|src)="(\/(?!\/)[^"]*)"/g)]
        .map((match) => match[1]!)
        // `/_astro/...` 由 Astro 自己按 base 生成，一并检查更保险。
        .filter((path) => !path.startsWith('//'));

      for (const path of roots) {
        expect(path.startsWith(`${baseNoSlash}/`), `${rel} 的站内路径没带 base：${path}`).toBe(true);
      }
    }
  });
});

describe('性能不变量（零 JS 前提下的提速手段）', () => {
  const baseNoSlash = siteConfig.site.basePath.replace(/\/+$/, '');

  /**
   * 构建后必须剥掉普通注释。
   *
   * `scripts/strip-html-comments.mjs` 是 `npm run build` 的第二段；这条断言盯的是
   * 「它有没有真的跑过」。公开页不含任何 Astro 水合标记，所以残留注释必须是 0；
   * admin 因为 React 岛屿带 `<!--astro:end-->`，只允许 astro 开头的那些。
   */
  test('产物 HTML 里没有普通注释残留（astro 水合标记除外）', () => {
    for (const rel of [...publicPages, 'admin/index.html']) {
      const comments = html(rel).match(/<!--[\s\S]*?-->/g) ?? [];
      const leaked = comments.filter((comment) => !/^<!--\s*astro/i.test(comment));
      expect(leaked, `${rel} 残留注释：${leaked.slice(0, 2).join(' / ')}`).toEqual([]);
    }
  });

  test('全局 CSS 含跨文档视图过渡（零 JS 的无刷新感）', () => {
    // CSS 现在是内联的（`build.inlineStylesheets: 'always'`），所以从页面里读，
    // 而不是从 `_astro/*.css` 读。
    const html = readAllPagesHtml();
    expect(html).toContain('@view-transition');
    // 减少动效必须整套关掉，而不是只缩短时长。
    expect(html).toMatch(/prefers-reduced-motion/);
  });

  test('CSS 内联：公开页没有外链样式表，且内联样式带着设计令牌', () => {
    for (const rel of publicPages) {
      const source = html(rel);
      expect(source, `${rel} 仍有外链样式表`).not.toMatch(/<link[^>]+rel="stylesheet"/);
      expect(source, `${rel} 没有内联样式`).toMatch(/<style>[\s\S]*--background/);
    }
  });

  test('换肤动画的作用域样式在产物里（html.tvt 关掉默认交叉淡入）', () => {
    // 只在 `html.tvt` 下关默认过渡，否则会把跨文档跳页的 150ms 淡入一起关掉。
    expect(readAllPagesHtml()).toMatch(/html\.tvt::view-transition-new\(root\)/);
  });

  /**
   * 预取目标必须**恰好等于**底部翻阅栏的链接集合。
   *
   * 两边都走 `lib/day-nav.ts` 的同一份判定，所以这条是「同一份判定被用了两次」的
   * 结构性证明：多了就是预取一个点不到的目标（浪费带宽/打 404），少了就是点了没预取。
   * 不写死日期，也不假设必须有预取——孤立的一天（前后无记录、自己就是今天）本来
   * 就没有任何可点的相邻日，那时两个集合都是空。
   */
  test('单日页的预取目标 === 翻阅栏链接集合（同一份 dayNav）', () => {
    const dayPages = pages.filter((rel) => rel.startsWith('date/'));
    if (dayPages.length === 0) return;

    for (const rel of dayPages) {
      const source = html(rel);
      const pager = source.match(/<nav[^>]*aria-label="按日翻阅"[\s\S]*?<\/nav>/)?.[0] ?? '';
      expect(pager, `${rel} 没有翻阅栏`).not.toBe('');

      const pagerHrefs = [...pager.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).sort();
      const prefetchHrefs = [...source.matchAll(/<link rel="prefetch" href="([^"]+)"/g)]
        .map((m) => m[1]!)
        .sort();

      expect(prefetchHrefs, `${rel} 的预取与翻阅栏不一致`).toEqual(pagerHrefs);

      for (const href of prefetchHrefs) {
        expect(href.startsWith(`${baseNoSlash}/`), `${rel} 预取没带 base：${href}`).toBe(true);
        expect(href).not.toBe('');
      }
    }
  });
});
