/**
 * 单页任务数护栏：`frontend.maxTasksPerPage` 的落地。
 *
 * 为什么单独一层：这个上限是**防病态数据的护栏**，不是排版目标。真正的排版意图是
 * 「一天的事都显示出来」。一旦上限被当成排版规则，就会出现两种坏结果——
 * 配置成 0 时整站每天渲染成空页，或者提示文案写成「另有 N 条超出单页显示上限（0 条）」。
 * 把它抽成纯函数，边界全靠单测钉死，页面只管把结果画出来。
 */

import type { Task } from './types';

export type CappedTasks = {
  /** 实际渲染的那一段。 */
  shown: Task[];
  /** 因上限而未渲染的条数；`0` 表示没有截断。 */
  hidden: number;
  /** 生效的上限；`null` 表示未设上限（不限）。 */
  cap: number | null;
};

/**
 * 按上限截取任务列表。
 *
 * **非整数、`<= 0`、`NaN`、`Infinity` 一律视为「不限」**（`cap: null`）。
 * 理由：上限的唯一职责是「别让一个坏文件把页面撑爆」，而 `0` 起不到这个作用——
 * 它只会让每天都变成空页，反而把护栏变成了故障源。既然「不限」本来就是合法状态
 * （默认值 200 只是给个界，不是排版要求），把所有非正数/非有限值统一归到「不限」
 * 比逐个猜测配置者的意图更可预测，也不可能说出「（0 条）」这种自相矛盾的话。
 */
export function capTasks(tasks: Task[], maxTasksPerPage: number): CappedTasks {
  const limit =
    Number.isFinite(maxTasksPerPage) && maxTasksPerPage > 0
      ? Math.floor(maxTasksPerPage)
      : null;

  if (limit === null) return { shown: [...tasks], hidden: 0, cap: null };

  // 向下取整后仍可能是 0（例如 `0.4`），此时同样是「不限」而非「全藏」。
  if (limit < 1) return { shown: [...tasks], hidden: 0, cap: null };

  const shown = tasks.slice(0, limit);
  return { shown, hidden: tasks.length - shown.length, cap: limit };
}
