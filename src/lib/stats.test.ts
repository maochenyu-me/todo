import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { daySummary, rollingRate, streak, tagStats, weeklyDone } from './stats';
import type { DayEntry, Task } from './types';

const TODAY = '2026-10-28';

function taskOf(id: string, done: boolean, tags: string[] = []): Task {
  return {
    id,
    title: `任务 ${id}`,
    done,
    completedAt: done ? '2026-10-28T01:00:00.000Z' : null,
    order: 0,
    priority: 1,
    tags,
    note: '',
    timeBlock: null,
    createdAt: '2026-10-28T01:00:00.000Z',
    updatedAt: '2026-10-28T01:00:00.000Z',
  };
}

/** 造一天：共 `total` 条任务，前 `done` 条已完成（顺序无关紧要，只为构造）。 */
function day(date: string, total: number, done: number, tags: string[] = []): DayEntry {
  const tasks: Task[] = [];
  for (let i = 0; i < total; i += 1) tasks.push(taskOf(`${date}-${i}`, i < done, tags));
  return { date, tasks };
}

describe('daySummary', () => {
  test('空数据不产生 NaN', () => {
    const s = daySummary({ date: '2026-10-28', tasks: [] });
    expect(s).toEqual({ total: 0, done: 0, rate: 0 });
    expect(Number.isNaN(s.rate)).toBe(false);
  });

  test('全完成 rate 为 1', () => {
    expect(daySummary(day(TODAY, 3, 3))).toEqual({ total: 3, done: 3, rate: 1 });
  });

  test('部分完成 rate 为 done/total', () => {
    expect(daySummary(day(TODAY, 4, 3))).toEqual({ total: 4, done: 3, rate: 0.75 });
  });

  test('全未完成 rate 为 0 且不是 NaN', () => {
    const s = daySummary(day(TODAY, 2, 0));
    expect(s).toEqual({ total: 2, done: 0, rate: 0 });
    expect(Number.isNaN(s.rate)).toBe(false);
  });

  test('只统计数据，与任务顺序无关', () => {
    const entry: DayEntry = {
      date: TODAY,
      tasks: [taskOf('a', false), taskOf('b', true), taskOf('c', true)],
    };
    expect(daySummary(entry)).toEqual({ total: 3, done: 2, rate: 2 / 3 });
  });
});

describe('streak：连续打卡天数', () => {
  test('今天没记录不算断签', () => {
    const entries = [day('2026-10-26', 1, 1), day('2026-10-27', 1, 1)];
    expect(streak(entries, '2026-10-28')).toBe(2);
  });

  test('今天有记录且未完成则断签', () => {
    const entries = [day('2026-10-27', 1, 1), day('2026-10-28', 1, 0)];
    expect(streak(entries, '2026-10-28')).toBe(0);
  });

  test('空输入返回 0', () => {
    expect(streak([], TODAY)).toBe(0);
  });

  test('连续全完成（含今天）逐日累加', () => {
    const entries = [
      day('2026-10-26', 2, 2),
      day('2026-10-27', 3, 3),
      day('2026-10-28', 1, 1),
    ];
    expect(streak(entries, '2026-10-28')).toBe(3);
  });

  test('中间零任务日不断链也不算一天', () => {
    const entries = [
      day('2026-10-24', 1, 1),
      day('2026-10-25', 0, 0), // 空白日：不计入也不断
      day('2026-10-26', 1, 1),
      day('2026-10-27', 1, 1),
    ];
    expect(streak(entries, '2026-10-28')).toBe(3);
  });

  test('今天有记录但零任务，等同于从昨天数', () => {
    const entries = [day('2026-10-26', 1, 1), day('2026-10-27', 1, 1), day('2026-10-28', 0, 0)];
    expect(streak(entries, '2026-10-28')).toBe(2);
  });

  test('中间某天有任务但没全做完则断链', () => {
    const entries = [
      day('2026-10-25', 1, 1),
      day('2026-10-26', 2, 1), // 有任务但非 100%，断在这里
      day('2026-10-27', 1, 1),
    ];
    expect(streak(entries, '2026-10-28')).toBe(1);
  });

  test('中间某天完全没有记录也算断链（只有"今天"豁免）', () => {
    const entries = [day('2026-10-25', 1, 1), day('2026-10-27', 1, 1)];
    expect(streak(entries, '2026-10-28')).toBe(1);
  });

  test('未来日期的记录不计入', () => {
    const entries = [day('2026-10-28', 1, 1), day('2026-10-29', 1, 1), day('2026-10-30', 1, 1)];
    expect(streak(entries, '2026-10-28')).toBe(1);
  });

  test('跨月连续', () => {
    const entries = [
      day('2026-09-30', 1, 1),
      day('2026-10-01', 1, 1),
      day('2026-10-02', 1, 1),
    ];
    expect(streak(entries, '2026-10-02')).toBe(3);
  });

  test('入参数组不被修改', () => {
    const entries = [day('2026-10-27', 1, 1), day('2026-10-28', 1, 1)];
    const snapshot = JSON.stringify(entries);
    streak(entries, '2026-10-28');
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});

describe('weeklyDone：按周（周一起始）聚合', () => {
  test('weeklyDone 长度固定为请求周数且含空周', () => {
    expect(weeklyDone([], '2026-10-28', 12)).toHaveLength(12);
  });

  test('空数据的每一周都是 0/0，且最后一格是今天所在周的周一', () => {
    const weeks = weeklyDone([], TODAY, 3);
    expect(weeks).toEqual([
      { weekStart: '2026-10-12', done: 0, total: 0 },
      { weekStart: '2026-10-19', done: 0, total: 0 },
      { weekStart: '2026-10-26', done: 0, total: 0 },
    ]);
  });

  test('按周一起始聚合并累加 done/total', () => {
    const entries = [
      day('2026-10-25', 1, 1), // 周日，属于 10-19 那周
      day('2026-10-26', 2, 1), // 周一
      day('2026-10-28', 1, 1),
    ];
    expect(weeklyDone(entries, TODAY, 2)).toEqual([
      { weekStart: '2026-10-19', done: 1, total: 1 },
      { weekStart: '2026-10-26', done: 2, total: 3 },
    ]);
  });

  test('周一当天属于本周而非上周', () => {
    expect(weeklyDone([], '2026-10-26', 2).map((w) => w.weekStart)).toEqual([
      '2026-10-19',
      '2026-10-26',
    ]);
  });

  test('周日当天的周一是六天前的周一', () => {
    expect(weeklyDone([], '2026-10-25', 2).map((w) => w.weekStart)).toEqual([
      '2026-10-12',
      '2026-10-19',
    ]);
  });

  test('区间外的条目被忽略', () => {
    const entries = [day('2026-09-01', 5, 5), day('2026-10-29', 5, 5)];
    expect(weeklyDone(entries, TODAY, 2)).toEqual([
      { weekStart: '2026-10-19', done: 0, total: 0 },
      { weekStart: '2026-10-26', done: 0, total: 0 },
    ]);
  });

  test('weeks 为 0 返回空数组', () => {
    expect(weeklyDone([day(TODAY, 1, 1)], TODAY, 0)).toEqual([]);
  });
});

describe('rollingRate：逐日完成率', () => {
  test('空输入也返回请求长度，末尾是 todayKey', () => {
    const series = rollingRate([], TODAY, 90);
    expect(series).toHaveLength(90);
    expect(series[89]).toEqual({ date: TODAY, rate: 0 });
    expect(series[0]).toEqual({ date: '2026-07-31', rate: 0 });
  });

  test('零任务的那天 rate 为 0 而非 NaN', () => {
    const entries = [day('2026-10-27', 0, 0)];
    const series = rollingRate(entries, TODAY, 3);
    expect(series.map((p) => p.rate)).toEqual([0, 0, 0]);
    for (const p of series) expect(Number.isNaN(p.rate)).toBe(false);
  });

  test('旧日期在前、todayKey 在最后，缺数据的日期补 0', () => {
    const entries = [day('2026-10-26', 2, 1), day('2026-10-28', 4, 4)];
    expect(rollingRate(entries, TODAY, 4)).toEqual([
      { date: '2026-10-25', rate: 0 },
      { date: '2026-10-26', rate: 0.5 },
      { date: '2026-10-27', rate: 0 },
      { date: '2026-10-28', rate: 1 },
    ]);
  });

  test('days 为 1 时只含 todayKey', () => {
    expect(rollingRate([day(TODAY, 1, 0)], TODAY, 1)).toEqual([{ date: TODAY, rate: 0 }]);
  });

  test('days 为 0 返回空数组', () => {
    expect(rollingRate([day(TODAY, 1, 1)], TODAY, 0)).toEqual([]);
  });

  test('未来数据不进入序列', () => {
    const entries = [day('2026-10-29', 3, 3)];
    expect(rollingRate(entries, TODAY, 1)).toEqual([{ date: TODAY, rate: 0 }]);
  });
});

describe('tagStats：标签聚合', () => {
  test('tagStats 按 total 降序', () => {
    const entries = [
      {
        date: '2026-10-26',
        tasks: [taskOf('a', true, ['工作']), taskOf('b', false, ['阅读'])],
      },
      {
        date: '2026-10-27',
        tasks: [taskOf('c', false, ['工作']), taskOf('d', true, ['阅读']), taskOf('e', true, ['阅读'])],
      },
    ];
    expect(tagStats(entries)).toEqual([
      { tag: '阅读', total: 3, done: 2 },
      { tag: '工作', total: 2, done: 1 },
    ]);
  });

  test('total 相同时按标签名升序（普通 < 比较，与 locale 无关）', () => {
    const entries = [
      { date: '2026-10-26', tasks: [taskOf('a', true, ['alpha', 'Zeta', 'beta'])] },
      { date: '2026-10-27', tasks: [taskOf('b', false, ['alpha', 'Zeta', 'beta'])] },
    ];
    // 普通码点比较：'Z'(90) < 'a'(97)，故 'Zeta' 排在 'alpha' 前；localeCompare 会给出相反顺序。
    expect(tagStats(entries).map((t) => t.tag)).toEqual(['Zeta', 'alpha', 'beta']);
  });

  test('多条任务重复调用结果一致（排序确定）', () => {
    const entries = [
      { date: '2026-10-26', tasks: [taskOf('a', true, ['b', 'a', 'c'])] },
      { date: '2026-10-27', tasks: [taskOf('b', true, ['c', 'b', 'a'])] },
    ];
    const first = tagStats(entries);
    const second = tagStats(entries);
    expect(second).toEqual(first);
    expect(first.map((t) => t.tag)).toEqual(['a', 'b', 'c']);
  });

  test('跨天累加同一标签', () => {
    const entries = [
      { date: '2026-10-26', tasks: [taskOf('a', true, ['工作'])] },
      { date: '2026-10-27', tasks: [taskOf('b', false, ['工作'])] },
      { date: '2026-10-28', tasks: [taskOf('c', true, ['工作'])] },
    ];
    expect(tagStats(entries)).toEqual([{ tag: '工作', total: 3, done: 2 }]);
  });

  test('同一任务里重复的标签只算一次', () => {
    const entries = [{ date: '2026-10-26', tasks: [taskOf('a', true, ['工作', '工作'])] }];
    expect(tagStats(entries)).toEqual([{ tag: '工作', total: 1, done: 1 }]);
  });

  test('没有标签的任务被忽略', () => {
    const entries = [{ date: '2026-10-26', tasks: [taskOf('a', true, [])] }];
    expect(tagStats(entries)).toEqual([]);
  });

  test('空输入返回 []', () => {
    expect(tagStats([])).toEqual([]);
  });
});

describe('模块边界', () => {
  test('stats.ts 不含 node 依赖、不含框架依赖', () => {
    const src = readFileSync('src/lib/stats.ts', 'utf8');
    expect(src).not.toMatch(/from ['"]node:/);
    expect(src).not.toMatch(/from ['"](astro:|react|@astrojs\/)/);
  });
});
