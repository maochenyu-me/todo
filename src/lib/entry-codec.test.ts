import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { entryPath, parseEntry, serializeEntry, validateEntry } from './entry-codec';
import type { DayEntry, Task } from './types';

const validTask: Task = {
  id: 't-1',
  title: '写周报',
  done: false,
  completedAt: null,
  order: 0,
  priority: 1,
  tags: ['工作'],
  note: '',
  timeBlock: null,
  createdAt: '2026-10-28T01:00:00.000Z',
  updatedAt: '2026-10-28T01:00:00.000Z',
};

function entryOf(tasks: unknown[] = [validTask]): Record<string, unknown> {
  return { date: '2026-10-28', tasks };
}

/** 断言校验失败并返回 errors，省去每处 `if (r.ok) throw` 样板。 */
function errorsOf(raw: unknown, dateKey = '2026-10-28'): string[] {
  const r = validateEntry(raw, dateKey);
  if (r.ok) throw new Error('unreachable');
  return r.errors;
}

describe('validateEntry：整体形状', () => {
  test('文件名与内容 date 不符时报错并指名文件', () => {
    const r = validateEntry({ date: '2026-10-27', tasks: [] }, '2026-10-28');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.errors.join()).toContain('2026-10-28');
  });

  test('无 tasks 不抛异常，返回错误', () => {
    expect(validateEntry({ date: '2026-10-28' }, '2026-10-28').ok).toBe(false);
  });

  test('tasks 不是数组时报错', () => {
    expect(validateEntry({ date: '2026-10-28', tasks: {} }, '2026-10-28').ok).toBe(false);
  });

  test('合法条目通过校验', () => {
    const r = validateEntry(entryOf(), '2026-10-28');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.date).toBe('2026-10-28');
  });

  test('空 tasks 数组是合法的', () => {
    expect(validateEntry({ date: '2026-10-28', tasks: [] }, '2026-10-28').ok).toBe(true);
  });

  test('原始值不是对象时返回错误而不抛异常', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) {
      expect(validateEntry(raw, '2026-10-28').ok).toBe(false);
    }
  });

  test('JSON.parse 得到的对象也接受（纯数据判定）', () => {
    const r = validateEntry(JSON.parse(JSON.stringify(entryOf())), '2026-10-28');
    expect(r.ok).toBe(true);
  });
});

describe('validateEntry：date', () => {
  test('date 不是合法日期 key 时报错', () => {
    expect(validateEntry({ date: '2026-02-30', tasks: [] }, '2026-02-30').ok).toBe(false);
    expect(validateEntry({ date: '2026-2-3', tasks: [] }, '2026-2-3').ok).toBe(false);
  });

  test('date 不是字符串时报错', () => {
    expect(validateEntry({ date: 20261028, tasks: [] }, '2026-10-28').ok).toBe(false);
  });
});

describe('validateEntry：task 字段', () => {
  test('priority 越界被拒绝而非静默修正', () => {
    const r = validateEntry(entryOf([{ ...validTask, priority: 5 }]), '2026-10-28');
    expect(r.ok).toBe(false);
  });

  test('priority 非整数字符串被拒绝', () => {
    expect(validateEntry(entryOf([{ ...validTask, priority: '1' }]), '2026-10-28').ok).toBe(false);
    expect(validateEntry(entryOf([{ ...validTask, priority: 1.5 }]), '2026-10-28').ok).toBe(false);
  });

  test('priority 为 0/1/2 时通过', () => {
    for (const priority of [0, 1, 2]) {
      expect(validateEntry(entryOf([{ ...validTask, priority }]), '2026-10-28').ok).toBe(true);
    }
  });

  test('title 仅含空白时报错且错误信息带任务序号', () => {
    const errors = errorsOf(entryOf([validTask, { ...validTask, id: 't-2', title: '   ' }]));
    expect(errors.join()).toContain('title');
    expect(errors.join()).toContain('2');
  });

  test('done 非布尔时报错', () => {
    expect(validateEntry(entryOf([{ ...validTask, done: 'true' }]), '2026-10-28').ok).toBe(false);
  });

  test('tags 含非字符串时报错', () => {
    expect(validateEntry(entryOf([{ ...validTask, tags: ['a', 1] }]), '2026-10-28').ok).toBe(false);
  });

  test('tags 不是数组时报错', () => {
    expect(validateEntry(entryOf([{ ...validTask, tags: 'a' }]), '2026-10-28').ok).toBe(false);
  });

  test('id 为空字符串时报错', () => {
    expect(validateEntry(entryOf([{ ...validTask, id: '' }]), '2026-10-28').ok).toBe(false);
  });

  test('timeBlock 为 null 时通过', () => {
    expect(validateEntry(entryOf([{ ...validTask, timeBlock: null }]), '2026-10-28').ok).toBe(true);
  });

  test('timeBlock 的 end 不晚于 start 时报错', () => {
    expect(
      validateEntry(entryOf([{ ...validTask, timeBlock: { start: '10:00', end: '10:00' } }]), '2026-10-28').ok,
    ).toBe(false);
    expect(
      validateEntry(entryOf([{ ...validTask, timeBlock: { start: '10:00', end: '09:00' } }]), '2026-10-28').ok,
    ).toBe(false);
  });

  test('timeBlock 的 end 晚于 start 时通过', () => {
    expect(
      validateEntry(entryOf([{ ...validTask, timeBlock: { start: '09:00', end: '10:30' } }]), '2026-10-28').ok,
    ).toBe(true);
  });

  test('task 不是对象时报错而不抛异常', () => {
    expect(validateEntry(entryOf([null]), '2026-10-28').ok).toBe(false);
    expect(validateEntry(entryOf(['x']), '2026-10-28').ok).toBe(false);
  });

  test('越界值被收集而非静默修正：多个 task 的错误一次性返回', () => {
    const errors = errorsOf(
      entryOf([
        { ...validTask, id: 'a', priority: 9 },
        { ...validTask, id: 'b', title: '' },
        { ...validTask, id: 'c', done: 1 },
      ]),
    );
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  test('手写文件可省略元数据：缺失字段填中性默认值，但必填项仍必须存在', () => {
    const minimal = { id: 'a', title: '手写一天', done: false, priority: 0, tags: [], timeBlock: null };
    const r = validateEntry({ date: '2026-10-28', tasks: [minimal] }, '2026-10-28');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.tasks[0]).toEqual({
      id: 'a',
      title: '手写一天',
      done: false,
      completedAt: null,
      order: 0,
      priority: 0,
      tags: [],
      note: '',
      timeBlock: null,
      createdAt: '',
      updatedAt: '',
    });
  });

  test('必填项缺失仍然报错，不会被默认值掩盖', () => {
    const withoutPriority = { id: 'a', title: '标题', done: false, tags: [], timeBlock: null };
    expect(validateEntry({ date: '2026-10-28', tasks: [withoutPriority] }, '2026-10-28').ok).toBe(false);
  });

  test('timeBlock 省略（undefined）视同 null', () => {
    const withoutTimeBlock = { id: 'a', title: '标题', done: false, priority: 0, tags: [] };
    expect(validateEntry({ date: '2026-10-28', tasks: [withoutTimeBlock] }, '2026-10-28').ok).toBe(true);
  });

  test('未知字段被丢弃，输出始终是定形的 Task', () => {
    const r = validateEntry(entryOf([{ ...validTask, extra: 'x', hidden: 1 }]), '2026-10-28');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.entry.tasks[0] as object).sort()).toEqual(
      [
        'completedAt',
        'createdAt',
        'done',
        'id',
        'note',
        'order',
        'priority',
        'tags',
        'timeBlock',
        'title',
        'updatedAt',
      ].sort(),
    );
  });
});

describe('serializeEntry / parseEntry', () => {
  test('serializeEntry 往返稳定', () => {
    const e: DayEntry = { date: '2026-10-28', tasks: [validTask] };
    const back = parseEntry(serializeEntry(e), '2026-10-28');
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.entry).toEqual(e);
  });

  test('serializeEntry 使用 2 空格缩进并以换行结尾', () => {
    const text = serializeEntry({ date: '2026-10-28', tasks: [] });
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toBe('{\n  "date": "2026-10-28",\n  "tasks": []\n}\n');
  });

  test('serializeEntry 输出可被 JSON.parse 解析', () => {
    const text = serializeEntry({ date: '2026-10-28', tasks: [validTask] });
    expect(() => JSON.parse(text)).not.toThrow();
  });

  test('parseEntry 遇到坏 JSON 返回错误而不抛异常', () => {
    const r = parseEntry('{ not json', '2026-10-28');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });

  test('parseEntry 把内容 date 与文件名不符的输入判为错误', () => {
    const text = JSON.stringify({ date: '2026-10-27', tasks: [] });
    expect(parseEntry(text, '2026-10-28').ok).toBe(false);
  });

  test('parseEntry 对合法文本返回条目', () => {
    const r = parseEntry(JSON.stringify({ date: '2026-10-28', tasks: [] }), '2026-10-28');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry).toEqual({ date: '2026-10-28', tasks: [] });
  });
});

describe('entryPath', () => {
  test('entryPath 归档路径按年份分目录', () => {
    expect(entryPath('archive', '2025-11-03', { activeDir: 'a', archiveDir: 'b' })).toBe('b/2025/2025-11-03.json');
  });

  test('entryPath 活跃路径直接放在 activeDir 下', () => {
    expect(entryPath('active', '2026-10-28', { activeDir: 'src/data/todos', archiveDir: 'b' })).toBe(
      'src/data/todos/2026-10-28.json',
    );
  });

  test('entryPath 不使用反斜杠', () => {
    expect(entryPath('archive', '2025-01-02', { activeDir: 'a', archiveDir: 'b' })).not.toContain('\\');
  });
});

/**
 * 守卫：`entry-codec.ts` 必须保持浏览器可用，不得出现任何 `node:` 依赖。
 * 后台发布逻辑在浏览器里 import 这个模块，一旦引入 `node:fs`，客户端构建就会失败。
 */
describe('守卫：entry-codec 不含 node 依赖', () => {
  test('entry-codec 不含 node 依赖', () => {
    const src = readFileSync('src/lib/entry-codec.ts', 'utf8');
    expect(src).not.toMatch(/from ['"]node:/);
  });
});
