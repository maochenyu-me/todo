import { describe, expect, test } from 'vitest';

import { dayNav, hrefFor, prefetchTargets } from './day-nav';

/*
 * 测试口径：`withBase()` 在测试进程里 base 是 `/`，所以断言里全是根路径形态。
 * base 前缀另有构建期护栏（`tests/build-guard.test.ts`）在真产物上钉着。
 */

const TODAY = '2026-10-30';

describe('hrefFor：某一天的可链地址', () => {
  test('今天永远可链，并指向 /（哪怕没有文件）', () => {
    expect(hrefFor(TODAY, TODAY, false)).toBe('/');
    expect(hrefFor(TODAY, TODAY, true)).toBe('/');
  });

  test('有记录的过去/未来日子指向 /date/<key>', () => {
    expect(hrefFor('2026-10-28', TODAY, true)).toBe('/date/2026-10-28');
    expect(hrefFor('2026-11-02', TODAY, true)).toBe('/date/2026-11-02');
  });

  test('既不是今天、也没有记录 → null（不链、也不预取）', () => {
    expect(hrefFor('2026-10-28', TODAY, false)).toBeNull();
  });
});

describe('dayNav：翻阅三件套', () => {
  test('相邻两天都有记录：两个方向都可链，今天可回', () => {
    expect(dayNav({ dateKey: '2026-10-28', todayKey: TODAY, prevHasData: true, nextHasData: true })).toEqual({
      prev: '/date/2026-10-27',
      next: '/date/2026-10-29',
      today: '/',
    });
  });

  test('昨天第二天就是今天：即便今天没文件，也链到 /（曾经在这里断路）', () => {
    expect(dayNav({ dateKey: '2026-10-29', todayKey: TODAY, prevHasData: true, nextHasData: false })).toEqual({
      prev: '/date/2026-10-28',
      next: '/',
      today: '/',
    });
  });

  test('今天本页：没有「回到今天」，两个方向只看记录', () => {
    expect(dayNav({ dateKey: TODAY, todayKey: TODAY, prevHasData: true, nextHasData: false })).toEqual({
      prev: '/date/2026-10-29',
      next: null,
      today: null,
    });
  });

  test('孤立的一天（前后都没有记录）：两个方向都是 null', () => {
    expect(dayNav({ dateKey: '2025-11-03', todayKey: TODAY, prevHasData: false, nextHasData: false })).toEqual({
      prev: null,
      next: null,
      today: '/',
    });
  });
});

describe('prefetchTargets：只预取真实存在的目标', () => {
  test('顺序是 前一天 → 后一天 → 今天，且过滤掉 null', () => {
    expect(
      prefetchTargets({ prev: '/date/2026-10-27', next: null, today: '/' }),
    ).toEqual(['/date/2026-10-27', '/']);

    expect(prefetchTargets({ prev: null, next: null, today: null })).toEqual([]);
  });

  test('绝不产出空串或 null（那会渲染成 <link rel=prefetch href="">）', () => {
    for (const target of prefetchTargets({ prev: '/a', next: '/b', today: '/' })) {
      expect(target).toMatch(/^\//);
    }
  });
});
