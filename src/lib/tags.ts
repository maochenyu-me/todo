/**
 * 标签聚合纯函数：`/tags/[tag]` 页面的数据来源。
 *
 * 铁律：
 * - 本文件不得 import `node:*`，也不得 import 任何框架——T15 的标签输入框也要复用它。
 * - 只读入参，不修改传入的 `DayEntry[]` / `Task[]`：构建期同一份数组被多个页面复用，
 *   就地 `sort()` 会让后面的页面拿到被改过的顺序。
 * - 排序用普通 `<` 字符串比较（码点序），**不用 `localeCompare`**——后者随运行环境的 ICU
 *   与 locale 变化，同一份数据在不同机器上会排出不同顺序，构建结果就不可复现了。
 */

import type { DayEntry, Task } from './types';
import { withBase } from './urls';

export type TagCount = { tag: string; count: number };

export type TagDay = { date: string; tasks: Task[] };

export type CollectTagOptions = { maxVisible: number; minCount: number };

/**
 * 与 `capTasks` 同一条口径：`maxVisible` 的唯一职责是「别把索引撑爆」，
 * 所以非正数、`NaN`、`Infinity` 一律视为「不截断」，而不是「全部藏起来」。
 */
function normalizeLimit(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n >= 1 ? n : null;
}

/**
 * 全站标签统计：`{ tag, count }[]`，按 `count` 降序、同 count 按 `tag` 升序，
 * 过滤掉 `count < minCount` 的标签，再截断到前 `maxVisible` 个。
 *
 * 几个刻意的决定：
 * - **同一条任务里重复写同一个标签只算一次**（`new Set(task.tags)`）：用户眼里那是
 *   一个标签，按「出现次数」计会让 `工作 工作 工作` 一条任务冲到榜首。
 * - **空白标签（`''`、`'   '`）直接忽略**：它会在站点上生成一个 `/tags/` 的空页，
 *   既能撞上其他路由，也没有任何意义。这里不做 trim 合并——标签的规范化是
 *   `validate.ts` 的 `normalizeTask` 的职责，本函数只负责「不把纯空白当成标签」。
 * - 截断发生在**过滤之后**：`minCount` 是质量问题，`maxVisible` 是排版上限，
 *   先按质量筛再取前 N 个，否则会把名额浪费在将被过滤掉的标签上。
 */
export function collectTags(entries: DayEntry[], opts: CollectTagOptions): TagCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const task of entry.tasks) {
      for (const tag of new Set(task.tags)) {
        if (tag.trim() === '') continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }

  const sorted = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .filter((item) => item.count >= opts.minCount)
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      if (a.tag < b.tag) return -1;
      if (a.tag > b.tag) return 1;
      return 0;
    });

  const limit = normalizeLimit(opts.maxVisible);
  return limit === null ? sorted : sorted.slice(0, limit);
}

/**
 * 某个标签下的全部历史任务，按**日期倒序**（最新的一天在最前），
 * 同一天内保持该日 `tasks` 的原有顺序。
 *
 * 只返回真的有该标签的日子——没有该标签的一天不会以一个空 `tasks` 的条目出现，
 * 页面就不必再判一次「这一天有没有可显示的任务」。
 */
export function entriesByTag(entries: DayEntry[], tag: string): TagDay[] {
  const days: TagDay[] = [];
  for (const entry of entries) {
    // `filter` 新建数组，入参的 `tasks` 不受影响。
    const tasks = entry.tasks.filter((task) => task.tags.includes(tag));
    if (tasks.length > 0) days.push({ date: entry.date, tasks });
  }
  days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return days;
}

/**
 * 标签页的站内路径，**已含 base 且已做百分号编码**。
 *
 * 为什么要编码后再交给 `withBase`：`withBase` 只负责加 base 前缀，不做百分号编码；
 * 而标签是中文、可能带空格或标点。不编码的话，`我的 计划` 里的空格会被浏览器当成
 * 边界处理，`a/b` 会凭空多出一层路径，`#号` 里的 `#` 会把后面整段变成 fragment。
 *
 * `encodeURIComponent` 同时把 `/` 编成 `%2F`，所以一个标签永远只占一层路径。
 * `getStaticPaths` 用 `params: { tag }`（**未编码**的原值）产出页面；Astro 会把
 * 原始标签编码进文件名，访问时再解码回原值——两条路径在这里对上，因此页面里的
 * 链接与构建出来的文件是同一串字节。`tags.test.ts` 与构建验证都钉住了这条往返。
 */
export function tagPath(tag: string, base?: string): string {
  const path = `/tags/${encodeURIComponent(tag)}`;
  return base === undefined ? withBase(path) : withBase(path, base);
}
