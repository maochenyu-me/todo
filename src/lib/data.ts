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

/** 是文件则返回 true；不存在或没权限一律 false（不抛异常）。 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** 是目录则返回 true；不存在或没权限一律 false（不抛异常）。 */
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 读并校验单个文件；任何失败都收敛成错误消息，不抛异常。 */
function readEntryFile(path: string, dateKey: string): { entry: DayEntry } | { errors: string[] } {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { errors: [`读取失败：${e instanceof Error ? e.message : String(e)}`] };
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
    return 'entry' in result ? result.entry : null;
  }
  return null;
}

/**
 * 递归收集目录下所有 `YYYY-MM-DD.json`，填入 `dateKey → 绝对路径`。
 *
 * 先到先得（`if (into.has(dateKey)) continue`），因此扫描顺序即优先级。
 */
function collectDateFiles(dir: string, into: Map<string, string>): void {
  if (!isDir(dir)) return;
  let dirents: Dirent[];
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of dirents) {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      collectDateFiles(full, into);
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
 * 目录不存在视为"还没有数据"，返回空 `entries` 与空 `errors`
 * （首次部署、尚未创建目录时不该报错）。
 */
export function loadAllEntries(activeDir: string, archiveDir: string): LoadResult {
  const byDate = new Map<string, string>();
  collectDateFiles(activeDir, byDate);
  collectDateFiles(archiveDir, byDate);

  const entries: DayEntry[] = [];
  const errors: LoadError[] = [];
  for (const [dateKey, path] of byDate) {
    const result = readEntryFile(path, dateKey);
    if ('entry' in result) {
      entries.push(result.entry);
    } else {
      errors.push({ path, message: result.errors.join('；') });
    }
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { entries, errors };
}
