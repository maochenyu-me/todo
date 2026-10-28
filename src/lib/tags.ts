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
 * 该标签能否安全地拥有一个 `tags/<tag>` 页面。
 *
 * 目前唯一被排除的是**含 `%`** 的标签。这不是保守，是实测结论：裸 `%` 会让 Astro 的
 * `validateAndDecodePathname()` 在「反复解码直到稳定」时对不合格的转义序列抛错。
 * 实测（astro@7.4.2，`pct % sign` 与 `100%` 两个标签）：
 *
 * - `pct % sign` → 构建**硬失败**：`NoMatchingStaticPathFound: requested path
 *   /tags/pct%20%%20sign/`，`dist/` 不产出，整站发布不了；
 * - `100%` → 页面能产出，但构建日志里打 `Error: Invalid URL encoding`。
 *
 * 换句话说 `%` 不是「编码方式选错了」，而是 Astro 的路由层根本不接受这种路径段——
 * 换任何编码方案都绕不过去（预转义成 `%25` 同样失败）。既然改不了框架，
 * 就只能让这类标签**不建页**：宁可它没有自己的页面，也不能让一次正常的构建变成红灯。
 *
 * 注意这里**不做静默丢弃**：`collectTags` 仍然统计它（它在标签页的索引里、计数照常），
 * 只是 `getStaticPaths` 不为它生成路由。代价是索引里可能出现一个指向 404 的链接——
 * 所以 `TagIndex` 对这类标签渲染成**不可点的纯文本**，见 `hasTagPage` 的另一个调用点。
 */
export function hasTagPage(tag: string): boolean {
  return !tag.includes('%');
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
 * - **含 `%` 的标签仍然统计**（理由见 `hasTagPage`）：它在索引里要显示，
 *   只是没有自己的页面。把它从统计里抹掉等于假装用户没写过这个标签。
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
 * 把标签转成 `/tags/` 之下的**一层**路径段，规则与 Astro 的产物命名对齐。
 *
 * ## 为什么不能直接用 `encodeURIComponent`（这是 404 的根因）
 *
 * 实测出来的 Astro 产物命名流程（`astro@7.4.2`）：
 *
 * 1. `sanitizeParams()`（`dist/core/routing/generator.js`）对每个动态参数做
 *    `value.normalize().replace(/#/g, "%23").replace(/\?/g, "%3F")`；
 * 2. 拼出 `pathname`（其中的 `%` 是**字面百分号**）；
 * 3. 写盘前 `encodeURI(pathname)` 把 `%` 转成 `%25`；
 * 4. `fileURLToPath()` 对 URL 路径做一次百分号解码。
 *
 * 第 3、4 步互为逆运算，所以 **产物目录名恰好等于第 1 步的输出**（真实构建逐字验证）：
 *
 * | 标签 | 产物目录名 |
 * |---|---|
 * | `C#` | `C%23` |
 * | `#号` | `%23号` |
 * | `a?b` | `a%3Fb` |
 * | `工作` | `工作` |
 * | `100%` | `100%` |
 *
 * 产物目录名就是 `sanitizeParams` 的输出；而浏览器/静态托管把请求路径**完整解码一次**
 * 再去找目录。所以 href 必须满足
 * `decodeURIComponent(href 的路径段) === 产物目录名`。
 * 若拿 `encodeURIComponent(tag)` 当 href，`#号` 得到 `/tags/%23%E5%8F%B7`，
 * 完整解码一次是 `#号`，而磁盘上找的是 `%23号` —— **404**。`C#`、`a?b` 同理。
 *
 * **验的时候必须用 `decodeURIComponent`，不能用 `decodeURI`**：后者**不解**
 * `%23`/`%3F` 这类保留字符的转义，`decodeURI('/tags/%23%E5%8F%B7')` 会返回 `%23号`，
 * 看起来正好等于目录名——旧的有 bug 的实现就是这么被判成「通过」的。见 `tagPath`。
 *
 * ## 只转 `#`、`?`、`/`，**不转 `%`**
 *
 * - `#`→`%23`、`?`→`%3F`：与 `sanitizeParams` 同规则。预转义之后 Astro 那一步对我们的
 *   入参是**恒等变换**，`params.tag` 与磁盘目录名因此是同一个字符串——一致性是
 *   构造出来的，不是两处各写一遍再祈祷相等。
 * - `/`→`%2F`：`sanitizeParams` **不管** `/`。若不转，`params: { tag: 'a/b' }` 会生成
 *   `/tags/a/b` 这个两段 URL，配不上单段的 `[tag]` 路由，构建直接抛
 *   `TypeError: Missing parameter: tag`（实测，整站构建失败）。转成 `%2F` 后标签
 *   始终只占一层。
 * - `%` **保持原样**。初版曾把它预转义成 `%25`，构建立刻报
 *   `NoMatchingStaticPathFound: ... requested path /tags/100%/`：Astro 的
 *   `validateAndDecodePathname()` 会**反复解码直到稳定**，`100%25` 被多解一层成
 *   `100%`，与 `getStaticPaths` 的键对不上。保持原样时 `100%` 走 `sanitizeParams`
 *   的恒等路径，实测构建成功、目录名就是 `100%`。
 *
 * `%` 不转不会造成两个标签撞同一个目录：`100%` → 目录 `100%`、href `100%25`；
 * `100%25` → 目录 `100%25`、href `100%2525`。目录与链接都不同，各自都能命中。
 */
export function tagSegment(tag: string): string {
  return tag
    .normalize()
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
    .replace(/\//g, '%2F');
}

/**
 * `/tags/[tag]` 的路由参数。**页面必须用这个函数**，测试也断言它——两边同一个来源，
 * 所以「页面里传的值」与「测试验的值」不可能分叉。
 *
 * 单独抽出来的理由很实际：评审指出「测试自己重算 `tagSegment(tag)`」的话，
 * 页面里把它改回 `params: { tag }` 也不会被任何断言发现。有了这个入口，
 * `tags.test.ts` 可以既断言它的输出与 Astro 的产物段一致，又对页面源码做一次
 * 「真的调用了它、且没有把原始标签直传」的漂移检查。
 */
export function tagRouteParams(tag: string): { tag: string } {
  return { tag: tagSegment(tag) };
}

/**
 * 标签页的站内路径，**已含 base 且已按 Astro 的产物命名做过编码**。
 *
 * 编码全部交给 `tagSegment()`（理由见那里），这里只负责拼到 `/tags/` 后面、
 * 再过一次 `encodeURI` 把非 ASCII、空格等路径内非法字符转掉，最后加 base。
 *
 * 用 `encodeURI` 而非 `encodeURIComponent`：它保留 `&`、`+`、`=` 等路径内合法字符，
 * 与 Astro 写产物时的 `encodeURI(pathname)` 同构。`/` 已在 `tagSegment()` 里转义，
 * 不会漏成层级。
 *
 * 判据是「**路径段完整解码一次**后等于磁盘目录名」：
 * `decodeURIComponent(tagPath(tag).slice('/tags/'.length)) === 产物目录名`。
 * 别用 `decodeURI` 去验——它**不解** `%23`/`%3F` 这类保留字符的转义，会给出
 * `%23号` 这种「看起来正好等于目录名」的假绿（旧的错误实现就是这么蒙混过关的）。
 * `tags.test.ts` 用的是 `decodeURIComponent`，并用 Astro 自己的 `getRouteGenerator`
 * 算产物目录名。
 */
export function tagPath(tag: string, base?: string): string {
  const path = encodeURI(`/tags/${tagSegment(tag)}`);
  return base === undefined ? withBase(path) : withBase(path, base);
}
