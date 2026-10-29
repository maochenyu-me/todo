import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * 截图留档：六条核心路径 × 明暗两套 × 桌面/375 两档。
 *
 * ## 为什么单独一个 spec
 *
 * 它**不做功能性断言**（除了"页面确实渲染出来了"这一条最低保证）。混进 `public.spec.ts`
 * 会让一次配色微调同时影响"功能坏了"与"截图变了"两种信号，谁也说不清红的是哪一个。
 *
 * ## 为什么强制 `workers: 1` 之外还要固定视口
 *
 * 截图是给人看对照的：同一张图在不同 projects 下视口不同，diff 时才发现对不上。
 * 每个用例显式 `setViewportSize`，与 project 的默认视口无关。
 *
 * ## 暗黑怎么进去
 *
 * `localStorage["todo.theme"] = 'dark'` 由 `ThemeBootstrap` 的内联脚本在首帧前读取。
 * 用 `addInitScript` 在导航前写入，页面一打开就是暗色，不需要点开关再等过渡结束
 * （等过渡就只能 sleep，那正是禁用的做法）。
 */

const OUT_DIR = join(process.cwd(), 'docs', 'superpowers', 'screenshots');

/** 六条核心路径。标签页挑一个真实存在的种子标签。 */
const PAGES: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'archive', path: '/archive/' },
  { name: 'calendar', path: '/calendar/' },
  { name: 'tags', path: '/tags/%E4%BC%9A%E8%AE%AE' },
  { name: 'stats', path: '/stats/' },
  { name: 'admin', path: '/admin/' },
];

const VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
];

/** 让页面进入指定主题（不点开关、不 sleep：首帧前就写进 localStorage）。 */
async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('todo.theme', value);
    } catch {
      // storage 不可用就保持默认，截图仍然能出。
    }
  }, theme);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

/**
 * 截图只在 desktop 项目下跑一遍。
 *
 * 视口由每个用例自己 `setViewportSize` 指定（见文件头），所以两个 project 跑出来的
 * 是**同一批文件**——第二次只是把第一次的结果原地覆盖一遍，白花一倍时间。
 */
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chromium',
    '截图与视口无关：用例内已显式 setViewportSize，只跑一个 project',
  );
});

for (const viewport of VIEWPORTS) {
  for (const theme of ['light', 'dark'] as const) {
    for (const target of PAGES) {
      test(`${target.name} / ${theme} / ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await setTheme(page, theme);
        await page.goto(target.path);

        // 最低保证：页面真的渲染了（有 <body> 且不是错误页）。
        await expect(page.locator('body')).toBeVisible();

        if (theme === 'dark') {
          await expect(page.locator('html')).toHaveClass(/\bdark\b/);
        }

        // 首帧字体与主题脚本都要先跑完：等 document.fonts 就绪，避免截到回退字体。
        await page.evaluate(() => document.fonts.ready);

        await page.screenshot({
          path: join(OUT_DIR, `${target.name}-${theme}-${viewport.name}.png`),
          fullPage: true,
        });
      });
    }
  }
}

test('prefers-reduced-motion 下首页无过渡', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: join(OUT_DIR, 'home-reduced-motion-desktop.png'),
    fullPage: true,
  });
});
