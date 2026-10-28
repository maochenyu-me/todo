/**
 * 刻度条的**排版决策**纯函数：把「这一天有多少条、完成几条」折成
 * 「画几个格子、填几个、还剩多少没说」。
 *
 * 为什么单独一层：`ProgressTicks` 是零逻辑的展示组件，而这些边界（上限、比例、
 * 病态输入）恰恰是容易出错的地方——画 200 个方块把版面撑爆、或者把「完成六成」
 * 画成「全完成」，都属于页面照样构建成功、只有人眼才看得出的错。抽成纯函数，
 * 边界靠单测钉死，组件只管把结果画出来。
 *
 * 铁律：本文件不得 import `node:*`，也不得 import 任何框架。
 */

export type TickPlan = {
  /** 实际要渲染的格子数。未设上限时等于 `total`。 */
  shown: number;
  /** 这 `shown` 个格子里填墨的个数。未截断时等于 `done`；截断后是**按比例**折算的密度。 */
  filled: number;
  /** 因为上限而**没有画出来**的任务条数（`0` 表示没截断）。 */
  overflow: number;
  /** 生效的上限；`null` 表示未设上限。 */
  cap: number | null;
};

/** 收敛成非负整数：负数、`NaN`、`Infinity`、非数一律按 0；小数向下取整。 */
function nonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const n = Math.floor(value);
  return n > 0 ? n : 0;
}

/**
 * 上限归一化，口径与 `paging.ts` 的 `capTasks` **完全一致**：
 * 非正数、`NaN`、`Infinity`、取整后 < 1 一律视为「不限」（`null`）。
 *
 * 理由同那里：上限的唯一职责是「别让一个坏文件把页面撑爆」，`0` 起不到这个作用，
 * 只会把每一天都变成空刻度——把护栏本身变成故障源。
 */
function normalizeCap(maxTicks: number | undefined): number | null {
  if (maxTicks === undefined) return null;
  if (!Number.isFinite(maxTicks)) return null;
  const n = Math.floor(maxTicks);
  return n >= 1 ? n : null;
}

/**
 * 计算刻度条的画法。
 *
 * - `total === 0`：`shown` 为 0，组件走空态文案（`emptyLabel`），本函数不做判断。
 * - 未设上限（或上限非正）：`shown = total`、`filled = 夹到 [0,total] 的 done`、
 *   `overflow = 0`。**单日页走的就是这条路，行为与改动前逐字相同。**
 * - 超过上限：`shown = cap`，`overflow = total - cap`，`filled` **按完成率折算**。
 *
 * 为什么截断后要按比例算 `filled` 而不是 `min(done, cap)`：
 * 后者会把「200 条完成 120 条」画成 12 个满格，也就是把「完成六成」画成「全完成」。
 * 密度条的唯一职责就是把比例说对，画不到那么细就该**近似**，不能放大。
 *
 * 注意 `overflow` 只报「没画出来的格子数」，文字说明里**仍会给出真实的
 * `done / total`**（见组件），所以截断不会让读者失去精确数字。
 */
export function planTicks(total: number, done: number, maxTicks?: number): TickPlan {
  const totalCount = nonNegativeInt(total);
  const cap = normalizeCap(maxTicks);

  if (cap === null || totalCount <= cap) {
    // 未截断：填充数就是完成数（夹进合法区间，绝不越界）。
    const filled = Math.max(0, Math.min(nonNegativeInt(done), totalCount));
    return { shown: totalCount, filled, overflow: 0, cap };
  }

  const doneCount = Math.max(0, Math.min(nonNegativeInt(done), totalCount));
  const ratio = totalCount === 0 ? 0 : doneCount / totalCount;
  // 四舍五入到最近的格子；再夹一次，保证不会因为浮点误差越界。
  const filled = Math.max(0, Math.min(Math.round(ratio * cap), cap));
  return { shown: cap, filled, overflow: totalCount - cap, cap };
}
