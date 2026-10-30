/**
 * E2E 的冻结「今天」：**种子数据里最新的日期**。
 *
 * E2E 的断言与种子绑定（今天 4 条、前一天 10-28……），而种子是静态文件——
 * 真实日期一旦越过种子的最后一天，首页就会渲染成空状态，整套用例天天发红。
 * 所以「今天」必须冻结在种子的时间线上，而不是真实时钟上。
 *
 * 冻结日**从种子推导**而不是写死：种子加了新的一天，冻结日自动跟上，
 * 这里永远不会变成第二个需要记得改的日期常量（`admin.spec` 里那个写死的
 * `TODAY = '2026-10-29'` 正是这种事故的前身）。
 *
 * 消费方两处，读的是**同一份种子**，答案逐字节一致：
 * - `scripts/e2e-server.mjs`：构建前注入 `PUBLIC_BUILD_TODAY`，
 *   页面构建期的 `todayInZone()` 全部冻在这个值上（含后台岛屿的客户端 bundle）；
 * - 各 spec 文件：断言里用的 `TODAY` 直接从这里拿，不再 `todayInZone()` 重算
 *   ——重算会拿到真实时钟的今天，与产物对不上。
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 日期 key 的严格形状：零填充 YYYY-MM-DD（真实日历日由文件名来源保证）。 */
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 从一个目录里收日期 key（`<date>.json` 的文件名）。目录不存在 → 空数组。 */
function dateKeysIn(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((key) => DATE_KEY_RE.test(key));
}

/**
 * 冻结日：活跃区 + 归档区全部种子文件名里**字典序最大**的日期。
 * 字典序即时间序（同 date.ts 的口径）。
 */
export function frozenToday() {
  const keys = [
    ...dateKeysIn(join(ROOT, 'src', 'data', 'todos')),
    ...dateKeysIn(join(ROOT, 'src', 'data', 'archive')),
  ].sort();
  const latest = keys.at(-1);
  if (!latest) {
    // 种子是仓库承诺保留的文档数据（spec：种子用作说明），真被清空了就大声失败，
    // 不许悄悄冻在 `undefined` 上把整套 E2E 变成「空站点的断言」。
    throw new Error('[frozen-today] 种子数据里没有任何日期文件，无法冻结「今天」');
  }
  return latest;
}
