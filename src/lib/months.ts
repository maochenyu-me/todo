/**
 * 月份键（`YYYY-MM`）的纯算术，以及「哪些月份该有页面」「归档表怎么分组」的判定。
 *
 * 为什么单独一层：`/calendar` 与 `/calendar/[month]` 必须对「上个月／下个月」给出
 * **逐字节一致**的答案，否则从 `/calendar` 点进某个月，再想点回去会落到置灰的 `null`。
 * `/archive` 又要按同样的年月口径分组。把这些决定放进纯函数里，由页面共用，
 * 是最省心的保证方式——页面只剩「把算好的形状画出来」。
 *
 * 铁律：
 * - 本文件不得 import `node:*`，也不得 import 任何框架。
 * - 月份键是零填充的 `YYYY-MM`，字典序即时间序，故大小比较直接用字符串比较。
 * - 只读入参，不修改传入的 `DayEntry[]`。
 */

import { daySummary } from './stats';
import type { DayEntry } from './types';

/** 月历格子与归档表里的一天：只有展示所需的三个数，**不含任何任务标题**。 */
export type MonthDay = { date: string; total: number; done: number };

/**
 * 月历格子里的一天：`MonthDay` 再加上**格子内能露出的任务标题**。
 *
 * 归档页的性能护栏（产物 HTML 不许出现任务标题）只落在 `groupByYearMonth` /
 * `daysInMonth` 的返回类型上——那两个函数的结构里根本没有 `previews` 字段，
 * 标题进不了归档表。月历页没有这条护栏（格子本来就是「这一天写了什么」的入口），
 * 所以预览单独放在这个类型里，两个口径互不污染。
 */
export type CalendarDay = MonthDay & { previews: string[] };

/** 月历格子里一天最多露出的任务标题条数。超出部分由格子里的「还有 N 条」承接。 */
export const CALENDAR_PREVIEWS = 2;

/** 归档表的一组：某月以及该月有记录的那些天。 */
export type MonthGroup = { monthKey: string; days: MonthDay[] };

/** 归档表的一组：某年以及该年的各月。 */
export type YearGroup = { year: string; months: MonthGroup[] };

/** 某天（`YYYY-MM-DD`）所属的月份键。 */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** 月份键 → 该月第一天的日期 key（`date.ts` 与 `formatYearMonth` 吃的是日期 key）。 */
export function monthStart(monthKey: string): string {
  return `${monthKey}-01`;
}

/** 升序去重。`YYYY-MM` 字典序即时间序。 */
function sortedUnique(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort();
}

/** 有记录的月份，升序。空数据返回 `[]`。 */
export function monthsWithData(entries: DayEntry[]): string[] {
  return sortedUnique(entries.map((entry) => monthKeyOf(entry.date)));
}

/**
 * **该生成页面的**月份集合：有记录的每一个月 ∪「今天」所在的月（即使它没有任何记录）。
 *
 * 当前月总要有页面——否则读者在最常用的那个入口（日历导航）上只能看到一个死链或 404。
 * 「这个月还没写」应该是页面里的一句空状态，而不是一个不存在的地址。
 */
export function monthsWithPages(entries: DayEntry[], todayKey: string): string[] {
  return sortedUnique([...monthsWithData(entries), monthKeyOf(todayKey)]);
}

/**
 * `/calendar` 默认渲染的那一个月：**有数据的最新月份**，一条数据都没有时回落到当前月。
 *
 * 抽出来是为了让 `calendar/index.astro` 与 `calendar/[month].astro` 用同一个答案：
 * 前者用它决定渲染哪个月，后者用它决定哪个月份把 canonical 指回 `/calendar`。
 * 两处各算一遍一旦分叉，就会出现「`/calendar` 显示 10 月，而 1 月那份把 canonical
 * 指向 `/calendar`」这种错——页面照样构建成功，是最难被发现的错法。
 */
export function latestDataMonth(entries: DayEntry[], todayKey: string): string {
  // `monthsWithData` 已升序，末项即最新。
  return monthsWithData(entries).at(-1) ?? monthKeyOf(todayKey);
}

/**
 * 翻月目标：在**已经存在的页面**里找最近的一个月（`null` 表示这个方向到头了）。
 *
 * 不返回「当前月 ±1 个月」：两个月之间可能隔着大段没有记录的日子（例如从 2026-10
 * 直接跳回 2026-01），那样「上个月」会指向一个根本不存在的页面，读者点过去就是 404。
 */
export function monthNeighbors(
  months: string[],
  monthKey: string,
): { prev: string | null; next: string | null } {
  let prev: string | null = null;
  let next: string | null = null;
  for (const key of months) {
    if (key < monthKey && (prev === null || key > prev)) prev = key;
    if (key > monthKey && (next === null || key < next)) next = key;
  }
  return { prev, next };
}

/**
 * 该月里有记录的每一天，升序。
 *
 * 「有记录」的口径是**磁盘上有这一天**（含 `tasks: []` 的空日），所以遍历
 * `loadAllEntries` 的条目而不是自己造 1..31——没有文件的日子不画轨道、也不发链接。
 */
export function daysInMonth(entries: DayEntry[], monthKey: string): MonthDay[] {
  const days: MonthDay[] = [];
  for (const entry of entries) {
    if (monthKeyOf(entry.date) !== monthKey) continue;
    const summary = daySummary(entry);
    days.push({ date: entry.date, total: summary.total, done: summary.done });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return days;
}

/**
 * 月历页用的格子数据：`daysInMonth` 再加上每天**前几条任务标题**（`CALENDAR_PREVIEWS` 条）。
 *
 * 标题取数据文件里的原始顺序，不重排：格子是入口不是清单，读者要的是「这天大概写了什么」，
 * 完整的一天点进去看。预览条数是版面决定（格子只有几十像素高），不是数据截断——
 * 精确的 `done / total` 照常在格子里，多写的天数不会丢。
 */
export function calendarDays(
  entries: DayEntry[],
  monthKey: string,
  previewCount: number = CALENDAR_PREVIEWS,
): CalendarDay[] {
  const take = Number.isFinite(previewCount) ? Math.max(0, Math.floor(previewCount)) : 0;
  const days: CalendarDay[] = [];
  for (const entry of entries) {
    if (monthKeyOf(entry.date) !== monthKey) continue;
    const summary = daySummary(entry);
    days.push({
      date: entry.date,
      total: summary.total,
      done: summary.done,
      previews: entry.tasks.slice(0, take).map((task) => task.title),
    });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return days;
}

/**
 * 归档表的形状：年 → 月 → 天，**最新的在最上面**。
 *
 * 倒序是刻意的：归档页是「回看」入口，最近写下的那几天才是读者最想找的；
 * 与 `/tags/[tag]` 的「按日倒序」也是同一套语汇。年份锚点因此从上往下递减。
 *
 * **每天只带 `{ date, total, done }`，不带任何任务标题**——这不是顺手省字段，
 * 而是归档页性能护栏在数据结构上的落点：T18 的构建测试会 grep 产物 HTML 断言
 * 标题字符串不存在。标题根本进不来，那条断言才不可能被一次「顺手加个字段」打破。
 */
export function groupByYearMonth(entries: DayEntry[]): YearGroup[] {
  const years = new Map<string, Map<string, MonthDay[]>>();

  for (const entry of entries) {
    const monthKey = monthKeyOf(entry.date);
    const year = monthKey.slice(0, 4);
    const summary = daySummary(entry);

    let months = years.get(year);
    if (!months) {
      months = new Map<string, MonthDay[]>();
      years.set(year, months);
    }
    let days = months.get(monthKey);
    if (!days) {
      days = [];
      months.set(monthKey, days);
    }
    days.push({ date: entry.date, total: summary.total, done: summary.done });
  }

  const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

  return [...years.entries()]
    .sort((a, b) => desc(a[0], b[0]))
    .map(([year, months]) => ({
      year,
      months: [...months.entries()]
        .sort((a, b) => desc(a[0], b[0]))
        .map(([monthKey, days]) => ({
          monthKey,
          days: [...days].sort((a, b) => desc(a.date, b.date)),
        })),
    }));
}
