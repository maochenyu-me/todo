import { describe, expect, test } from 'vitest';

import type { DayEntry, Task } from '@/lib/types';

import { adminReducer, type AdminState } from './machine';
import {
  addTask,
  deleteTask,
  moveTask,
  newTaskId,
  toggleDone,
  updateTask,
  type TaskDraft,
} from './operations';

/**
 * 五个编辑操作（`./operations.ts`）的测试。
 *
 * 铁律是「操作**全部**经 `PATCH_DAY` 落 reducer」——所以这里每个用例走的都是
 * 完整链路：纯函数算出新的一天 → `dispatch` 进 `adminReducer` → 断言落库后的
 * `days` / `dirty`。只测纯函数本身会漏掉「绕开 reducer」这种回归。
 *
 * 纯函数的边界行为（首行上移、末行下移、找不到 id）单独一组：它们约定返回
 * **同一个引用**，调用方不必自己判边界。
 */

const DATE = '2026-10-28';
const DATE2 = '2026-10-27';

const NOW = new Date('2026-10-28T18:00:00+08:00');
const NOW_ISO = NOW.toISOString();

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: `任务 ${overrides.id}`,
    done: false,
    completedAt: null,
    order: 0,
    priority: 1,
    tags: [],
    note: '',
    timeBlock: null,
    createdAt: `${DATE}T09:00:00+08:00`,
    updatedAt: `${DATE}T09:00:00+08:00`,
    ...overrides,
  };
}

/** 三条任务的一天，`order` 稠密（0..2）。 */
function sampleEntry(): DayEntry {
  return {
    date: DATE,
    tasks: [
      task({ id: 'a1', order: 0 }),
      task({ id: 'b2', order: 1, priority: 0, timeBlock: { start: '09:00', end: '10:00' } }),
      task({ id: 'c3', order: 2, done: true, completedAt: `${DATE}T10:00:00+08:00` }),
    ],
  };
}

function readyState(): AdminState & { status: 'ready' } {
  return {
    status: 'ready',
    days: {
      [DATE]: sampleEntry(),
      [DATE2]: { date: DATE2, tasks: [] },
    },
    selected: DATE,
    dirty: new Set<string>(),
    tokenExpiresAt: null,
  };
}

const DRAFT: TaskDraft = {
  title: '新任务',
  note: '',
  timeBlock: null,
  priority: 1,
  tags: [],
  done: false,
};

/** 走完整链路：纯函数 → PATCH_DAY → ready 状态。 */
function patch(state: AdminState, next: DayEntry): AdminState & { status: 'ready' } {
  const result = adminReducer(state, { type: 'PATCH_DAY', day: next });
  expect(result.status).toBe('ready');
  return result as AdminState & { status: 'ready' };
}

describe('五个操作经 PATCH_DAY 落库', () => {
  test('addTask：追加到末尾、order 接续、updatedAt 刷新、标记 dirty', () => {
    const before = readyState();
    const entry = before.days[DATE];
    const after = patch(before, addTask(entry, DRAFT, { now: NOW, id: 'd4' }));

    expect(after.dirty).toEqual(new Set([DATE]));
    // 其他天不受影响（同一个引用）。
    expect(after.days[DATE2]).toBe(before.days[DATE2]);

    const tasks = after.days[DATE].tasks;
    expect(tasks).toHaveLength(4);
    expect(tasks[3].id).toBe('d4');
    expect(tasks[3].order).toBe(3);
    expect(tasks[3].createdAt).toBe(NOW_ISO);
    expect(tasks[3].updatedAt).toBe(NOW_ISO);
    // 内容字段来自 draft。
    expect(tasks[3].title).toBe('新任务');
  });

  test('updateTask：按 id 替换内容、刷新 updatedAt、保留 order', () => {
    const before = readyState();
    const entry = before.days[DATE];
    const target = entry.tasks[1];
    const after = patch(
      before,
      updateTask(entry, { ...target, title: '改过的标题', note: '加了备注' }, NOW),
    );

    const tasks = after.days[DATE].tasks;
    expect(tasks).toHaveLength(3);
    expect(tasks[1].title).toBe('改过的标题');
    expect(tasks[1].note).toBe('加了备注');
    expect(tasks[1].updatedAt).toBe(NOW_ISO);
    // 同一天里其他任务原样（同一引用）。
    expect(tasks[0]).toBe(entry.tasks[0]);
    expect(tasks[2]).toBe(entry.tasks[2]);
  });

  test('deleteTask：从 reducer 里消失并重排 order', () => {
    const before = readyState();
    const entry = before.days[DATE];
    const after = patch(before, deleteTask(entry, 'b2'));

    const tasks = after.days[DATE].tasks;
    expect(tasks.map((t) => t.id)).toEqual(['a1', 'c3']);
    // 重排是稠密的：删除中间一条后，后面的补位。
    expect(tasks.map((t) => t.order)).toEqual([0, 1]);
    expect(tasks[0]).toBe(entry.tasks[0]); // order 没变的保持原引用
    expect(tasks[1].id).toBe('c3');
    expect(tasks[1].order).toBe(1);
  });

  test('moveTask：上移/下移交换相邻位置且 order 跟随', () => {
    const before = readyState();
    const entry = before.days[DATE];

    const up = patch(before, moveTask(entry, 'b2', 'up'));
    expect(up.days[DATE].tasks.map((t) => t.id)).toEqual(['b2', 'a1', 'c3']);
    expect(up.days[DATE].tasks.map((t) => t.order)).toEqual([0, 1, 2]);

    const down = patch(before, moveTask(entry, 'b2', 'down'));
    expect(down.days[DATE].tasks.map((t) => t.id)).toEqual(['a1', 'c3', 'b2']);
    expect(down.days[DATE].tasks.map((t) => t.order)).toEqual([0, 1, 2]);
  });

  test('toggleDone：勾上补 completedAt，再取消保留 completedAt', () => {
    const before = readyState();
    const entry = before.days[DATE];

    const done = patch(before, toggleDone(entry, 'a1', NOW));
    const afterDone = done.days[DATE].tasks.find((t) => t.id === 'a1');
    expect(afterDone?.done).toBe(true);
    expect(afterDone?.completedAt).toBe(NOW_ISO); // normalizeTask 的自愈

    const undone = patch(before, toggleDone(done.days[DATE], 'a1', NOW));
    const afterUndone = undone.days[DATE].tasks.find((t) => t.id === 'a1');
    expect(afterUndone?.done).toBe(false);
    // 取消勾选不清掉用户的完成记录。
    expect(afterUndone?.completedAt).toBe(NOW_ISO);
  });
});

describe('moveTask 边界：原样返回同一引用', () => {
  const entry = sampleEntry();

  test('首行上移', () => {
    expect(moveTask(entry, 'a1', 'up')).toBe(entry);
  });

  test('末行下移', () => {
    expect(moveTask(entry, 'c3', 'down')).toBe(entry);
  });

  test('找不到 id', () => {
    expect(moveTask(entry, 'nope', 'up')).toBe(entry);
    expect(moveTask(entry, 'nope', 'down')).toBe(entry);
  });
});

describe('纯函数的边界', () => {
  test('deleteTask 找不到 id 时原样返回', () => {
    const entry = sampleEntry();
    expect(deleteTask(entry, 'nope')).toBe(entry);
  });

  test('updateTask 找不到 id 时原样返回', () => {
    const entry = sampleEntry();
    expect(updateTask(entry, task({ id: 'nope' }), NOW)).toBe(entry);
  });

  test('toggleDone 找不到 id 时原样返回', () => {
    const entry = sampleEntry();
    expect(toggleDone(entry, 'nope', NOW)).toBe(entry);
  });

  test('addTask 过 normalizeTask：标签去空白去重、勾选时补 completedAt', () => {
    const entry = sampleEntry();
    const after = addTask(
      entry,
      { ...DRAFT, tags: [' 工作 ', '深度', '工作', ''], done: true },
      { now: NOW, id: 'd4' },
    );
    expect(after.tasks[3].tags).toEqual(['工作', '深度']);
    expect(after.tasks[3].completedAt).toBe(NOW_ISO);
  });

  test('纯函数不修改入参（addTask / moveTask / deleteTask）', () => {
    const entry = sampleEntry();
    addTask(entry, DRAFT, { now: NOW, id: 'd4' });
    moveTask(entry, 'b2', 'up');
    deleteTask(entry, 'a1');
    expect(entry.tasks.map((t) => t.id)).toEqual(['a1', 'b2', 'c3']);
    expect(entry.tasks.map((t) => t.order)).toEqual([0, 1, 2]);
  });
});

describe('操作序列之后的不变量', () => {
  test('dirty 永远是 days 的子集', () => {
    let state = readyState();
    let entry = state.days[DATE];

    entry = addTask(entry, DRAFT, { now: NOW, id: 'd4' });
    state = patch(state, entry);
    entry = moveTask(entry, 'a1', 'down');
    state = patch(state, entry);
    entry = deleteTask(entry, 'b2');
    state = patch(state, entry);
    entry = toggleDone(entry, 'c3', NOW);
    state = patch(state, entry);
    entry = updateTask(entry, { ...entry.tasks[0], title: '再改一次' }, NOW);
    state = patch(state, entry);

    for (const date of state.dirty) {
      expect(state.days[date]).toBeDefined();
    }
    expect(state.dirty).toEqual(new Set([DATE]));
  });

  test('SELECT_DAY 换天不碰 dirty，PATCH_DAY 只标记当天', () => {
    let state = readyState();
    state = patch(state, addTask(state.days[DATE], DRAFT, { now: NOW, id: 'd4' }));
    expect(state.dirty).toEqual(new Set([DATE]));

    const switched = adminReducer(state, { type: 'SELECT_DAY', date: DATE2 });
    expect(switched.status).toBe('ready');
    expect((switched as { dirty: Set<string> }).dirty).toEqual(new Set([DATE]));

    const other = patch(
      switched as AdminState & { status: 'ready' },
      addTask((switched as { days: Record<string, DayEntry> }).days[DATE2], DRAFT, {
        now: NOW,
        id: 'e5',
      }),
    );
    expect(other.dirty).toEqual(new Set([DATE, DATE2]));
  });
});

describe('newTaskId', () => {
  test('8 个十六进制字符', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(newTaskId()).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  test('连续生成不重复（单机编辑器的碰撞要求）', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newTaskId()));
    expect(ids.size).toBe(100);
  });
});
