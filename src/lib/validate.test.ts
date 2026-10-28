import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import type { DayEntry, Task } from './types';
import { normalizeTask, validateDay, validateTask } from './validate';

/** 全部字段合法的基准 task；每个用例只覆盖自己要测的那一条规则。 */
const base: Task = {
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

function taskOf(patch: Partial<Task> = {}): Task {
  return { ...base, ...patch };
}

const MSG_TITLE_REQUIRED = '待办需要一个标题。';
const MSG_TITLE_TOO_LONG = '标题最多 200 字，长内容请写进备注。';
const MSG_NOTE_TOO_LONG = '备注最多 2000 字。';
const MSG_TAGS = '最多 10 个标签，每个不超过 20 字。';
const MSG_TIME_BLOCK = '结束时间要晚于开始时间。';
const MSG_DUPLICATE_ID = '出现重复标识，请删除后重新添加这一条。';

describe('validateTask：合法输入', () => {
  test('完全合法的 task 返回空数组', () => {
    expect(validateTask(base)).toEqual([]);
  });

  test('timeBlock 为 null 是合法的', () => {
    expect(validateTask(taskOf({ timeBlock: null }))).toEqual([]);
  });

  test('tags 为空数组是合法的', () => {
    expect(validateTask(taskOf({ tags: [] }))).toEqual([]);
  });

  test('end > start 的 timeBlock 是合法的', () => {
    expect(validateTask(taskOf({ timeBlock: { start: '09:00', end: '10:30' } }))).toEqual([]);
  });

  test('标题两侧空白不算内容，但去掉空白后非空即合法', () => {
    expect(validateTask(taskOf({ title: '  写周报  ' }))).toEqual([]);
  });
});

describe('validateTask：标题', () => {
  test('空标题', () => {
    expect(validateTask(taskOf({ title: '  ' }))).toContain(MSG_TITLE_REQUIRED);
  });

  test('空标题只报一条，不叠加长度错误', () => {
    expect(validateTask(taskOf({ title: '' }))).toEqual([MSG_TITLE_REQUIRED]);
  });

  test('标题刚好 200 字通过', () => {
    expect(validateTask(taskOf({ title: 'x'.repeat(200) }))).toEqual([]);
  });

  test('标题 201 字被拒', () => {
    expect(validateTask(taskOf({ title: 'x'.repeat(201) }))).toEqual([MSG_TITLE_TOO_LONG]);
  });

  test('长度按去掉两侧空白后的内容算', () => {
    expect(validateTask(taskOf({ title: `  ${'x'.repeat(200)}  ` }))).toEqual([]);
  });

  test('长度按字符（码点）算：200 个 emoji 通过，201 个被拒', () => {
    // `'😀'.length === 2`，用 UTF-16 码元计数会把 200 个 emoji 算成 400 字而误判超长。
    expect(validateTask(taskOf({ title: '😀'.repeat(200) }))).toEqual([]);
    expect(validateTask(taskOf({ title: '😀'.repeat(201) }))).toEqual([MSG_TITLE_TOO_LONG]);
  });
});

describe('validateTask：备注', () => {
  test('备注刚好 2000 字通过', () => {
    expect(validateTask(taskOf({ note: 'x'.repeat(2000) }))).toEqual([]);
  });

  test('备注 2001 字被拒', () => {
    expect(validateTask(taskOf({ note: 'x'.repeat(2001) }))).toEqual([MSG_NOTE_TOO_LONG]);
  });

  test('空备注是合法的', () => {
    expect(validateTask(taskOf({ note: '' }))).toEqual([]);
  });
});

describe('validateTask：标签', () => {
  test('刚好 10 个标签、每个 20 字通过', () => {
    const tags = Array.from({ length: 10 }, (_, i) => `${i}`.padEnd(20, 'x'));
    expect(validateTask(taskOf({ tags }))).toEqual([]);
  });

  test('标签上限 10 个', () => {
    const tags = Array.from({ length: 11 }, (_, i) => `tag-${i}`);
    expect(validateTask(taskOf({ tags }))).toEqual([MSG_TAGS]);
  });

  test('单个标签超过 20 字被拒', () => {
    expect(validateTask(taskOf({ tags: ['x'.repeat(21)] }))).toEqual([MSG_TAGS]);
  });

  test('标签里混着一个超长标签也报同一条文案（只报一次）', () => {
    const tags = ['工作', 'x'.repeat(25), 'y'.repeat(30)];
    expect(validateTask(taskOf({ tags }))).toEqual([MSG_TAGS]);
  });

  test('重复标签不去重计数：11 个（含重复）仍然超限', () => {
    // 去重后计数会让面板上明明排着 11 个胶囊的列表通过校验；用户看得见几个就该判几个。
    const tags = ['工作', '工作', ...Array.from({ length: 9 }, (_, i) => `tag-${i}`)];
    expect(validateTask(taskOf({ tags }))).toEqual([MSG_TAGS]);
  });

  test('空白标签不计入数量上限', () => {
    const tags = [...Array.from({ length: 10 }, (_, i) => `tag-${i}`), '  ', ''];
    expect(validateTask(taskOf({ tags }))).toEqual([]);
  });
});

describe('validateTask：时间块', () => {
  test('结束时间早于开始时间', () => {
    expect(validateTask(taskOf({ timeBlock: { start: '10:00', end: '09:00' } }))).toEqual([
      MSG_TIME_BLOCK,
    ]);
  });

  test('结束时间等于开始时间同样被拒', () => {
    expect(validateTask(taskOf({ timeBlock: { start: '10:00', end: '10:00' } }))).toEqual([
      MSG_TIME_BLOCK,
    ]);
  });

  test('跨零点（23:00 → 01:00）算倒序，被拒', () => {
    expect(validateTask(taskOf({ timeBlock: { start: '23:00', end: '01:00' } }))).toEqual([
      MSG_TIME_BLOCK,
    ]);
  });
});

describe('validateTask：多条错误一次收齐', () => {
  test('空标题 + 超长备注 + 倒序时间块 → 三条', () => {
    const errors = validateTask(
      taskOf({ title: ' ', note: 'x'.repeat(2001), timeBlock: { start: '10:00', end: '09:00' } }),
    );
    expect(errors).toEqual([MSG_TITLE_REQUIRED, MSG_NOTE_TOO_LONG, MSG_TIME_BLOCK]);
  });

  test('每条错误都以中文句号结尾', () => {
    const errors = validateTask(
      taskOf({
        title: 'x'.repeat(201),
        note: 'x'.repeat(2001),
        tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`),
        timeBlock: { start: '10:00', end: '09:00' },
      }),
    );
    expect(errors).toHaveLength(4);
    for (const e of errors) expect(e.endsWith('。')).toBe(true);
  });
});

describe('validateDay', () => {
  function entryOf(tasks: Task[]): DayEntry {
    return { date: '2026-10-28', tasks };
  }

  test('一天里所有任务都合法时返回空数组', () => {
    expect(validateDay(entryOf([base, taskOf({ id: 't-2' })]))).toEqual([]);
  });

  test('空的一天是合法的', () => {
    expect(validateDay(entryOf([]))).toEqual([]);
  });

  test('汇总各条任务的错误', () => {
    const errors = validateDay(entryOf([taskOf({ id: 't-1', title: ' ' }), taskOf({ id: 't-2' })]));
    expect(errors).toEqual([MSG_TITLE_REQUIRED]);
  });

  test('同日任务 id 重复时报重复标识', () => {
    const errors = validateDay(entryOf([taskOf({ id: 'dup' }), taskOf({ id: 'dup' })]));
    expect(errors).toEqual([MSG_DUPLICATE_ID]);
  });

  test('同一个 id 出现三次只报一条重复标识', () => {
    const errors = validateDay(
      entryOf([taskOf({ id: 'dup' }), taskOf({ id: 'dup' }), taskOf({ id: 'dup' })]),
    );
    expect(errors).toEqual([MSG_DUPLICATE_ID]);
  });

  test('两个不同 id 各自重复 → 两条重复标识', () => {
    const errors = validateDay(
      entryOf([
        taskOf({ id: 'a' }),
        taskOf({ id: 'a' }),
        taskOf({ id: 'b' }),
        taskOf({ id: 'b' }),
      ]),
    );
    expect(errors).toEqual([MSG_DUPLICATE_ID, MSG_DUPLICATE_ID]);
  });

  test('重复标识与字段错误同时存在时两者都报', () => {
    const errors = validateDay(entryOf([taskOf({ id: 'dup', title: ' ' }), taskOf({ id: 'dup' })]));
    expect(errors).toEqual([MSG_TITLE_REQUIRED, MSG_DUPLICATE_ID]);
  });
});

describe('normalizeTask', () => {
  const now = new Date('2026-10-28T02:03:04.000Z');

  test('done 为 true 且缺 completedAt 时自动补全', () => {
    const t = normalizeTask({ ...base, done: true, completedAt: null });
    expect(t.completedAt).not.toBeNull();
  });

  test('补全用的是注入的 now 的 ISO 时间戳', () => {
    expect(normalizeTask({ ...base, done: true, completedAt: null }, now).completedAt).toBe(
      '2026-10-28T02:03:04.000Z',
    );
  });

  test('completedAt 为空串时同样补全', () => {
    expect(normalizeTask({ ...base, done: true, completedAt: '   ' }, now).completedAt).toBe(
      '2026-10-28T02:03:04.000Z',
    );
  });

  test('未完成的 task 不会被塞 completedAt', () => {
    expect(normalizeTask({ ...base, done: false, completedAt: null }, now).completedAt).toBeNull();
  });

  test('已有 completedAt 不被覆盖', () => {
    const t = normalizeTask(
      { ...base, done: true, completedAt: '2026-10-01T00:00:00.000Z' },
      now,
    );
    expect(t.completedAt).toBe('2026-10-01T00:00:00.000Z');
  });

  test('tags 去空白、去空串、去重（保留首次出现顺序）', () => {
    const t = normalizeTask({ ...base, tags: [' 工作 ', '', '生活', '工作', '   '] }, now);
    expect(t.tags).toEqual(['工作', '生活']);
  });

  test('order 原样保留（重排整天 order 是调用方的事）', () => {
    expect(normalizeTask({ ...base, order: 7 }, now).order).toBe(7);
  });

  test('不修改入参，返回新对象', () => {
    const input: Task = { ...base, done: true, completedAt: null, tags: [' 工作 ', '工作'] };
    const snapshot = JSON.parse(JSON.stringify(input)) as Task;
    const out = normalizeTask(input, now);
    expect(out).not.toBe(input);
    expect(input).toEqual(snapshot);
    expect(out.tags).not.toBe(input.tags);
  });

  test('其余字段保持不变', () => {
    const out = normalizeTask({ ...base, title: '  带空白的标题  ' }, now);
    expect(out.title).toBe('  带空白的标题  ');
    expect(out.createdAt).toBe(base.createdAt);
    expect(out.updatedAt).toBe(base.updatedAt);
    expect(out.priority).toBe(base.priority);
  });
});

describe('模块边界', () => {
  test('validate.ts 不含 node 依赖', () => {
    const src = readFileSync('src/lib/validate.ts', 'utf8');
    expect(src).not.toMatch(/from ['"]node:/);
  });
});
