/**
 * 条目编解码**纯逻辑**。
 *
 * 铁律：本文件**不得 import 任何 `node:*` 模块，也不得 import 任何框架**。
 * 后台（浏览器）里的发布代码要序列化条目、算仓库路径，只能走这里。
 * 触碰文件系统的事情一律留给 `data.ts`（它是唯一允许 import `node:fs` 的模块）。
 *
 * 校验原则：**越界值一律收集为错误，绝不静默修正**（不做裁剪、不做类型转换、不做默认值猜测）。
 */

import { isValidDateKey } from './date';
import type { DayEntry, Priority, Task, TimeBlock } from './types';

export type EntryResult = { ok: true; entry: DayEntry } | { ok: false; errors: string[] };

/** `entryPath` 只需要这两个目录，不引入整个配置对象。 */
export type DataDirs = { activeDir: string; archiveDir: string };

const HHMM_RE = /^(\d{2}):(\d{2})$/;

const PRIORITIES: readonly unknown[] = [0, 1, 2];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `"HH:MM"` → 当天分钟数；格式不合法返回 `null`。 */
function minutesOfDay(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = HHMM_RE.exec(v);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function requireString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/**
 * 校验必填的时间戳字段（`createdAt`/`updatedAt`）。
 *
 * 这两个字段属于固定 schema，**缺失即错误**，绝不补空串：写盘时补 `""` 会得到一个
 * 永久性的非 ISO 值，污染已提交的数据文件。缺失与空串分别给出不同文案，
 * 但同一次校验里最多只报一条。
 */
function requireTimestamp(
  raw: Record<string, unknown>,
  key: 'createdAt' | 'updatedAt',
  at: string,
  errors: string[],
): string | null {
  const value = raw[key];
  if (value === undefined || value === null) {
    errors.push(`${at}.${key} 缺失`);
    return null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${at}.${key} 不能为空`);
    return null;
  }
  return value;
}

/**
 * 校验单个 task，把错误写进 `errors`（前缀带 1 起始的序号）。
 *
 * 必须字段：`id` 非空、`title` 去空白后非空、`done` 布尔、`priority` ∈ {0,1,2}、
 * `tags` 为字符串数组、`timeBlock` 为 `null` 或 `end > start`、
 * `createdAt`/`updatedAt` 为非空字符串。
 * 只有下列字段可以省略并给出中性默认值：`completedAt`（→ null）、`note`（→ ''）、
 * `order`（→ 数组下标）、`timeBlock`（`undefined` 视同 `null`）。
 * 未知字段被丢弃（输出始终是定形的 `Task`）。
 * 注意"缺失"与"越界"不同：缺失只对上面列出的可省字段成立，越界
 * （`priority: 5`、`done: "true"`……）一律报错，绝不改正。
 */
function validateTask(raw: unknown, index: number, errors: string[]): Task | null {
  const at = `tasks[${index + 1}]`;
  if (!isRecord(raw)) {
    errors.push(`${at} 不是对象`);
    return null;
  }

  const before = errors.length;

  const id = raw.id;
  if (typeof id !== 'string' || id.trim() === '') errors.push(`${at}.id 不能为空`);

  const title = raw.title;
  if (typeof title !== 'string' || title.trim() === '') errors.push(`${at}.title 不能为空`);

  const done = raw.done;
  if (typeof done !== 'boolean') errors.push(`${at}.done 必须是布尔值`);

  const priority = raw.priority;
  if (typeof priority !== 'number' || !PRIORITIES.includes(priority)) {
    errors.push(`${at}.priority 必须是 0、1、2`);
  }

  const tags = raw.tags;
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
    errors.push(`${at}.tags 必须是字符串数组`);
  }

  const timeBlockRaw = raw.timeBlock;
  let timeBlock: TimeBlock | null = null;
  if (timeBlockRaw !== null && timeBlockRaw !== undefined) {
    if (!isRecord(timeBlockRaw)) {
      errors.push(`${at}.timeBlock 必须是 null 或含 start/end 的对象`);
    } else {
      const start = minutesOfDay(timeBlockRaw.start);
      const end = minutesOfDay(timeBlockRaw.end);
      if (start === null || end === null) {
        errors.push(`${at}.timeBlock 时间格式必须是 HH:MM`);
      } else if (end <= start) {
        errors.push(`${at}.timeBlock 的 end 必须晚于 start`);
      } else {
        timeBlock = { start: timeBlockRaw.start as string, end: timeBlockRaw.end as string };
      }
    }
  }

  if (raw.completedAt !== undefined && raw.completedAt !== null && typeof raw.completedAt !== 'string') {
    errors.push(`${at}.completedAt 必须是字符串或 null`);
  }
  if (raw.note !== undefined && typeof raw.note !== 'string') errors.push(`${at}.note 必须是字符串`);
  // `order` 缺失时回落到数组下标：这是**合法归一化**，缺的只是这一份文件的排序提示，
  // 不会写坏时间戳那样的真实数据。注意 `validate.ts` 的 `normalizeTask` **不重排 `order`**
  // （它只拿到单个 task），整天 `order` 的重排由编辑器/发布流程在调用方完成。
  // 与 `createdAt`/`updatedAt` 不同——时间戳缺失会写坏数据，所以那两个必须报错。
  if (raw.order !== undefined && (typeof raw.order !== 'number' || !Number.isFinite(raw.order))) {
    errors.push(`${at}.order 必须是数字`);
  }
  const createdAt = requireTimestamp(raw, 'createdAt', at, errors);
  const updatedAt = requireTimestamp(raw, 'updatedAt', at, errors);

  if (errors.length > before) return null;

  return {
    id: id as string,
    title: title as string,
    done: done as boolean,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    order: typeof raw.order === 'number' ? raw.order : index,
    priority: priority as Priority,
    tags: [...(tags as string[])],
    note: requireString(raw.note, ''),
    timeBlock,
    createdAt: createdAt as string,
    updatedAt: updatedAt as string,
  };
}

/**
 * 校验一份“原始数据”（来自 `JSON.parse` 或表单）是否是某日期的合法 `DayEntry`。
 *
 * `dateKey` 是**文件名**推出来的日期，必须与内容里的 `date` 一致。
 * 失败时返回扁平的中文错误列表；多个任务的错误一次性全部收集。
 */
export function validateEntry(raw: unknown, dateKey: string): EntryResult {
  const errors: string[] = [];

  const fileNameKeyOk = isValidDateKey(dateKey);

  if (!isRecord(raw)) {
    if (!fileNameKeyOk) errors.push(`文件名日期 ${dateKey} 不是合法的 YYYY-MM-DD`);
    errors.push('内容不是 JSON 对象');
    return { ok: false, errors };
  }

  // 文件名日期不合法时只报一条：同一个问题（`dateKey` 本身有错）不再被 `date` 分支重复报一遍。
  const date = raw.date;
  if (!fileNameKeyOk) {
    errors.push(`文件名日期 ${dateKey} 不是合法的 YYYY-MM-DD`);
  } else if (typeof date !== 'string' || !isValidDateKey(date)) {
    errors.push(`date 不是合法的 YYYY-MM-DD：${String(date)}`);
  } else if (date !== dateKey) {
    errors.push(`date 应为文件名日期 ${dateKey}，实际为 ${date}`);
  }

  const tasksRaw = raw.tasks;
  const tasks: Task[] = [];
  if (!Array.isArray(tasksRaw)) {
    errors.push('tasks 必须是数组');
  } else {
    tasksRaw.forEach((t, i) => {
      const task = validateTask(t, i, errors);
      if (task) tasks.push(task);
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, entry: { date: dateKey, tasks } };
}

/** 定形的 task（字段顺序固定，未知字段丢弃），保证写盘后的 git diff 稳定。 */
function canonicalTask(t: Task): Task {
  return {
    id: t.id,
    title: t.title,
    done: t.done,
    completedAt: t.completedAt,
    order: t.order,
    priority: t.priority,
    tags: [...t.tags],
    note: t.note,
    timeBlock: t.timeBlock ? { start: t.timeBlock.start, end: t.timeBlock.end } : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/**
 * 序列化为落盘文本：2 空格缩进 + 结尾换行。
 *
 * 结尾换行是刻意的：既能保证 `parseEntry(serializeEntry(e))` 与原值等价，
 * 也让每次 git diff 不会出现 "\ No newline at end of file" 噪声。
 */
export function serializeEntry(entry: DayEntry): string {
  const canonical: DayEntry = {
    date: entry.date,
    tasks: entry.tasks.map(canonicalTask),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/** 解析 + 校验。坏 JSON 与坏结构都返回错误，不抛异常。 */
export function parseEntry(text: string, dateKey: string): EntryResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [`JSON 解析失败：${message}`] };
  }
  return validateEntry(data, dateKey);
}

/** 目录拼接：始终用正斜杠（仓库路径与 URL 一致），并去掉目录末尾多余斜杠。 */
function joinPath(dir: string, ...segments: string[]): string {
  const head = dir.replace(/\/+$/, '');
  const parts = head === '' ? segments : [head, ...segments];
  return parts.join('/');
}

/**
 * 条目在仓库里的相对路径。
 *
 * - `active` → `<activeDir>/<dateKey>.json`
 * - `archive` → `<archiveDir>/<YYYY>/<dateKey>.json`（年份取自 `dateKey`）
 */
export function entryPath(kind: 'active' | 'archive', dateKey: string, dataCfg: DataDirs): string {
  const fileName = `${dateKey}.json`;
  if (kind === 'archive') return joinPath(dataCfg.archiveDir, dateKey.slice(0, 4), fileName);
  return joinPath(dataCfg.activeDir, fileName);
}
