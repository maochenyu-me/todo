/**
 * 日期与时区纯逻辑。
 *
 * 铁律：**绝不从本地时区推导日期**。
 * - "今天/某时刻的日期" 一律走 `Intl.DateTimeFormat` + `timeZone` + `formatToParts`。
 * - 纯 `YYYY-MM-DD` 运算一律走 UTC 正午（`Date.UTC(y, m - 1, d, 12)`）或纯算术，
 *   不使用 `new Date(key)` 这类会落回本地时区的构造方式。
 *
 * 本文件无框架依赖、无 Node 内置模块依赖，前台、后台（浏览器）、脚本、单测均可使用。
 */

const MS_PER_DAY = 86_400_000;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 中文单字星期，索引按 0=周日 .. 6=周六。 */
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 该年该月（1-12）的天数。纯算术，不经过本地时区。 */
function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return DAYS_IN_MONTH[m - 1] ?? 0;
}

/** 由 UTC 毫秒时间戳取 `YYYY-MM-DD`（只用 `getUTC*`）。 */
function keyFromUtcMillis(ms: number): string {
  const d = new Date(ms);
  return `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 把日期 key 放到 UTC 正午，得到一个可用于纯天级运算的时间戳。 */
function utcNoonMillis(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d, 12);
}

/** 某时刻在指定时区的日期 key（`"YYYY-MM-DD"`）。 */
export function toDateKey(d: Date, timeZone: string): string {
  const parts = dateFormatter(timeZone).formatToParts(d);
  let year = '';
  let month = '';
  let day = '';
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
  }
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** 指定时区里的"今天"。`now` 可注入，便于测试。 */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return toDateKey(now, timeZone);
}

/** 拆分日期 key。调用方应先用 `isValidDateKey` 校验。 */
export function parseDateKey(dateKey: string): { y: number; m: number; d: number } {
  return {
    y: Number(dateKey.slice(0, 4)),
    m: Number(dateKey.slice(5, 7)),
    d: Number(dateKey.slice(8, 10)),
  };
}

/** 严格校验：必须零填充的 `YYYY-MM-DD`，且是真实存在的日历日期。 */
export function isValidDateKey(s: string): boolean {
  if (typeof s !== 'string' || !DATE_KEY_RE.test(s)) return false;
  const { y, m, d } = parseDateKey(s);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;
  return true;
}

/** 日期 key 加减天数（跨月/跨年/闰年正确）。 */
export function addDays(dateKey: string, delta: number): string {
  const { y, m, d } = parseDateKey(dateKey);
  return keyFromUtcMillis(utcNoonMillis(y, m, d) + delta * MS_PER_DAY);
}

/** 日期 key 加减月份，月末自动夹取（`2026-01-31` +1 月 → `2026-02-28`）。 */
export function addMonths(dateKey: string, delta: number): string {
  const { y, m, d } = parseDateKey(dateKey);
  const monthIndex = y * 12 + (m - 1) + delta;
  const targetY = Math.floor(monthIndex / 12);
  const targetM = monthIndex - targetY * 12 + 1;
  const targetD = Math.min(d, daysInMonth(targetY, targetM));
  return `${pad4(targetY)}-${pad2(targetM)}-${pad2(targetD)}`;
}

/** `"2026年10月28日 周三"` */
export function formatLong(dateKey: string): string {
  const { y, m, d } = parseDateKey(dateKey);
  return `${y}年${m}月${d}日 ${weekdayLabel(dateKey)}`;
}

/** `"10月28日 周三"` */
export function formatMedium(dateKey: string): string {
  const { m, d } = parseDateKey(dateKey);
  return `${m}月${d}日 ${weekdayLabel(dateKey)}`;
}

/** `"2026年10月"` */
export function formatYearMonth(dateKey: string): string {
  const { y, m } = parseDateKey(dateKey);
  return `${y}年${m}月`;
}

/** 该月全部日期 key，按自然顺序。 */
export function monthRange(dateKey: string): string[] {
  const { y, m } = parseDateKey(dateKey);
  const total = daysInMonth(y, m);
  const keys: string[] = [];
  for (let d = 1; d <= total; d += 1) {
    keys.push(`${pad4(y)}-${pad2(m)}-${pad2(d)}`);
  }
  return keys;
}

/** 星期几：0=周日 .. 6=周六。 */
export function weekdayOf(dateKey: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const { y, m, d } = parseDateKey(dateKey);
  const weekday = new Date(utcNoonMillis(y, m, d)).getUTCDay();
  return weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * 月历网格：恰好 42 个日期 key，覆盖 `dateKey` 所在月并补齐相邻月日期。
 * 首项星期几等于 `weekStartsOn`（0=周日，1=周一）。
 */
export function startOfWeekGrid(dateKey: string, weekStartsOn: 0 | 1): string[] {
  const { y, m } = parseDateKey(dateKey);
  const firstOfMonth = `${pad4(y)}-${pad2(m)}-01`;
  const offset = (weekdayOf(firstOfMonth) - weekStartsOn + 7) % 7;
  const gridStart = addDays(firstOfMonth, -offset);
  const grid: string[] = [];
  for (let i = 0; i < 42; i += 1) {
    grid.push(addDays(gridStart, i));
  }
  return grid;
}

/**
 * 两个日期之间**完整月数**（floor，朝向 `toKey` 取整）。
 * `('2026-04-28','2026-10-28') === 6`；`('2026-04-29','2026-10-28') === 5`。
 */
export function monthsBetween(fromKey: string, toKey: string): number {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  let months = (to.y - from.y) * 12 + (to.m - from.m);
  if (months > 0 && to.d < from.d) months -= 1;
  else if (months < 0 && to.d > from.d) months += 1;
  return months;
}

function weekdayLabel(dateKey: string): string {
  return `周${WEEKDAY_CN[weekdayOf(dateKey)]}`;
}
