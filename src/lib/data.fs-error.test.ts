/**
 * 目录级文件系统故障的测试。
 *
 * 为什么单独一个文件：`EACCES` / `EMFILE` / `ENOTDIR` 在真实磁盘上无法可靠制造
 * （尤其 Windows 上 chmod 无效），所以这里 `vi.mock('node:fs')` 换成一层可注入故障的
 * `readdirSync`。`vi.mock` 是文件级作用域，放这里就不会干扰 `data.test.ts` 的真实临时目录测试。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 注入点：非空时对应调用抛出该错误码。 */
const injected = {
  readdir: '',
  stat: '',
  /** 只让路径包含该子串的 `statSync` 失败（`stat` 是全局限定，这个是定点）。 */
  statMatch: '',
  statMatchCode: 'EACCES',
};

function failer(code: string) {
  return () => {
    throw Object.assign(new Error(`${code}: simulated failure`), { code });
  };
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readdirSync = ((...args: unknown[]) => {
    if (injected.readdir !== '') failer(injected.readdir)();
    return (actual.readdirSync as (...a: unknown[]) => unknown)(...args);
  }) as typeof actual.readdirSync;
  const statSync = ((...args: unknown[]) => {
    if (injected.stat !== '') failer(injected.stat)();
    const target = typeof args[0] === 'string' ? args[0] : '';
    if (injected.statMatch !== '' && target.includes(injected.statMatch)) {
      failer(injected.statMatchCode)();
    }
    return (actual.statSync as (...a: unknown[]) => unknown)(...args);
  }) as typeof actual.statSync;
  return { ...actual, readdirSync, statSync };
});

// 必须在 `vi.mock` 之后动态 import，才保证 `data.ts` 拿到的是被替换过的 `node:fs`。
const { dayFileState, loadAllEntries, readDayFromDisk } = await import('./data');
const { serializeEntry } = await import('./entry-codec');
type DayEntry = import('./types').DayEntry;

let root = '';
let activeDir = '';
let archiveDir = '';

const entryOf = (date: string): DayEntry => ({
  date,
  tasks: [
    {
      id: `t-${date}`,
      title: '写周报',
      done: false,
      completedAt: null,
      order: 0,
      priority: 1,
      tags: [],
      note: '',
      timeBlock: null,
      createdAt: '2026-10-28T01:00:00.000Z',
      updatedAt: '2026-10-28T01:00:00.000Z',
    },
  ],
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'todo-data-fs-'));
  activeDir = join(root, 'todos');
  archiveDir = join(root, 'archive');
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });
  injected.readdir = '';
  injected.stat = '';
  injected.statMatch = '';
});

afterEach(() => {
  injected.readdir = '';
  injected.stat = '';
  injected.statMatch = '';
  rmSync(root, { recursive: true, force: true });
});

describe('目录级故障不能静默', () => {
  test('stat 遇到 EACCES 时进 errors，而不是当作空数据', () => {
    writeFileSync(join(activeDir, '2026-10-28.json'), serializeEntry(entryOf('2026-10-28')), 'utf8');
    injected.stat = 'EACCES';

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(entries).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.path)).toEqual(expect.arrayContaining([activeDir, archiveDir]));
    for (const err of errors) expect(err.message).toContain('EACCES');
  });

  test('readdir 遇到 EACCES 时进 errors（stat 通过、列目录失败）', () => {
    injected.readdir = 'EACCES';

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(entries).toEqual([]);
    expect(errors).toHaveLength(2);
    for (const err of errors) expect(err.message).toContain('EACCES');
  });

  test('EMFILE 时进 errors', () => {
    injected.readdir = 'EMFILE';

    const { errors } = loadAllEntries(activeDir, archiveDir);

    expect(errors).toHaveLength(2);
    for (const err of errors) expect(err.message).toContain('EMFILE');
  });

  test('ENOTDIR 时进 errors', () => {
    injected.stat = 'ENOTDIR';

    const { errors } = loadAllEntries(activeDir, archiveDir);

    expect(errors).toHaveLength(2);
    for (const err of errors) expect(err.message).toContain('ENOTDIR');
  });

  test('stat 报 ENOENT 仍按"没有数据"处理：空 entries、空 errors', () => {
    injected.stat = 'ENOENT';

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(entries).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('readdir 报 ENOENT（扫描期间目录被删）也按"没有数据"处理', () => {
    injected.readdir = 'ENOENT';

    const { entries, errors } = loadAllEntries(activeDir, archiveDir);

    expect(entries).toEqual([]);
    expect(errors).toEqual([]);
  });
});

/**
 * `dayFileState` 与 `readDayFromDisk` 必须**永远**说同一件事。
 *
 * 页面的判定是两条独立调用拼出来的：`entry = readDayFromDisk(...)` 与
 * `corrupt = dayFileState(...) === 'corrupt'`。只要两者在任何一个场景上分叉，
 * 页面就会自相矛盾——一边说「记录读不出来」，一边把记录列出来。
 * 所以这里不测「某个函数返回什么」，而是直接测**两个结论是否一致**。
 */
describe('dayFileState 与 readDayFromDisk 不得分叉', () => {
  /** 两条通道合起来读出的「这一天是什么」。一致性断言只认这三个值。 */
  function verdict(dateKey: string): 'readable' | 'corrupt' | 'absent' {
    const entry = readDayFromDisk(activeDir, archiveDir, dateKey);
    const state = dayFileState(activeDir, archiveDir, dateKey);
    if (state === 'ok') {
      // ok 必须真的读得出来；读不出来就是分叉。
      expect(entry).not.toBeNull();
      return 'readable';
    }
    if (state === 'corrupt') {
      // corrupt 必须真的读不出来；能读出来就是分叉（页面会同时说两句反话）。
      expect(entry).toBeNull();
      return 'corrupt';
    }
    expect(entry).toBeNull();
    return 'absent';
  }

  test('活跃区 stat 失败（EACCES）+ 归档区可读：两条通道必须一致', () => {
    writeFileSync(join(activeDir, '2026-01-01.json'), serializeEntry(entryOf('2026-01-01')), 'utf8');
    // 归档区放一份**可读**副本
    const archiveYearDir = join(archiveDir, '2026');
    mkdirSync(archiveYearDir, { recursive: true });
    writeFileSync(
      join(archiveYearDir, '2026-01-01.json'),
      serializeEntry(entryOf('2026-01-01')),
      'utf8',
    );
    // 只让**活跃区**那份 stat 失败，归档区照常可读。
    // 注意：匹配串必须用正斜杠——`entryPath` 拼出的路径一律是正斜杠（仓库路径与 URL 一致），
    // 用 `join()` 会得到反斜杠，注入就永远不会命中，测试会「因为没生效而假装通过」。
    injected.statMatch = 'todos/2026-01-01.json';
    injected.statMatchCode = 'EACCES';

    // 先钉住两个函数各自的行为（避免测试只是"恰好都错"地一致）
    expect(readDayFromDisk(activeDir, archiveDir, '2026-01-01')).not.toBeNull();

    // 再钉住它们一致：既然读得出归档区那份，就不能同时说「读不出来」。
    expect(verdict('2026-01-01')).toBe('readable');
  });

  test('活跃区 stat 失败 + 归档区也没有：两条通道一致地报 absent', () => {
    writeFileSync(join(activeDir, '2026-01-02.json'), serializeEntry(entryOf('2026-01-02')), 'utf8');
    injected.statMatch = 'todos/2026-01-02.json';
    injected.statMatchCode = 'EACCES';

    expect(verdict('2026-01-02')).toBe('absent');
  });

  test('活跃区 stat 可读但内容损坏 + 归档区可读：两条通道一致地报 corrupt（不回落）', () => {
    writeFileSync(join(activeDir, '2026-01-03.json'), '{ broken', 'utf8');
    const archiveYearDir = join(archiveDir, '2026');
    mkdirSync(archiveYearDir, { recursive: true });
    writeFileSync(
      join(archiveYearDir, '2026-01-03.json'),
      serializeEntry(entryOf('2026-01-03')),
      'utf8',
    );

    // 既有的关键行为：活跃区损坏**不**回落归档区旧快照。
    expect(verdict('2026-01-03')).toBe('corrupt');
  });

  test('活跃区 stat 失败 + 归档区内容损坏：两条通道一致地报 corrupt', () => {
    writeFileSync(join(activeDir, '2026-01-04.json'), serializeEntry(entryOf('2026-01-04')), 'utf8');
    const archiveYearDir = join(archiveDir, '2026');
    mkdirSync(archiveYearDir, { recursive: true });
    writeFileSync(join(archiveYearDir, '2026-01-04.json'), '{ broken', 'utf8');
    injected.statMatch = 'todos/2026-01-04.json';
    injected.statMatchCode = 'EACCES';

    expect(verdict('2026-01-04')).toBe('corrupt');
  });

  test('两个目录 stat 全失败（目录级故障）：两条通道一致', () => {
    injected.stat = 'EACCES';

    // 目录都 stat 不了 → 两边都看不到文件 → 都报 absent。不许一个说 corrupt 另一个说 absent。
    expect(verdict('2026-01-05')).toBe('absent');
  });
});
