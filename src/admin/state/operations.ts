/**
 * 后台编辑面板的**五个操作**（新增 / 更新 / 删除 / 移动 / 勾选）—— 纯的 `DayEntry` 变换。
 *
 * ## 为什么单独一层
 *
 * 铁律（见 task-15 brief）：五个操作**全部经 `PATCH_DAY` 落到 reducer**（`./machine.ts`）。
 * 本文件只负责「旧的一天 → 新的一天」这条纯计算：不碰 dispatch、不碰 React、不做 I/O。
 * 这样以后加新的编辑入口（比如手势、批量操作）时，把同一批纯函数接上 `PATCH_DAY`
 * 就行，行为与测试原样复用。
 *
 * ## `order` 的约定
 *
 * `entry.tasks` 的**数组顺序**就是编辑器里看到的手写顺序；`order` 字段必须随时与
 * 数组下标一致（0..n-1）。改动数组形状的操作（增、删、移）最后都过 `reindex()`
 * 收敛回稠密编号——公开页面的排序（`order.ts`）与落盘 diff 都靠这一点稳定。
 *
 * ## 时间戳约定
 *
 * - `addTask` / `updateTask` / `toggleDone` 会刷新 `updatedAt`（内容变了）；
 * - `deleteTask` / `moveTask` **不改**任何一条的内容时间戳：删除没有"被改的那条"，
 *   移动只重排位置，`updatedAt` 记录的是内容变化，不是位置变化。
 *
 * 铁律：本文件不得 import `node:*`，也不得 import 任何框架——后台在浏览器里跑。
 */

import type { DayEntry, Task } from '@/lib/types';

import { normalizeTask } from '../../lib/validate';

/**
 * 新增/编辑对话框提交的**表单字段**：只有用户能直接编辑的部分。
 * `id` / `createdAt` / `order` 这类元数据由本文件的函数负责，不进表单。
 */
export type TaskDraft = Pick<Task, 'title' | 'note' | 'timeBlock' | 'priority' | 'tags' | 'done'>;

/** 生成一条新任务的 id：8 个十六进制字符（`crypto.randomUUID` 去连字符取前 8 位）。 */
export function newTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  }
  // 极老浏览器没有 randomUUID：降级成 Math.random，碰撞概率依然可忽略（编辑器单机使用）。
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

/** 把 `order` 收敛成与数组下标一致的稠密编号；没变的条目保持原对象（不制造无谓 diff）。 */
function reindex(tasks: Task[]): Task[] {
  return tasks.map((task, index) => (task.order === index ? task : { ...task, order: index }));
}

/** 追加一条新任务到当天末尾；入库前过 `normalizeTask`（补 `completedAt`、标签去重）。 */
export function addTask(
  entry: DayEntry,
  draft: TaskDraft,
  options: { now?: Date; id?: string } = {},
): DayEntry {
  const now = (options.now ?? new Date()).toISOString();
  const task = normalizeTask(
    {
      id: options.id ?? newTaskId(),
      title: draft.title,
      done: draft.done,
      completedAt: null,
      order: entry.tasks.length,
      priority: draft.priority,
      tags: [...draft.tags],
      note: draft.note,
      timeBlock: draft.timeBlock === null ? null : { ...draft.timeBlock },
      createdAt: now,
      updatedAt: now,
    },
    new Date(now),
  );
  return { ...entry, tasks: [...entry.tasks, task] };
}

/** 替换同一条任务的内容（按 `id` 匹配），刷新 `updatedAt`；找不到时不做任何事。 */
export function updateTask(entry: DayEntry, task: Task, now: Date = new Date()): DayEntry {
  const index = entry.tasks.findIndex((t) => t.id === task.id);
  if (index === -1) return entry;
  const next = normalizeTask({ ...task, updatedAt: now.toISOString() }, now);
  const tasks = [...entry.tasks];
  tasks[index] = next;
  return { ...entry, tasks };
}

/** 删除一条任务并重排 `order`；找不到该 id 时原样返回（同一引用）。 */
export function deleteTask(entry: DayEntry, id: string): DayEntry {
  const tasks = entry.tasks.filter((t) => t.id !== id);
  if (tasks.length === entry.tasks.length) return entry;
  return { ...entry, tasks: reindex(tasks) };
}

/**
 * 在数组内与相邻一条**交换位置**后重排 `order`（不引拖拽库）。
 * 首行上移 / 末行下移 / 找不到 id 都原样返回（同一引用）——调用方不用自己判边界。
 */
export function moveTask(entry: DayEntry, id: string, dir: 'up' | 'down'): DayEntry {
  const index = entry.tasks.findIndex((t) => t.id === id);
  if (index === -1) return entry;
  const target = dir === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= entry.tasks.length) return entry;
  const tasks = [...entry.tasks];
  [tasks[index], tasks[target]] = [tasks[target]!, tasks[index]!];
  return { ...entry, tasks: reindex(tasks) };
}

/**
 * 翻转完成状态；入库前过 `normalizeTask`：勾掉时自动补 `completedAt`，
 * 取消勾选时**保留**已有的 `completedAt`（那是用户的记录，不该被静默抹掉）。
 */
export function toggleDone(entry: DayEntry, id: string, now: Date = new Date()): DayEntry {
  const index = entry.tasks.findIndex((t) => t.id === id);
  if (index === -1) return entry;
  const current = entry.tasks[index]!;
  const next = normalizeTask(
    { ...current, done: !current.done, updatedAt: now.toISOString() },
    now,
  );
  const tasks = [...entry.tasks];
  tasks[index] = next;
  return { ...entry, tasks };
}
