import { describe, expect, test } from 'vitest';

import {
  daysInMonth,
  groupByYearMonth,
  latestDataMonth,
  monthKeyOf,
  monthNeighbors,
  monthStart,
  monthsWithData,
  monthsWithPages,
} from './months';
import type { DayEntry, Task } from './types';

const TODAY = '2026-10-28';

function taskOf(id: string, done = false): Task {
  return {
    id,
    title: `任务 ${id}`,
    done,
    completedAt: done ? '2026-10-28T01:00:00.000Z' : null,
    order: 0,
    priority: 1,
    tags: [],
    note: '',
    timeBlock: null,
    createdAt: '2026-10-28T01:00:00.000Z',
    updatedAt: '2026-10-28T01:00:00.000Z',
  };
}

function dayOf(date: string, total = 1, done = 0): DayEntry {
  const tasks: Task[] = [];
  for (let i = 0; i < total; i += 1) tasks.push(taskOf(`${date}-${i}`, i < done));
  return { date, tasks };
}

describe('monthKeyOf', () => {
  test('取日期 key 的前七位', () => {
    expect(monthKeyOf('2026-10-28')).toBe('2026-10');
    expect(monthKeyOf('2026-01-01')).toBe('2026-01');
  });
});

describe('monthsWithData', () => {
  test('去重且升序', () => {
    const entries = [
      dayOf('2026-10-28'),
      dayOf('2025-03-01'),
      dayOf('2026-10-02'),
      dayOf('2026-01-15'),
    ];
    expect(monthsWithData(entries)).toEqual(['2025-03', '2026-01', '2026-10']);
  });

  test('空数据返回空数组', () => {
    expect(monthsWithData([])).toEqual([]);
  });
});

describe('monthsWithPages', () => {
  test('有记录的各个月 ＋ 当前月，即使当前月没有记录', () => {
    const entries = [dayOf('2025-03-01'), dayOf('2026-10-02')];
    // 今天是 2026-11（数据里没有 11 月）：11 月仍然要有页面。
    expect(monthsWithPages(entries, '2026-11-05')).toEqual(['2025-03', '2026-10', '2026-11']);
  });

  test('零数据时仍然为当前月生成页面', () => {
    expect(monthsWithPages([], TODAY)).toEqual(['2026-10']);
  });

  test('当前月已在数据里时不重复', () => {
    expect(monthsWithPages([dayOf(TODAY)], TODAY)).toEqual(['2026-10']);
  });
});

describe('latestDataMonth', () => {
  test('取有数据的最新月份', () => {
    const entries = [dayOf('2025-03-01'), dayOf('2026-10-02'), dayOf('2026-01-15')];
    expect(latestDataMonth(entries, '2026-11-05')).toBe('2026-10');
  });

  test('一条数据都没有时回落到当前月（日历不能指向不存在的月份）', () => {
    expect(latestDataMonth([], '2026-11-05')).toBe('2026-11');
  });

  test('当前月就是最新数据月时返回它本身', () => {
    expect(latestDataMonth([dayOf(TODAY)], TODAY)).toBe('2026-10');
  });

  test('最新数据月一定在 monthsWithPages 里（canonical 才有落点）', () => {
    const entries = [dayOf('2025-03-01'), dayOf('2026-01-15')];
    const latest = latestDataMonth(entries, '2026-11-05');
    expect(monthsWithPages(entries, '2026-11-05')).toContain(latest);
  });
});

describe('monthNeighbors', () => {
  test('只在已存在的页面之间前后翻，不指向中间空月', () => {
    const months = ['2025-03', '2026-01', '2026-10', '2026-11'];
    expect(monthNeighbors(months, '2026-10')).toEqual({ prev: '2026-01', next: '2026-11' });
    expect(monthNeighbors(months, '2026-01')).toEqual({ prev: '2025-03', next: '2026-10' });
  });

  test('两端为 null', () => {
    const months = ['2026-01', '2026-10'];
    expect(monthNeighbors(months, '2026-01')).toEqual({ prev: null, next: '2026-10' });
    expect(monthNeighbors(months, '2026-10')).toEqual({ prev: '2026-01', next: null });
  });

  test('只有一个月份时两边都是 null', () => {
    expect(monthNeighbors(['2026-10'], '2026-10')).toEqual({ prev: null, next: null });
  });

  test('未排序的入参也能算对', () => {
    expect(monthNeighbors(['2026-11', '2025-03', '2026-01'], '2026-01')).toEqual({
      prev: '2025-03',
      next: '2026-11',
    });
  });
});

describe('daysInMonth', () => {
  test('只取该月，升序，且带上 total/done', () => {
    const entries = [dayOf('2026-10-28', 4, 3), dayOf('2026-10-02', 0), dayOf('2026-09-30', 2, 2)];
    expect(daysInMonth(entries, '2026-10')).toEqual([
      { date: '2026-10-02', total: 0, done: 0 },
      { date: '2026-10-28', total: 4, done: 3 },
    ]);
  });

  test('该月没有记录时返回空数组', () => {
    expect(daysInMonth([dayOf('2026-10-28')], '2026-11')).toEqual([]);
    expect(daysInMonth([], '2026-10')).toEqual([]);
  });

  test('不含任务标题等无关字段', () => {
    const [day] = daysInMonth([dayOf('2026-10-28', 2, 1)], '2026-10');
    expect(Object.keys(day as object).sort()).toEqual(['date', 'done', 'total']);
  });
});

describe('monthStart', () => {
  test('补 01', () => {
    expect(monthStart('2026-10')).toBe('2026-10-01');
  });
});

describe('groupByYearMonth', () => {
  test('按年、月分组，年与月与日都倒序', () => {
    const entries = [
      dayOf('2025-03-01', 1, 1),
      dayOf('2026-10-27', 2, 1),
      dayOf('2026-10-28', 4, 3),
      dayOf('2026-09-30', 0, 0),
    ];
    expect(groupByYearMonth(entries)).toEqual([
      {
        year: '2026',
        months: [
          {
            monthKey: '2026-10',
            days: [
              { date: '2026-10-28', total: 4, done: 3 },
              { date: '2026-10-27', total: 2, done: 1 },
            ],
          },
          { monthKey: '2026-09', days: [{ date: '2026-09-30', total: 0, done: 0 }] },
        ],
      },
      { year: '2025', months: [{ monthKey: '2025-03', days: [{ date: '2025-03-01', total: 1, done: 1 }] }] },
    ]);
  });

  test('空数据返回空数组（归档页因此走空状态而不是崩）', () => {
    expect(groupByYearMonth([])).toEqual([]);
  });

  test('0 条任务的一天仍然是一行（有文件就算一天）', () => {
    const groups = groupByYearMonth([dayOf('2026-10-28', 0, 0)]);
    expect(groups[0]?.months[0]?.days).toEqual([{ date: '2026-10-28', total: 0, done: 0 }]);
  });

  test('不泄漏任务标题：结构里只有 date/total/done', () => {
    const groups = groupByYearMonth([dayOf('2026-10-28', 2, 1)]);
    const day = groups[0]?.months[0]?.days[0];
    expect(Object.keys(day as object).sort()).toEqual(['date', 'done', 'total']);
    expect(JSON.stringify(groups)).not.toContain('任务');
  });

  test('不修改入参', () => {
    const entries = [dayOf('2026-10-02'), dayOf('2026-10-28')];
    const before = JSON.stringify(entries);
    groupByYearMonth(entries);
    expect(JSON.stringify(entries)).toBe(before);
  });
});
