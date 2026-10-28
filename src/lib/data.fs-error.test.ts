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
const injected = { readdir: '', stat: '' };

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
    return (actual.statSync as (...a: unknown[]) => unknown)(...args);
  }) as typeof actual.statSync;
  return { ...actual, readdirSync, statSync };
});

// 必须在 `vi.mock` 之后动态 import，才保证 `data.ts` 拿到的是被替换过的 `node:fs`。
const { loadAllEntries } = await import('./data');
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
});

afterEach(() => {
  injected.readdir = '';
  injected.stat = '';
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
