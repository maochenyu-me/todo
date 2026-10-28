import { describe, expect, test } from 'vitest';

import {
  addDays,
  addMonths,
  formatLong,
  formatMedium,
  formatYearMonth,
  isValidDateKey,
  monthRange,
  monthsBetween,
  parseDateKey,
  startOfWeekGrid,
  toDateKey,
  todayInZone,
  weekdayOf,
} from './date';

describe('时区', () => {
  test('UTC 16:30 在北京是次日', () => {
    const now = new Date('2026-10-28T16:30:00Z');
    expect(todayInZone('Asia/Shanghai', now)).toBe('2026-10-29');
  });

  test('UTC 15:59 在北京仍是当日', () => {
    expect(todayInZone('Asia/Shanghai', new Date('2026-10-28T15:59:00Z'))).toBe('2026-10-28');
  });

  test('toDateKey 与 todayInZone 口径一致（跨年）', () => {
    expect(toDateKey(new Date('2026-12-31T16:00:00Z'), 'Asia/Shanghai')).toBe('2027-01-01');
    expect(toDateKey(new Date('2026-12-31T15:59:59Z'), 'Asia/Shanghai')).toBe('2026-12-31');
  });
});

describe('addDays', () => {
  test('跨年 addDays', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  test('闰年 2 月', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(monthRange('2028-02-10')).toHaveLength(29);
  });

  test('delta 为 0 时原样返回', () => {
    expect(addDays('2026-10-28', 0)).toBe('2026-10-28');
  });
});

describe('格式化', () => {
  test('formatLong 输出中文星期', () => {
    expect(formatLong('2026-10-28')).toBe('2026年10月28日 周三');
  });

  test('formatLong 周日为「周日」', () => {
    expect(formatLong('2026-11-01')).toBe('2026年11月1日 周日');
  });

  test('formatMedium', () => {
    expect(formatMedium('2026-10-28')).toBe('10月28日 周三');
  });

  test('formatYearMonth', () => {
    expect(formatYearMonth('2026-10-28')).toBe('2026年10月');
  });
});

describe('monthRange', () => {
  test('monthRange 边界', () => {
    expect(monthRange('2026-10-15')[0]).toBe('2026-10-01');
    expect(monthRange('2026-10-15').at(-1)).toBe('2026-10-31');
  });

  test('普通月份长度为 31', () => {
    expect(monthRange('2026-10-15')).toHaveLength(31);
  });
});

describe('weekdayOf', () => {
  test('2026-10-28 是周三', () => {
    expect(weekdayOf('2026-10-28')).toBe(3);
  });

  test('2026-11-01 是周日 = 0', () => {
    expect(weekdayOf('2026-11-01')).toBe(0);
  });
});

describe('startOfWeekGrid', () => {
  test('startOfWeekGrid 返回 42 项且首项是周一', () => {
    const grid = startOfWeekGrid('2026-10-01', 1);
    expect(grid).toHaveLength(42);
    expect(weekdayOf(grid[0])).toBe(1);
  });

  test('2026-10 的网格从 09-28 开始、连续递增、含相邻月补位', () => {
    const grid = startOfWeekGrid('2026-10-01', 1);
    expect(grid[0]).toBe('2026-09-28');
    expect(grid[41]).toBe('2026-11-08');
    expect(grid[1]).toBe(addDays(grid[0], 1));
    expect(grid).toContain('2026-10-01');
    expect(grid).toContain('2026-10-31');
  });

  test('weekStartsOn = 0 时首项是周日', () => {
    const grid = startOfWeekGrid('2026-10-01', 0);
    expect(grid).toHaveLength(42);
    expect(weekdayOf(grid[0])).toBe(0);
    expect(grid[0]).toBe('2026-09-27');
  });
});

describe('monthsBetween', () => {
  test('monthsBetween 边界', () => {
    expect(monthsBetween('2026-04-28', '2026-10-28')).toBe(6);
    expect(monthsBetween('2026-04-29', '2026-10-28')).toBe(5);
  });

  test('逆序为负数', () => {
    expect(monthsBetween('2026-10-28', '2026-04-28')).toBe(-6);
  });

  test('同一个月为 0', () => {
    expect(monthsBetween('2026-10-01', '2026-10-31')).toBe(0);
  });
});

describe('addMonths', () => {
  test('addMonths 月末夹取', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-10-28', -6)).toBe('2026-04-28');
  });

  test('闰年 2 月末夹取到 29', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  test('跨年位移', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('parseDateKey / isValidDateKey', () => {
  test('parseDateKey 拆分数字', () => {
    expect(parseDateKey('2026-10-08')).toEqual({ y: 2026, m: 10, d: 8 });
  });

  test('isValidDateKey 接受合法输入', () => {
    expect(isValidDateKey('2026-10-28')).toBe(true);
    expect(isValidDateKey('2028-02-29')).toBe(true);
  });

  test('isValidDateKey 拒绝非法输入', () => {
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-1-5')).toBe(false);
    expect(isValidDateKey('abc')).toBe(false);
  });

  test('isValidDateKey 拒绝平年 2 月 29 与越界月/日', () => {
    expect(isValidDateKey('2026-02-29')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2026-00-10')).toBe(false);
    expect(isValidDateKey('2026-10-00')).toBe(false);
    expect(isValidDateKey('')).toBe(false);
    expect(isValidDateKey('2026-10-28T00:00:00Z')).toBe(false);
  });
});
