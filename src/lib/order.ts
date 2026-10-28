/**
 * 任务排序：把一天的任务切成「有时间段」与「无时间段」两组，各自排好。
 *
 * 排版意图（spec §"今日 + 单日页"）：有时间段的任务按开始时间自上而下排成日程，
 * 其余任务按手写的 `order` 排在后面。页面把两组先后渲染，就是读者看到的顺序。
 *
 * 铁律：
 * - **不修改入参**：构建期同一份 `DayEntry.tasks` 会被多个页面复用，就地 `sort()`
 *   会让后面的页面拿到被改过的数组。这里先 `filter` 出副本再排。
 * - `timeBlock.start` 用字符串比较，依赖零填充 `HH:MM`（`validate.ts` 已强制该格式）。
 * - 相等时按 `order`；`order` 也相等时保持原有相对次序（`Array#sort` 稳定）。
 */

import type { Task } from './types';

export type OrderedTasks = { scheduled: Task[]; unscheduled: Task[] };

function compareOrder(a: Task, b: Task): number {
  return a.order - b.order;
}

/**
 * `scheduled`：有 `timeBlock` 的任务，按 `timeBlock.start` 升序，同一开始时间按 `order` 升序。
 * `unscheduled`：`timeBlock` 为 `null` 的任务，按 `order` 升序。
 */
export function orderTasks(tasks: Task[]): OrderedTasks {
  const scheduled = tasks
    .filter((task) => task.timeBlock !== null)
    .sort((a, b) => {
      // 非空断言由上面的 filter 保证；用 as 而非 ! 是为了让意图写在类型上
      const aStart = (a.timeBlock as NonNullable<Task['timeBlock']>).start;
      const bStart = (b.timeBlock as NonNullable<Task['timeBlock']>).start;
      if (aStart < bStart) return -1;
      if (aStart > bStart) return 1;
      return compareOrder(a, b);
    });

  const unscheduled = tasks.filter((task) => task.timeBlock === null).sort(compareOrder);

  return { scheduled, unscheduled };
}
