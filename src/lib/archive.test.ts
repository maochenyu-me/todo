import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { planArchiveMove, shouldArchive } from './archive';

const TODAY = '2026-10-28';
const AFTER = 6;

describe('shouldArchive：截止日边界', () => {
  test('刚好 6 个月当天搬不搬', () => {
    expect(shouldArchive('2026-04-28', TODAY, AFTER)).toBe(false); // 恰好 6 个月，仍活跃
    expect(shouldArchive('2026-04-27', TODAY, AFTER)).toBe(true);
  });

  test('截止日之后一天不搬', () => {
    expect(shouldArchive('2026-04-29', TODAY, AFTER)).toBe(false);
  });

  test('远早于截止日则搬', () => {
    expect(shouldArchive('2025-01-01', TODAY, AFTER)).toBe(true);
  });

  test('未来的日期不搬', () => {
    expect(shouldArchive('2026-10-29', TODAY, AFTER)).toBe(false);
    expect(shouldArchive('2027-01-01', TODAY, AFTER)).toBe(false);
  });

  test('today 本身不搬', () => {
    expect(shouldArchive(TODAY, TODAY, AFTER)).toBe(false);
  });

  test('afterMonths 为 0 时昨天搬、今天不搬', () => {
    expect(shouldArchive('2026-10-27', TODAY, 0)).toBe(true);
    expect(shouldArchive('2026-10-28', TODAY, 0)).toBe(false);
  });

  test('afterMonths 为 12 时截止日为去年同月同日', () => {
    expect(shouldArchive('2025-10-28', TODAY, 12)).toBe(false);
    expect(shouldArchive('2025-10-27', TODAY, 12)).toBe(true);
  });

  test('月末夹取：today 为 2026-03-31、afterMonths=1 时截止日是 2026-02-28', () => {
    expect(shouldArchive('2026-02-27', '2026-03-31', 1)).toBe(true);
    expect(shouldArchive('2026-02-28', '2026-03-31', 1)).toBe(false);
  });

  test('跨年边界：today 为 2026-01-15、afterMonths=1 时截止日是 2025-12-15', () => {
    expect(shouldArchive('2025-12-14', '2026-01-15', 1)).toBe(true);
    expect(shouldArchive('2025-12-15', '2026-01-15', 1)).toBe(false);
  });
});

describe('planArchiveMove', () => {
  test('对同一 key 幂等', () => {
    const keys = ['2026-04-27', '2026-04-27'];
    expect(planArchiveMove(keys, TODAY, AFTER).move).toEqual(['2026-04-27']);
  });

  test('只挑该搬的，且输出升序', () => {
    const keys = ['2026-10-01', '2025-12-31', '2026-04-27', '2026-04-28', '2026-01-05'];
    expect(planArchiveMove(keys, TODAY, AFTER).move).toEqual([
      '2025-12-31',
      '2026-01-05',
      '2026-04-27',
    ]);
  });

  test('没有该搬的返回空数组', () => {
    expect(planArchiveMove(['2026-10-28', '2026-04-28'], TODAY, AFTER).move).toEqual([]);
  });

  test('空输入返回空数组', () => {
    expect(planArchiveMove([], TODAY, AFTER).move).toEqual([]);
  });

  test('不修改入参数组', () => {
    const keys = ['2026-04-27', '2025-01-01'];
    const snapshot = [...keys];
    planArchiveMove(keys, TODAY, AFTER);
    expect(keys).toEqual(snapshot);
  });

  test('返回值形状恰好是 { move }', () => {
    expect(Object.keys(planArchiveMove([], TODAY, AFTER))).toEqual(['move']);
  });
});

describe('模块边界', () => {
  test('archive.ts 不含 node 依赖', () => {
    const src = readFileSync('src/lib/archive.ts', 'utf8');
    expect(src).not.toMatch(/from ['"]node:/);
  });
});
