/**
 * 发布载荷的**纯计算**：把「哪几天改了」折算成「写哪些文件、删哪些文件」。
 *
 * 铁律：本文件不得 import `node:*`，也不得 import `data.ts`（那会把 `node:fs`
 * 打进浏览器包——`publish.test.ts` 里有守卫测试）。序列化与路径计算只走
 * `entry-codec.ts` 的纯函数，归档决策只走 `archive.ts`；动手提交是 `github.ts`
 * 的 `commitChanges`，本文件连 fetch 都不碰。
 *
 * ## 两道拒绝写入的闸
 *
 * 1. **loadWarnings 的日期**：仓库里存在、但这次没能载入的天，它的现有内容
 *    没被读出来——用一个内存里的空条目或旧条目覆盖它就是静默丢数据。
 *    `unavailableDates` 是**必填**参数：调用方想不发这道闸连编译都过不了。
 * 2. **dirty 指向不存在的条目**：`PATCH_DAY` 的不变量保证 dirty ⊆ days，
 *    但发布是最后一道关，缺内容的提交没法序列化，宁可拒绝也不猜。
 *
 * 两道闸都抛 `PublishBlockedError`：调用方（AdminApp）接住后转成
 * `PUBLISH_FAIL` 的中文提示，改动原样留在编辑器里。
 *
 * ## 归档搬迁为什么是 writes + deletes 成对出现
 *
 * 超出 `afterMonths` 的日期不再写回活跃区，而是写进归档区并把活跃区那份删掉，
 * **在同一次 commit 内完成**——分两次提交会让公开页面在中间那段时间既看到旧文件
 * 又看到新文件（或都看不到）。边界语义沿袭 `shouldArchive`：恰好满 N 个月当天
 * 仍算活跃。
 */

import { shouldArchive } from '../lib/archive';
import { entryPath, serializeEntry, type DataDirs } from '../lib/entry-codec';
import type { DayEntry } from '../lib/types';

/** 发布被本地闸门挡下（不是 GitHub 的错）：`.dates` 点名被挡的日期。 */
export class PublishBlockedError extends Error {
  /** 被挡下的日期 key，已排序。 */
  readonly dates: string[];

  constructor(message: string, dates: string[]) {
    super(message);
    this.name = 'PublishBlockedError';
    this.dates = dates;
  }
}

export type PublishPayloadInput = {
  /** 编辑器里当前的全部天数（`dirty` 的每一项都必须在这里）。 */
  days: Record<string, DayEntry>;
  /** 被改过、待发布的天。只有这些日期会出现在 writes / deletes 里。 */
  dirty: ReadonlySet<string>;
  /** 发布时刻的"今天"（时区归一后的 date key），归档边界用它算。 */
  todayKey: string;
  /** 活跃区 / 归档区目录，唯一真相是 `site.config.ts`。 */
  dataCfg: DataDirs;
  /** 超过多少个月搬进归档区。 */
  afterMonths: number;
  /**
   * 存在于仓库、但这次**没能载入**的日期（`loadWarnings` 的日期集合）。
   * dirty 与它的交集非空就整批拒绝——覆盖读不出来的文件就是丢数据。
   */
  unavailableDates: ReadonlySet<string>;
};

export type PublishPayload = {
  writes: { path: string; content: string }[];
  deletes: string[];
  /** `N 天 / M 项改动`：N 是天数，M 是这些天里的任务总数。 */
  summary: string;
};

/**
 * 把 dirty 折算成提交载荷。**只写 dirty 的日期**，一天都不多碰。
 *
 * 日期按升序处理：路径是零填充的 date key，字典序即时间序，
 * 升序让 tree 条目与 git diff 稳定可读。
 */
export function buildPublishPayload(input: PublishPayloadInput): PublishPayload {
  const dates = [...input.dirty].sort();

  const blocked = dates.filter((date) => input.unavailableDates.has(date));
  if (blocked.length > 0) {
    throw new PublishBlockedError(
      `${blocked.length} 天没能从仓库载入（${blocked.join('、')}），它们在仓库里的现有内容读不出来；` +
        '为避免覆盖丢数据，本次发布已被拒绝。请重新连接仓库补齐数据后再试',
      blocked,
    );
  }

  const missing = dates.filter((date) => input.days[date] === undefined);
  if (missing.length > 0) {
    throw new PublishBlockedError(
      `${missing.length} 天标了改动却没有内容（${missing.join('、')}），无法发布；` +
        '请重新连接仓库后再试',
      missing,
    );
  }

  const writes: { path: string; content: string }[] = [];
  const deletes: string[] = [];
  let taskCount = 0;

  for (const date of dates) {
    const entry = input.days[date]!;
    taskCount += entry.tasks.length;
    const archive = shouldArchive(date, input.todayKey, input.afterMonths);
    if (archive) {
      writes.push({ path: entryPath('archive', date, input.dataCfg), content: serializeEntry(entry) });
      deletes.push(entryPath('active', date, input.dataCfg));
    } else {
      writes.push({ path: entryPath('active', date, input.dataCfg), content: serializeEntry(entry) });
    }
  }

  return { writes, deletes, summary: `${dates.length} 天 / ${taskCount} 项改动` };
}

/** 把 `commitMessage` 模板里的 `{date}` / `{summary}` 换成实际值（占位符可出现多次）。 */
export function buildCommitMessage(template: string, dateKey: string, summary: string): string {
  return template.split('{date}').join(dateKey).split('{summary}').join(summary);
}
