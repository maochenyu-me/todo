import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { dayFileState, loadAllEntries, readDayFromDisk } from './data';
import { entryPath, serializeEntry } from './entry-codec';
import type { DayEntry } from './types';

let root: string;
let activeDir: string;
let archiveDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'todo-data-'));
  activeDir = join(root, 'todos');
  archiveDir = join(root, 'archive');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function taskOf(id: string, title: string) {
  return {
    id,
    title,
    done: false,
    completedAt: null,
    order: 0,
    priority: 1 as const,
    tags: [] as string[],
    note: '',
    timeBlock: null,
    createdAt: '2026-10-28T01:00:00.000Z',
    updatedAt: '2026-10-28T01:00:00.000Z',
  };
}

function entryOf(date: string, title = '写周报'): DayEntry {
  return { date, tasks: [taskOf(`t-${date}`, title)] };
}

/**
 * 用 `entryPath` 的规则把条目写进临时目录：
 * 目录名取相对名 `todos` / `archive`，再拼上临时根目录。
 * 这样测试同时也验证了 `entryPath` 的布局与 `data.ts` 期望一致。
 */
function writeEntry(kind: 'active' | 'archive', entry: DayEntry): string {
  const rel = entryPath(kind, entry.date, { activeDir: 'todos', archiveDir: 'archive' });
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, serializeEntry(entry), 'utf8');
  return abs;
}

describe('loadAllEntries', () => {
  test('同一日期同时存在于活跃区与归档区时只出现一次（取活跃区）', () => {
    writeEntry('active', entryOf('2026-10-28', '活跃区版本'));
    writeEntry('archive', entryOf('2026-10-28', '归档区版本'));

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(errors).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.tasks[0]?.title).toBe('活跃区版本');
  });

  test('entries 按 date 升序排列', () => {
    writeEntry('active', entryOf('2026-10-30'));
    writeEntry('archive', entryOf('2025-11-03'));
    writeEntry('active', entryOf('2026-01-05'));

    expect(loadAllEntries(activeDir, archiveDir).entries.map((e) => e.date)).toEqual([
      '2025-11-03',
      '2026-01-05',
      '2026-10-30',
    ]);
  });

  test('JSON 语法错误时跳过该文件但收集错误（含该路径）', () => {
    const badPath = writeEntry('active', entryOf('2026-10-29'));
    writeFileSync(badPath, '{ not json', 'utf8');
    writeEntry('active', entryOf('2026-10-28'));

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(entries.map((e) => e.date)).toEqual(['2026-10-28']);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toContain('2026-10-29.json');
    expect(errors[0]?.message).toBeTruthy();
  });

  test('内容不合法时同样跳过并收集错误（文件名与 date 不符）', () => {
    const path = writeEntry('active', entryOf('2026-10-29'));
    writeFileSync(path, JSON.stringify({ date: '2026-10-27', tasks: [] }), 'utf8');

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(entries).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toContain('2026-10-29.json');
  });

  test('坏文件不中断：其余文件照常读入', () => {
    writeFileSync(join(activeDir, '2026-01-01.json'), 'garbage', 'utf8');
    writeEntry('active', entryOf('2026-02-02'));
    writeEntry('archive', entryOf('2025-03-03'));

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(entries.map((e) => e.date)).toEqual(['2025-03-03', '2026-02-02']);
    expect(errors).toHaveLength(1);
  });

  test('缺少目录时不抛异常，返回空 entries', () => {
    const missingActive = join(root, 'no-such-active');
    const missingArchive = join(root, 'no-such-archive');

    const { entries, errors } = loadAllEntries(missingActive, missingArchive);

    expect(entries).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('归档区按年份子目录递归读取', () => {
    writeEntry('archive', entryOf('2025-11-03'));
    writeEntry('archive', entryOf('2024-11-03'));

    expect(loadAllEntries(activeDir, archiveDir).entries.map((e) => e.date)).toEqual([
      '2024-11-03',
      '2025-11-03',
    ]);
  });

  test('忽略非 .json 文件与非日期名文件', () => {
    writeFileSync(join(activeDir, 'notes.md'), '# hello', 'utf8');
    writeFileSync(join(activeDir, 'not-a-date.json'), '{}', 'utf8');
    writeEntry('active', entryOf('2026-10-28'));

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(entries.map((e) => e.date)).toEqual(['2026-10-28']);
    expect(errors).toEqual([]);
  });

  test('文件名日期不存在于日历（2026-02-30.json）时收集错误而不是静默忽略', () => {
    writeFileSync(
      join(activeDir, '2026-02-30.json'),
      JSON.stringify({ date: '2026-02-30', tasks: [] }),
      'utf8',
    );

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(entries).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toContain('2026-02-30.json');
  });

  test('文件名日期不合法时该文件的错误只有一条（不重复报同一个问题）', () => {
    writeFileSync(
      join(activeDir, '2026-02-30.json'),
      JSON.stringify({ date: '2026-02-30', tasks: [] }),
      'utf8',
    );

    const { errors } = loadAllEntries(activeDir, archiveDir);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('文件名日期 2026-02-30 不是合法的 YYYY-MM-DD');
  });

  test('任务缺 createdAt/updatedAt 的文件进 errors，不会被补空串写回', () => {
    writeFileSync(
      join(activeDir, '2026-10-28.json'),
      JSON.stringify({
        date: '2026-10-28',
        tasks: [{ id: 'a', title: '缺时间戳', done: false, priority: 1, tags: [], timeBlock: null }],
      }),
      'utf8',
    );

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(entries).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toContain('2026-10-28.json');
    expect(errors[0]?.message).toContain('createdAt');
    expect(errors[0]?.message).toContain('updatedAt');
  });
});

describe('readDayFromDisk', () => {
  test('活跃区存在时优先返回活跃区', () => {
    writeEntry('active', entryOf('2026-10-28', '活跃区版本'));
    writeEntry('archive', entryOf('2026-10-28', '归档区版本'));

    expect(readDayFromDisk(activeDir, archiveDir, '2026-10-28')?.tasks[0]?.title).toBe('活跃区版本');
  });

  test('活跃区没有时回落到归档区', () => {
    writeEntry('archive', entryOf('2025-11-03', '归档区版本'));

    expect(readDayFromDisk(activeDir, archiveDir, '2025-11-03')?.tasks[0]?.title).toBe('归档区版本');
  });

  test('两边都没有时返回 null', () => {
    expect(readDayFromDisk(activeDir, archiveDir, '2026-01-01')).toBeNull();
  });

  test('目录不存在时返回 null 而不抛异常', () => {
    expect(readDayFromDisk(join(root, 'nope'), join(root, 'nope2'), '2026-01-01')).toBeNull();
  });

  test('文件内容不合法时返回 null', () => {
    const path = writeEntry('active', entryOf('2026-01-01'));
    writeFileSync(path, '[]', 'utf8');

    expect(readDayFromDisk(activeDir, archiveDir, '2026-01-01')).toBeNull();
  });

  test('活跃区文件损坏时不静默回落到归档区旧快照', () => {
    const path = writeEntry('active', entryOf('2026-01-01', '活跃区版本'));
    writeFileSync(path, '{ broken', 'utf8');
    writeEntry('archive', entryOf('2026-01-01', '归档区版本'));

    expect(readDayFromDisk(activeDir, archiveDir, '2026-01-01')).toBeNull();
  });

  test('读出的条目与写盘前的条目等价', () => {
    const entry = entryOf('2026-10-28');
    writeEntry('active', entry);

    expect(readDayFromDisk(activeDir, archiveDir, '2026-10-28')).toEqual(entry);
  });
});

describe('dayFileState', () => {
  test('文件存在且合法时为 ok', () => {
    writeEntry('active', entryOf('2026-10-28'));

    expect(dayFileState(activeDir, archiveDir, '2026-10-28')).toBe('ok');
  });

  test('归档区有文件且合法时也是 ok', () => {
    writeEntry('archive', entryOf('2025-11-03'));

    expect(dayFileState(activeDir, archiveDir, '2025-11-03')).toBe('ok');
  });

  test('两边都没有文件时为 absent（不是 corrupt）', () => {
    expect(dayFileState(activeDir, archiveDir, '2026-01-01')).toBe('absent');
  });

  test('目录不存在时为 absent 而不抛异常', () => {
    expect(dayFileState(join(root, 'nope'), join(root, 'nope2'), '2026-01-01')).toBe('absent');
  });

  test('JSON 语法错误时为 corrupt —— 这是本函数存在的理由：readDayFromDisk 在这里也返回 null', () => {
    const path = writeEntry('active', entryOf('2026-10-29'));
    writeFileSync(path, '{ broken', 'utf8');

    // 同一份数据，两个函数给出**不同**的答案：一个有文件读不出，一个只是没文件。
    expect(dayFileState(activeDir, archiveDir, '2026-10-29')).toBe('corrupt');
    expect(readDayFromDisk(activeDir, archiveDir, '2026-10-29')).toBeNull();
  });

  test('内容不合法（date 与文件名不符）时为 corrupt', () => {
    const path = writeEntry('active', entryOf('2026-10-29'));
    writeFileSync(path, JSON.stringify({ date: '2026-10-27', tasks: [] }), 'utf8');

    expect(dayFileState(activeDir, archiveDir, '2026-10-29')).toBe('corrupt');
  });

  test('任务缺必需字段时为 corrupt', () => {
    writeFileSync(
      join(activeDir, '2026-10-28.json'),
      JSON.stringify({
        date: '2026-10-28',
        tasks: [{ id: 'a', title: '缺时间戳', done: false, priority: 1, tags: [], timeBlock: null }],
      }),
      'utf8',
    );

    expect(dayFileState(activeDir, archiveDir, '2026-10-28')).toBe('corrupt');
  });

  test('活跃区损坏时不回落到归档区：结论仍是 corrupt', () => {
    const path = writeEntry('active', entryOf('2026-01-01', '活跃区版本'));
    writeFileSync(path, '{ broken', 'utf8');
    writeEntry('archive', entryOf('2026-01-01', '归档区版本'));

    expect(dayFileState(activeDir, archiveDir, '2026-01-01')).toBe('corrupt');
  });

  test('活跃区没有文件时回落到归档区判定', () => {
    writeEntry('archive', entryOf('2025-11-03'));

    expect(dayFileState(activeDir, archiveDir, '2025-11-03')).toBe('ok');
  });

  test('有文件但 tasks 为空是 ok（空的正当记录，不是损坏）', () => {
    writeEntry('active', { date: '2026-10-27', tasks: [] });

    expect(dayFileState(activeDir, archiveDir, '2026-10-27')).toBe('ok');
  });

  test('不写入、不修改任何文件（只读）', () => {
    const path = writeEntry('active', entryOf('2026-10-28'));
    const before = readFileSync(path, 'utf8');

    dayFileState(activeDir, archiveDir, '2026-10-28');
    dayFileState(activeDir, archiveDir, '2026-01-01');

    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
