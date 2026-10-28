/**
 * 统计聚合纯函数：完成率、连续打卡、周趋势、滚动完成率、标签分布。
 *
 * 铁律：
 * - 本文件不得 import `node:*`，也不得 import 任何框架——后台面板在浏览器里跑，
 *   统计页（T10）在构建期调用，两边都要能直接用。
 * - **所有除法先判分母**：`total === 0` 时 `rate` 一律为 `0`，全模块不得产生 `NaN`/`Infinity`。
 * - 只读入参，不修改传入的 `DayEntry[]`（构建期同一份数组会被多个页面复用）。
 *
 * 日期 key 是零填充的 `YYYY-MM-DD`，字典序即时间序，故"是否在区间内/是否未来"直接用字符串比较。
 */

import { addDays, weekdayOf } from './date';
import type { DayEntry } from './types';

export type DaySummary = { total: number; done: number; rate: number };

export type WeeklyDone = { weekStart: string; done: number; total: number };

export type RollingRatePoint = { date: string; rate: number };

export type TagStat = { tag: string; total: number; done: number };

/** 把一批条目按日期塞进 Map，方便 O(1) 查某天。同一日期重复出现时**后者覆盖前者**。 */
function indexByDate(entries: DayEntry[]): Map<string, DayEntry> {
  const map = new Map<string, DayEntry>();
  for (const entry of entries) map.set(entry.date, entry);
  return map;
}

/**
 * 单日完成情况。空的一天（`tasks` 为空）返回 `{ total: 0, done: 0, rate: 0 }`。
 *
 * `rate` 是 `done / total` 的原始比值（0..1，未四舍五入）；**`total === 0` 时固定为 0**，
 * 不做 `0/0`，因此永不 `NaN`。
 */
export function daySummary(entry: DayEntry): DaySummary {
  const total = entry.tasks.length;
  let done = 0;
  for (const task of entry.tasks) if (task.done) done += 1;
  return { total, done, rate: total === 0 ? 0 : done / total };
}

/**
 * 连续打卡天数：从 `todayKey` 往前数，**有任务且完成率 100%** 的连续天数。
 *
 * 已裁决的边界（改动前请先改测试）：
 * - **零任务的一天既不计入也不断链**——那天只是没写计划，不该惩罚。
 * - **今天完全没有记录不算断**：从昨天开始数（"今天还没写"不是断签）。
 * - **今天有记录但没全完成，连续天数为 0**——今天已经动笔却没划完，链条在此终结。
 * - 更早的日期**缺失记录（有前后、中间空）算断链**：只有"今天"享受豁免。
 * - 未来日期的记录不计入（构建期数据里若混入未来的日子，不能凭空加天数）。
 *
 * 无任何有效数据时返回 0。
 */
export function streak(entries: DayEntry[], todayKey: string): number {
  const byDate = indexByDate(entries);

  // 只关心不晚于今天的条目；一个都没有就不可能有连续天数。
  let earliest: string | null = null;
  for (const entry of entries) {
    if (entry.date > todayKey) continue;
    if (earliest === null || entry.date < earliest) earliest = entry.date;
  }
  if (earliest === null) return 0;

  let count = 0;
  let cursor = todayKey;
  while (cursor >= earliest) {
    const entry = byDate.get(cursor);
    if (!entry) {
      // 今天没有记录：豁免，从昨天接着数；更早的日期缺记录就是断链。
      if (cursor === todayKey) {
        cursor = addDays(cursor, -1);
        continue;
      }
      return count;
    }
    const summary = daySummary(entry);
    if (summary.total === 0) {
      // 零任务的一天：不计入，也不断链。
      cursor = addDays(cursor, -1);
      continue;
    }
    // 有任务但没全完成 → 链条在此终结（若正是今天，直接返回 0）。
    if (summary.done !== summary.total) return count;
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

/** 某天所在周的周一 key（周一起始；`weekdayOf` 是 0=周日，故先 +6 再取模）。 */
function mondayOf(dateKey: string): string {
  return addDays(dateKey, -((weekdayOf(dateKey) + 6) % 7));
}

/** 归一化的正数长度：负数、`NaN`、小数一律取安全的整数（`< 1` 视为 0）。 */
function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const n = Math.floor(value);
  return n > 0 ? n : 0;
}

/**
 * 近 `weeks` 周每周完成数，**最旧的在前，最后一项是 `todayKey` 所在周**。
 *
 * 注意：这里的"周"**一律以周一为起始**，与站点配置 `frontend.weekStartsOn`（仅影响日历
 * 显示的排版偏好）无关——周趋势图要跨配置稳定，不随用户改写显示偏好而变。
 *
 * 长度**恒为 `weeks`**：无数据的周以 `{ done: 0, total: 0 }` 占位（图表要有完整的格子）。
 * 晚于 `todayKey` 的条目与区间外的条目都不计入。
 */
export function weeklyDone(entries: DayEntry[], todayKey: string, weeks: number): WeeklyDone[] {
  const n = normalizeCount(weeks);
  if (n === 0) return [];

  const currentWeekStart = mondayOf(todayKey);

  const weekStarts: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) weekStarts.push(addDays(currentWeekStart, -7 * i));

  const buckets = new Map<string, WeeklyDone>();
  for (const weekStart of weekStarts) buckets.set(weekStart, { weekStart, done: 0, total: 0 });

  for (const entry of entries) {
    if (entry.date > todayKey) continue;
    const bucket = buckets.get(mondayOf(entry.date));
    if (!bucket) continue; // 不在区间内（太早）
    const summary = daySummary(entry);
    bucket.total += summary.total;
    bucket.done += summary.done;
  }

  return weekStarts.map((weekStart) => buckets.get(weekStart) as WeeklyDone);
}

/**
 * 近 `days` 天的逐日完成率，**最旧的在前，最后一项是 `todayKey`**。
 *
 * 长度恒为 `days`；`rate` 落在 0..1，无任务（含无记录）的那天为 `0`，不会 `NaN`。
 */
export function rollingRate(
  entries: DayEntry[],
  todayKey: string,
  days: number,
): RollingRatePoint[] {
  const n = normalizeCount(days);
  if (n === 0) return [];

  const byDate = indexByDate(entries);
  const series: RollingRatePoint[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const date = addDays(todayKey, -i);
    const entry = byDate.get(date);
    series.push({ date, rate: entry ? daySummary(entry).rate : 0 });
  }
  return series;
}

/**
 * 标签分布：`{ tag, total, done }`，按 `total` **降序**，`total` 相同则按 `tag` **升序**。
 *
 * 排序用普通的 `<` 字符串比较（码点序）而非 `localeCompare`——后者随运行环境的 ICU
 * 与 locale 变化，会让同一份数据在不同机器上排出不同顺序，构建结果就不稳定了。
 * 同一任务里重复出现的同名标签只算一次；没有标签的任务被忽略。
 */
export function tagStats(entries: DayEntry[]): TagStat[] {
  const byTag = new Map<string, TagStat>();
  for (const entry of entries) {
    for (const task of entry.tasks) {
      for (const tag of new Set(task.tags)) {
        const stat = byTag.get(tag) ?? { tag, total: 0, done: 0 };
        stat.total += 1;
        if (task.done) stat.done += 1;
        byTag.set(tag, stat);
      }
    }
  }

  return [...byTag.values()].sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    if (a.tag < b.tag) return -1;
    if (a.tag > b.tag) return 1;
    return 0;
  });
}
