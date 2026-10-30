import { expect, test, type Page } from '@playwright/test';

/**
 * 明暗开关的行为契约：**整页一次动画**换肤，而不是各元素各变各的。
 *
 * 断言方式：把 `document.startViewTransition` 换成一个计数包装（页面脚本执行前注入），
 * 点一下开关看它被调用了几次。
 * - 正常动效：必须**恰好 1 次**（整页快照 + 圆形揭示）；
 * - 用户要求减少动效：必须**0 次**，但主题仍然照切（可用性优先于装饰）。
 *
 * 这里不碰种子数据，所以不随 `public.spec.ts` 一起挂起。
 */

const SITE_BASE = '/todo';

/** 在页面脚本运行前给 `startViewTransition` 装计数包装。 */
async function spyViewTransition(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __vt: number };
    w.__vt = 0;
    const proto = Document.prototype as unknown as {
      startViewTransition?: (cb: () => void) => unknown;
    };
    const original = proto.startViewTransition;
    if (typeof original === 'function') {
      proto.startViewTransition = function (this: unknown, cb: () => void) {
        w.__vt += 1;
        return original.call(this, cb);
      };
    }
  });
}

const themeOf = (page: Page) => page.locator('html').getAttribute('data-theme');
const vtCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vt: number }).__vt);
test('点明暗开关：一次整页视图过渡，主题切换', async ({ page }) => {
  await spyViewTransition(page);
  await page.goto(`${SITE_BASE}/`);

  // 全新上下文没有 localStorage → 跟随系统；点一下进「明亮」（循环：系统 → 明亮 → 暗黑）。
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  await page.locator('[data-theme-toggle]').click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await vtCalls(page)).toBe(1);
});

test('减少动效时：不做视图过渡，但主题照样切换', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await spyViewTransition(page);
  await page.goto(`${SITE_BASE}/`);

  await page.locator('[data-theme-toggle]').click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await vtCalls(page)).toBe(0);
});
