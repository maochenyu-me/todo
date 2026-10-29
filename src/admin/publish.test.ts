import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { serializeEntry } from '../lib/entry-codec';
import type { DayEntry, Task } from '../lib/types';
import { buildCommitMessage, buildPublishPayload, PublishBlockedError } from './publish';

/**
 * 发布载荷的契约测试。
 *
 * 三条硬约束来自 task-16 brief：
 * 1. **只写 dirty 的日期**——没改过的天一个字节都不动；
 * 2. **归档搬迁在同一次提交内完成**——writes 用归档路径、deletes 用活跃路径；
 * 3. **summary 格式固定**——`N 天 / M 项改动`（commitMessage 模板要吃它）。
 *
 * 第四条是 Task 16 评审新增的：**loadWarnings 的日期必须拒绝写入**——仓库里存在
 * 但这次没载入的天，覆盖就是丢数据。`unavailableDates` 是必填参数：调用方想绕过
 * 它连编译都过不了，这是"类型层拦得住"的形态。
 */

const DATA_DIRS = { activeDir: 'src/data/todos', archiveDir: 'src/data/archive' };
const AFTER_MONTHS = 6;

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `任务 ${id}`,
    done: false,
    completedAt: null,
    order: 0,
    priority: 1,
    tags: [],
    note: '',
    timeBlock: null,
    createdAt: '2026-10-28T08:00:00.000Z',
    updatedAt: '2026-10-28T08:00:00.000Z',
    ...overrides,
  };
}

function day(date: string, tasks: Task[]): DayEntry {
  return { date, tasks };
}

describe('buildPublishPayload', () => {
  test('只把 dirty 的日期写入 writes', () => {
    const payload = buildPublishPayload({
      days: {
        '2026-10-27': day('2026-10-27', [task('a')]),
        '2026-10-28': day('2026-10-28', [task('b')]),
      },
      dirty: new Set(['2026-10-28']),
      todayKey: '2026-10-28',
      dataCfg: DATA_DIRS,
      afterMonths: AFTER_MONTHS,
      unavailableDates: new Set<string>(),
    });
    expect(payload.writes.map((w) => w.path)).toEqual(['src/data/todos/2026-10-28.json']);
    expect(payload.deletes).toEqual([]);
  });

  test('超出 6 个月的日期同时出现在 writes(归档路径) 与 deletes(活跃路径)', () => {
    const entry = day('2026-03-01', [task('a')]);
    const payload = buildPublishPayload({
      days: { '2026-03-01': entry },
      dirty: new Set(['2026-03-01']),
      todayKey: '2026-10-28',
      dataCfg: DATA_DIRS,
      afterMonths: AFTER_MONTHS,
      unavailableDates: new Set<string>(),
    });
    expect(payload.deletes).toContain('src/data/todos/2026-03-01.json');
    expect(payload.writes.map((w) => w.path)).toContain('src/data/archive/2026/2026-03-01.json');
    // 搬迁 = 新路径写 + 旧路径删，内容仍是序列化后的同一条目。
    expect(payload.writes).toHaveLength(1);
    expect(payload.writes[0]!.content).toBe(serializeEntry(entry));
  });

  test('归档边界：恰好满 6 个月当天（2026-04-28）不搬，前一天（2026-04-27）搬', () => {
    const input = (date: string) => ({
      days: { [date]: day(date, [task('a')]) },
      dirty: new Set([date]),
      todayKey: '2026-10-28',
      dataCfg: DATA_DIRS,
      afterMonths: AFTER_MONTHS,
      unavailableDates: new Set<string>(),
    });

    const onCutoff = buildPublishPayload(input('2026-04-28'));
    expect(onCutoff.writes.map((w) => w.path)).toEqual(['src/data/todos/2026-04-28.json']);
    expect(onCutoff.deletes).toEqual([]);

    const beforeCutoff = buildPublishPayload(input('2026-04-27'));
    expect(beforeCutoff.writes.map((w) => w.path)).toEqual([
      'src/data/archive/2026/2026-04-27.json',
    ]);
    expect(beforeCutoff.deletes).toEqual(['src/data/todos/2026-04-27.json']);
  });

  test('summary 形如 "3 天 / 12 项改动"（3 天 × 4 项）', () => {
    const days = ['2026-10-26', '2026-10-27', '2026-10-28'];
    const payload = buildPublishPayload({
      days: Object.fromEntries(days.map((d) => [d, day(d, [task('a'), task('b'), task('c'), task('d')])])),
      dirty: new Set(days),
      todayKey: '2026-10-28',
      dataCfg: DATA_DIRS,
      afterMonths: AFTER_MONTHS,
      unavailableDates: new Set<string>(),
    });
    expect(payload.summary).toMatch(/^\d+ 天 \/ \d+ 项改动$/);
    expect(payload.summary).toBe('3 天 / 12 项改动');
  });

  test('空 dirty 时 writes 与 deletes 均为空', () => {
    const payload = buildPublishPayload({
      days: { '2026-10-28': day('2026-10-28', [task('a')]) },
      dirty: new Set<string>(),
      todayKey: '2026-10-28',
      dataCfg: DATA_DIRS,
      afterMonths: AFTER_MONTHS,
      unavailableDates: new Set<string>(),
    });
    expect(payload.writes).toEqual([]);
    expect(payload.deletes).toEqual([]);
    expect(payload.summary).toBe('0 天 / 0 项改动');
  });

  test('dirty 混入没载入的日期（loadWarnings）→ 整批拒绝，一条都不许写', () => {
    expect(() =>
      buildPublishPayload({
        days: { '2026-10-28': day('2026-10-28', [task('a')]) },
        dirty: new Set(['2026-10-27', '2026-10-28']),
        todayKey: '2026-10-28',
        dataCfg: DATA_DIRS,
        afterMonths: AFTER_MONTHS,
        unavailableDates: new Set(['2026-10-27']),
      }),
    ).toThrow(PublishBlockedError);
    // 错误里要点名是哪几天，让人知道下一步该做什么。
    try {
      buildPublishPayload({
        days: { '2026-10-28': day('2026-10-28', [task('a')]) },
        dirty: new Set(['2026-10-27', '2026-10-28']),
        todayKey: '2026-10-28',
        dataCfg: DATA_DIRS,
        afterMonths: AFTER_MONTHS,
        unavailableDates: new Set(['2026-10-27']),
      });
      expect.unreachable('应当抛出 PublishBlockedError');
    } catch (error) {
      expect(error).toBeInstanceOf(PublishBlockedError);
      expect((error as PublishBlockedError).message).toContain('2026-10-27');
    }
  });

  test('没载入但也不在 dirty 里的日期不阻碍发布', () => {
    const payload = buildPublishPayload({
      days: { '2026-10-28': day('2026-10-28', [task('a')]) },
      dirty: new Set(['2026-10-28']),
      todayKey: '2026-10-28',
      dataCfg: DATA_DIRS,
      afterMonths: AFTER_MONTHS,
      unavailableDates: new Set(['2026-04-01']),
    });
    expect(payload.writes.map((w) => w.path)).toEqual(['src/data/todos/2026-10-28.json']);
  });

  test('dirty 里的日期在 days 中缺失 → 拒绝（缺内容的提交没法序列化）', () => {
    expect(() =>
      buildPublishPayload({
        days: {},
        dirty: new Set(['2026-10-28']),
        todayKey: '2026-10-28',
        dataCfg: DATA_DIRS,
        afterMonths: AFTER_MONTHS,
        unavailableDates: new Set<string>(),
      }),
    ).toThrow(PublishBlockedError);
  });

  test('writes 内容是 serializeEntry 的产物（可直接落盘的定形 JSON）', () => {
    const entry = day('2026-10-28', [task('a'), task('b', { order: 1 })]);
    const payload = buildPublishPayload({
      days: { '2026-10-28': entry },
      dirty: new Set(['2026-10-28']),
      todayKey: '2026-10-28',
      dataCfg: DATA_DIRS,
      afterMonths: AFTER_MONTHS,
      unavailableDates: new Set<string>(),
    });
    expect(payload.writes[0]!.content).toBe(serializeEntry(entry));
    expect(payload.writes[0]!.content.endsWith('\n')).toBe(true);
  });
});

describe('buildCommitMessage', () => {
  test('按模板替换 {date} 与 {summary}', () => {
    expect(buildCommitMessage('chore(todo): {date} — {summary}', '2026-10-28', '2 天 / 5 项改动')).toBe(
      'chore(todo): 2026-10-28 — 2 天 / 5 项改动',
    );
  });

  test('占位符可以出现多次，全部替换', () => {
    expect(buildCommitMessage('{date} {date}', '2026-01-02', '0 天 / 0 项改动')).toBe(
      '2026-01-02 2026-01-02',
    );
  });

  test('没有占位符时原样返回', () => {
    expect(buildCommitMessage('chore: update', '2026-01-02', '1 天 / 1 项改动')).toBe(
      'chore: update',
    );
  });
});

describe('publish 链路的模块卫生', () => {
  const src = readFileSync('src/admin/publish.ts', 'utf8');

  test('publish.ts 不引入 node 内置模块（会打进浏览器包）', () => {
    expect(src).not.toMatch(/from ['"]node:/);
  });

  test('publish.ts 不 import data.ts（那会把 node:fs 拖进浏览器包）', () => {
    expect(src).not.toMatch(/from ['"].*\/data['"]/);
  });
});
