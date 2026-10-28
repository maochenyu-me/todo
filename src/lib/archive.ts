/**
 * 归档搬迁的**决策**纯函数（不碰文件系统，动手搬是 `scripts/archive.mjs` 的事）。
 *
 * 铁律：本文件不得 import `node:*`，也不得 import 任何框架。
 *
 * 边界语义（已裁决，勿改成 `monthsBetween(...) > afterMonths`）：
 * 用**截止日比较** `dateKey < addMonths(todayKey, -afterMonths)`。
 * `afterMonths = 6`、`today = 2026-10-28` 时截止日为 `2026-04-28`：
 * `2026-04-27` 搬、`2026-04-28` 不搬（恰好满 6 个月当天仍算活跃）。
 */

import { addMonths } from './date';

/**
 * 该日期的条目是否应搬进归档区。
 *
 * 日期 key 是零填充的 `YYYY-MM-DD`，字典序即时间序，故直接用字符串比较，不必转 `Date`。
 */
export function shouldArchive(dateKey: string, todayKey: string, afterMonths: number): boolean {
  return dateKey < addMonths(todayKey, -afterMonths);
}

/**
 * 从一批日期 key 里挑出该搬的，返回 `{ move }`。
 *
 * `move` 已**去重**并**升序**：同一文件被扫到两次（活跃区与归档区都读了、或多轮搬迁重跑）
 * 也只搬一次；升序让搬迁日志与 git diff 稳定可读。入参数组不改。
 */
export function planArchiveMove(
  dateKeys: string[],
  todayKey: string,
  afterMonths: number,
): { move: string[] } {
  const move = [...new Set(dateKeys)]
    .filter((key) => shouldArchive(key, todayKey, afterMonths))
    .sort();
  return { move };
}
