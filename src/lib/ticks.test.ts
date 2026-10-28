import { describe, expect, test } from 'vitest';

import { planTicks } from './ticks';

describe('planTicks — 未设上限（单日页的既有行为，必须逐字不变）', () => {
  test('total 条任务就画 total 个刻度，filled 等于 done', () => {
    expect(planTicks(4, 3)).toEqual({ shown: 4, filled: 3, overflow: 0, cap: null });
    expect(planTicks(1, 0)).toEqual({ shown: 1, filled: 0, overflow: 0, cap: null });
    expect(planTicks(1, 1)).toEqual({ shown: 1, filled: 1, overflow: 0, cap: null });
  });

  test('大数字在上限为 null 时也全画（不静默截断）', () => {
    expect(planTicks(205, 103)).toEqual({ shown: 205, filled: 103, overflow: 0, cap: null });
  });

  test('maxTicks 为非正数 / NaN / Infinity 时视为不限（与 capTasks 同口径）', () => {
    for (const maxTicks of [0, -1, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(planTicks(5, 2, maxTicks)).toEqual({ shown: 5, filled: 2, overflow: 0, cap: null });
    }
  });
});

describe('planTicks — 设了上限（归档页）', () => {
  test('total 未超上限时原样画，不产生 +N', () => {
    expect(planTicks(4, 3, 12)).toEqual({ shown: 4, filled: 3, overflow: 0, cap: 12 });
  });

  test('total 超过上限时只画 cap 个刻度，并报出被省掉的个数', () => {
    const plan = planTicks(200, 120, 12);
    expect(plan.shown).toBe(12);
    expect(plan.cap).toBe(12);
    expect(plan.overflow).toBe(188);
  });

  test('被截断时填充数是**按比例**的密度，不是「前 cap 条里有几条完成」', () => {
    // 120/200 = 60% → 12 个刻度里填 7 个（四舍五入）。若按 min(done, cap) 就是 12 个全填，
    // 那会把「完成了六成」画成「全完成」，比不画更糟。
    expect(planTicks(200, 120, 12).filled).toBe(7);
    expect(planTicks(200, 100, 10).filled).toBe(5);
    expect(planTicks(100, 50, 10).filled).toBe(5);
  });

  test('比例填充在两端保持准确：0 完成 → 0 格，全完成 → 满格', () => {
    expect(planTicks(205, 0, 12).filled).toBe(0);
    expect(planTicks(205, 205, 12).filled).toBe(12);
  });

  test('比例填充不会越出 [0, shown]', () => {
    for (const [total, done] of [
      [200, 1],
      [200, 199],
      [1000, 999],
      [13, 12],
      [999, 500],
    ] as const) {
      const plan = planTicks(total, done, 10);
      expect(plan.filled).toBeGreaterThanOrEqual(0);
      expect(plan.filled).toBeLessThanOrEqual(plan.shown);
    }
  });

  test('total 恰好等于上限时不产生 +N（边界）', () => {
    expect(planTicks(12, 5, 12)).toEqual({ shown: 12, filled: 5, overflow: 0, cap: 12 });
  });

  test('total 比上限多一条就产生 +1', () => {
    expect(planTicks(13, 5, 12)).toEqual({ shown: 12, filled: 5, overflow: 1, cap: 12 });
  });
});

describe('planTicks — 病态输入不产生 NaN / 负数 / 非整数', () => {
  test('done 越界被夹到 [0, total]', () => {
    expect(planTicks(3, 5)).toEqual({ shown: 3, filled: 3, overflow: 0, cap: null });
    expect(planTicks(3, -2)).toEqual({ shown: 3, filled: 0, overflow: 0, cap: null });
  });

  test('total 为负数 / 非有限值时按 0 处理', () => {
    expect(planTicks(-5, 2).shown).toBe(0);
    expect(planTicks(Number.NaN, 2).shown).toBe(0);
    expect(planTicks(Number.POSITIVE_INFINITY, 2).shown).toBe(0);
  });

  test('total 为小数时向下取整', () => {
    expect(planTicks(3.7, 1.9)).toEqual({ shown: 3, filled: 1, overflow: 0, cap: null });
  });

  test('所有输出都是有限整数', () => {
    for (const plan of [
      planTicks(200, 120, 12),
      planTicks(0, 0),
      planTicks(Number.NaN, Number.NaN, Number.NaN),
      planTicks(1e9, 5e8, 30),
    ]) {
      for (const n of [plan.shown, plan.filled, plan.overflow]) {
        expect(Number.isFinite(n)).toBe(true);
        expect(Number.isInteger(n)).toBe(true);
      }
    }
  });
});
