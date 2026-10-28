/**
 * 文件读取层：**唯一允许 import `node:fs` 的库模块**。
 *
 * 浏览器端代码（后台发布逻辑等）绝不能 import 本文件——要序列化或算路径请用
 * `entry-codec.ts`。本文件只做"把磁盘上的 JSON 读成 `DayEntry`"这一件事，
 * 校验全部委托给 `parseEntry`，路径规则全部委托给 `entryPath`，不重复实现。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

import { parseEntry, entryPath } from './entry-codec';
import type { DayEntry } from './types';

export type LoadError = { path: string; message: string };

export type LoadResult = { entries: DayEntry[]; errors: LoadError[] };

const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

/** 只有 `ENOENT`（不存在）才算"没有数据"；`EACCES`/`EMFILE`/`ENOTDIR` 等都是真故障。 */
function isMissingError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ENOENT';
}

/** 把任意抛出物收敛成可读的 `错误码 消息` 文本。 */
function describeError(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const code = (e as { code?: unknown }).code;
    const message = (e as { message?: unknown }).message;
    if (typeof code === 'string' && typeof message === 'string') return `${code}: ${message}`;
    if (typeof message === 'string') return message;
  }
  return String(e);
}

/**
 * `stat` 的**五态**结果。关键点：只有 `ENOENT` 落到 `missing`；
 * `EACCES`、`EMFILE`、`ENOTDIR` 之类落到 `error`，必须能被上层报出来，
 * 否则一个读不了的目录看起来跟"还没有数据"一模一样。
 */
type PathKind =
  | { status: 'file' | 'dir' | 'other' | 'missing' }
  | { status: 'error'; message: string };

function kindOf(path: string): PathKind {
  try {
    const stats = statSync(path);
    if (stats.isFile()) return { status: 'file' };
    if (stats.isDirectory()) return { status: 'dir' };
    return { status: 'other' };
  } catch (e) {
    if (isMissingError(e)) return { status: 'missing' };
    return { status: 'error', message: describeError(e) };
  }
}

/**
 * 是文件则返回 true。
 *
 * 供 `readDayFromDisk` 用——它的签名（plan 规定）没有 `errors` 通道，所以不存在的路径
 * 与非 `ENOENT` 故障都只能收敛成"跳过"。需要错误明细的调用方请走 `loadAllEntries`。
 */
function isFile(path: string): boolean {
  const kind = kindOf(path);
  return kind.status === 'file';
}

/**
 * 读并校验单个文件；任何失败都收敛成错误消息，不抛异常。
 *
 * `ENOENT` 表示文件在"扫描"与"读取"之间消失了——按"不存在"处理，静默跳过；
 * 其它读取故障（`EACCES`、`EISDIR`……）一律报出来。
 */
function readEntryFile(path: string, dateKey: string): { entry: DayEntry } | { errors: string[] } | 'missing' {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if (isMissingError(e)) return 'missing';
    return { errors: [`读取失败：${describeError(e)}`] };
  }
  const parsed = parseEntry(text, dateKey);
  if (!parsed.ok) return { errors: parsed.errors };
  return { entry: parsed.entry };
}

/**
 * 读某一天的条目：先找活跃区，再回落到归档区。
 *
 * 落点判定与 `loadAllEntries` 的去重口径一致：**第一个存在的文件说了算**。
 * 若活跃区那份存在但内容不合法，本函数返回 `null`，不会静默拿归档区的旧快照顶替
 * （要拿到错误明细请走 `loadAllEntries`）。找不到、目录缺失同样返回 `null`。
 */
export function readDayFromDisk(activeDir: string, archiveDir: string, dateKey: string): DayEntry | null {
  const dirs = { activeDir, archiveDir };
  const candidates = [
    entryPath('active', dateKey, dirs),
    entryPath('archive', dateKey, dirs),
  ];
  for (const path of candidates) {
    if (!isFile(path)) continue;
    const result = readEntryFile(path, dateKey);
    if (result === 'missing') continue;
    return 'entry' in result ? result.entry : null;
  }
  return null;
}

/** 某一天在磁盘上的三种状态：没有文件 / 有文件且可读 / 有文件但读不出来。 */
export type DayFileState = 'absent' | 'ok' | 'corrupt';

/**
 * 判定某一天的文件状态，**只读，不写**。
 *
 * 存在的理由：`readDayFromDisk` 把「压根没有这一天」与「有文件但解析失败」都收敛成 `null`
 * ——它的签名没有错误通道，这是既定契约。但页面必须把这两种情况显示成不同的话：
 * 「今天还没有写下任何事」和「今天有记录但读不出来」是完全不同的两件事，
 * 对着一个坏文件说前一句就是**撒谎**。本函数补上这个区分。
 *
 * 为什么不用「扫一遍 `loadAllEntries` 再按路径里有没有日期串去匹配」：那需要 O(全站文件)
 * 的扫描，且目录级故障（`EACCES` 整个目录）的 `path` 里没有日期，匹配不上就会退化成
 * 「没有这一天」。这里只探两个候选路径，结论精确、代价恒定。
 *
 * ## 不变量（无条件成立）
 *
 * 两个函数**遍历同一组候选路径、同一顺序、同一回落规则**，因此：
 *
 * - `dayFileState(...) === 'ok'` ⇔ `readDayFromDisk(...) !== null`
 * - `dayFileState(...) === 'corrupt'` ⇔ 某个候选**确实存在为文件、但内容解析失败**
 * - `dayFileState(...) === 'absent'` ⇔ `readDayFromDisk(...) === null` 且没有任何候选被成功读到
 *
 * 页面是把两条通道拼起来用的（`entry = readDayFromDisk(...)` 与
 * `corrupt = dayFileState(...) === 'corrupt'`）。两者只要在任何一个场景上分叉，
 * 页面就会自相矛盾：一边说「记录读不出来」，一边把记录列出来。所以这条不变量是硬约束，
 * 不是文档修辞；`data.fs-error.test.ts` 里直接断言两条通道的结论一致。
 *
 * ## 回落规则：为什么 `stat` 失败要「继续看下一个候选」
 *
 * 候选路径可能以三种方式「不算这一天」：不存在（`missing`）、是目录（`dir`）、
 * `stat` 本身失败（`error`，如 `EACCES`）。三者在这里**一律 `continue`**，
 * 这正是 `readDayFromDisk` 的 `if (!isFile(path)) continue` 所做的事——`isFile` 对
 * 前两种和 `stat` 失败都返回 `false`。
 *
 * 代价是必须接受一个不太直观的结论：**一个 `stat` 不了的活跃区文件并不会被判成
 * `corrupt`，而是让位给归档区**（归档区也可读就成了 `ok`，归档区也没有就成了 `absent`）。
 * 这与 `readDayFromDisk` 的实际读取行为完全一致——它本来就跳过这个候选去读归档区了，
 * 页面显示的也是归档区那份。若在这里硬报 `corrupt`，页面就会一边喊「读不出来」
 * 一边把归档区的记录列出来，那才是真正的自相矛盾。
 *
 * 语义上也能自圆其说：`corrupt` 的含义是「**找到了**文件但读不出来」，而 `stat` 失败
 * 连「有没有这个文件」都还没确定，没有资格做这个断言。目录级故障不会被吞掉——
 * `loadAllEntries` 的 `errors` 通道照常汇报，`[date].astro` 会为它打一条构建期警告。
 *
 * **注意**：活跃区「能 `stat` 但解析失败」仍然**阻止**回落到归档区（返回 `corrupt`），
 * 这是 `readDayFromDisk` 的既定行为，必须保持——用户刚保存的内容被旧快照盖掉，
 * 比构建失败更糟。两种情形的差别不是随意的：能读到字节却没解析成功，是「这份数据坏了」；
 * 读不到字节，是「这一份看不了，看下一份」。
 */
export function dayFileState(
  activeDir: string,
  archiveDir: string,
  dateKey: string,
): DayFileState {
  const dirs = { activeDir, archiveDir };
  const candidates = [
    entryPath('active', dateKey, dirs),
    entryPath('archive', dateKey, dirs),
  ];
  for (const path of candidates) {
    const kind = kindOf(path);
    // 不存在 / 是目录 / stat 失败：都不算「这一份可读」，看下一个候选。
    // `dir` 与 `other` 也在这里跳过，与 `loadAllEntries` 的口径一致（同名文件才算数据）。
    if (kind.status !== 'file') continue;
    const result = readEntryFile(path, dateKey);
    // 扫描之后文件消失了：与「不存在」同等对待，继续看下一个候选（`readDayFromDisk` 亦然）。
    if (result === 'missing') continue;
    return 'entry' in result ? 'ok' : 'corrupt';
  }
  return 'absent';
}

/**
 * 递归收集目录下所有 `YYYY-MM-DD.json`，填入 `dateKey → 绝对路径`。
 *
 * 先到先得（`if (into.has(dateKey)) continue`），因此扫描顺序即优先级。
 * 目录不存在是合法的（首次部署）；其它任何文件系统错误都写进 `errors` 继续走。
 */
function collectDateFiles(dir: string, into: Map<string, string>, errors: LoadError[]): void {
  const kind = kindOf(dir);
  if (kind.status === 'missing') return;
  if (kind.status === 'error') {
    errors.push({ path: dir, message: kind.message });
    return;
  }
  if (kind.status !== 'dir') return;

  let dirents: Dirent[];
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (!isMissingError(e)) errors.push({ path: dir, message: describeError(e) });
    return;
  }
  for (const dirent of dirents) {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      collectDateFiles(full, into, errors);
      continue;
    }
    const matched = DATE_FILE_RE.exec(dirent.name);
    if (!matched) continue;
    const dateKey = matched[1] as string;
    if (!into.has(dateKey)) into.set(dateKey, full);
  }
}

/**
 * 读出全部条目，`date` 升序且按日期去重；坏文件跳过并汇总到 `errors`，**不中断**。
 *
 * **去重优先级：活跃区优先。** 同一日期同时出现在活跃区与归档区时
 * （例如归档后又被后台还原编辑），保留 `activeDir` 的副本、丢弃 `archiveDir` 的副本。
 * 理由：活跃区是当前可编辑的真相来源，归档区只是历史快照；反过来取归档会让
 * 用户刚保存的内容被旧快照盖掉。
 *
 * 注意：去重发生在解析**之前**，所以若活跃区副本损坏，不会回落到归档区的旧副本，
 * 而是产生一条 `errors` —— 宁可报出坏文件，也不要静默用旧数据顶替。
 *
 * 目录不存在是**唯一**被当作"还没有数据"的情况（首次部署、尚未创建目录时不该报错），
 * 返回空 `entries` 与空 `errors`。其余文件系统错误（`EACCES`、`EMFILE`、`ENOTDIR`……）
 * 一律进 `errors`：否则读不了的目录会与"没数据"无法区分，站点会静默构建出残缺内容。
 */
export function loadAllEntries(activeDir: string, archiveDir: string): LoadResult {
  const byDate = new Map<string, string>();
  const errors: LoadError[] = [];
  collectDateFiles(activeDir, byDate, errors);
  collectDateFiles(archiveDir, byDate, errors);

  const entries: DayEntry[] = [];
  for (const [dateKey, path] of byDate) {
    const result = readEntryFile(path, dateKey);
    if (result === 'missing') continue;
    if ('entry' in result) {
      entries.push(result.entry);
    } else {
      errors.push({ path, message: result.errors.join('；') });
    }
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { entries, errors };
}
