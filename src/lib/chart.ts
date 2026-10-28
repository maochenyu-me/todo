/**
 * 图表几何的**排版决策**纯函数：把「一串数值」折成「画多少格、坐标在哪、被夹住没有」。
 *
 * 为什么单独一层（与 `ticks.ts` 完全同一个理由）：`BarSquares` / `LineChart` 是零逻辑的
 * 展示组件，而这些边界恰恰是容易出错的地方——把一周 1400 件画成 40 格却不告诉读者、
 * 空数据画出一条 0% 的假折线、除以 0 得到 `NaN` 坐标，全都是**页面照样构建成功、
 * 只有人眼才看得出的错**。抽成纯函数，边界靠单测钉死，组件只管把结果画出来。
 *
 * 铁律：
 * - 本文件不得 import `node:*`，也不得 import 任何框架（同 `stats.ts` / `ticks.ts`）。
 * - **绝不产生 `NaN` / `Infinity`**：所有输入先归一化，所有除法先判分母。
 * - **`peak` 是事实，`drawRows` 是画法**。两者绝不混用：护栏只准改动后者。
 */

/** 柱状图的一格（一个单位）的排版尺寸。单位是 SVG 用户单位。 */
export const BAR_GEOMETRY = {
  /** 一个小方块的边长。 */
  square: 8,
  /** 同一根柱子里上下两格的缝。 */
  gap: 2,
  /** 升高一个单位占的纵向距离。 */
  row: 10,
  /**
   * 一根柱子占的横向宽度（含左右留白，给柱底文字腾地方）。
   *
   * 34 而不是更小：柱底文字是 `月/日`（最长 `10/26`），12px 字号下约 30px 宽，
   * 留 6px 缝才不至于两根柱子的字粘在一起。想让 12 根柱子挤进 320px 屏，
   * 只能把字号降到 6px——那正好是这次要修的病。
   */
  slot: 36,
  /** 柱子本身的宽度。 */
  bar: 16,
  /** 基线到柱底文字底边的距离。 */
  labelHeight: 18,
  /** 基线下面的留白。 */
  axisGap: 2,
  /** 截断时柱顶那行真实数值占的高度。 */
  valueHead: 14,
  /** 柱底文字的字号。画布按 1:1 输出，所以这个数就是渲染出来的像素数。 */
  axisFont: 12,
  /** 柱顶真实数值的字号（1:1，同上）。 */
  valueFont: 11,
  /**
   * 一根柱子最多画几格——**护栏，不是排版目标**。
   *
   * 上限是 200 件/天（`frontend.maxTasksPerPage`），一周就是 1400 格：一万六千个
   * `<rect>`、一百多 KB 的 HTML，换来的是一根谁也数不清的墨柱。
   *
   * 但护栏**只能改「画几格」，绝不能改「是多少」**：被夹住的柱子必须在柱顶把真实
   * 数值写出来（`showValues`），否则 40 与 1400 在图上长得一模一样——那比不画更糟。
   */
  ceiling: 40,
} as const;

/** 折线图的排版尺寸。 */
export const LINE_GEOMETRY = {
  /**
   * 画布宽度（用户单位 = 桌面端的像素）。
   *
   * 折线图是**只缩不放**的（`max-w-full`，不给 `w-full`）：容器比它宽就按自然尺寸画，
   * 窄到 320px 屏的内容区（约 280px）时等比缩 `280 / 320 = 0.875`，
   * 于是 `axisFont = 14` 渲染成 `14 × 0.875 = 12.3px`，仍在可读线上。
   */
  width: 320,
  /** 缺省画布高度。 */
  height: 120,
  minHeight: 60,
  maxHeight: 320,
  /** 左侧留给 100%/0% 读数的宽度。 */
  padLeft: 34,
  padRight: 6,
  padTop: 10,
  padBottom: 22,
  /** 轴文字字号（用户单位）。随画布缩放，算式见上面 `width`。 */
  axisFont: 14,
} as const;

export type BarInput = { label: string; value: number };

export type BarPlanRow = {
  label: string;
  /** 归一化后的真实数值（**事实**，不受护栏影响）。 */
  value: number;
  /** 实际画出来的格数（`≤ drawRows`）。 */
  drawnRows: number;
  /** 这根柱子有没有被画出画幅（`value > drawRows`）。 */
  clipped: boolean;
  /** 方块左上角横坐标。 */
  x: number;
  /** 柱心横坐标（柱底文字与柱顶数值都以它居中）。 */
  centerX: number;
  /** 画出来的柱顶纵坐标。 */
  topY: number;
};

export type BarPlan = {
  rows: BarPlanRow[];
  /** 归一化后的**真实峰值**。用于 aria-label / 图注——它是一句事实，不是画法。 */
  peak: number;
  /** 纵轴顶端对应的数值（调用方的 `max`，缺省即 `peak`）。 */
  axisTop: number;
  /** 实际画到第几格（`≤ ceiling`）。**画法**，不进 aria-label 的事实部分。 */
  drawRows: number;
  /** 有没有柱子的真实值超过画幅。 */
  clipped: boolean;
  /** 要不要在柱顶写出真实数值（截断时必须，否则图形无法区分 40 与 1400）。 */
  showValues: boolean;
  /** 有没有东西可画；为 `false` 时组件走 `EmptyState`。 */
  hasUnits: boolean;
  width: number;
  height: number;
  baseline: number;
  /** 所有方块的坐标，从下往上堆。 */
  squares: { x: number; y: number }[];
};

/** 非负整数：负数、`NaN`、`±Infinity` 一律按 0，小数向下取整（口径同 `ticks.ts`）。 */
export function unitCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const n = Math.floor(value);
  return n > 0 ? n : 0;
}

/** 上限归一化：非正数 / 非有限值 / 取整后 < 1 一律回落到 `fallback`（口径同 `paging.ts`）。 */
function limitCount(given: number | undefined, fallback: number): number {
  if (given === undefined) return fallback;
  if (!Number.isFinite(given)) return fallback;
  const n = Math.floor(given);
  return n >= 1 ? n : fallback;
}

export type BarPlanInput = {
  data: BarInput[];
  /** 纵轴顶端画到几格高。缺省取真实峰值；非法值同样回落到峰值。 */
  max?: number;
  /** 绘制护栏。缺省用 `BAR_GEOMETRY.ceiling`；非法值回落到默认护栏。 */
  ceiling?: number;
};

/**
 * 柱状图画法。
 *
 * 归一化 → 峰值 → 画幅（`min(轴顶, 护栏)`）→ 每根柱子夹到画幅顶端 → 坐标。
 *
 * 关键不变量：
 * - `rows[i].value` **永远**是真实值；`rows[i].drawnRows ≤ drawRows`。
 * - `peak` **永远**是真实峰值，与护栏无关。
 * - `showValues === clipped`：一旦有柱子被夹住，柱顶就必须写出真实数值。
 */
export function planBars({ data, max, ceiling }: BarPlanInput): BarPlan {
  const rows: Omit<BarPlanRow, 'x' | 'centerX' | 'topY'>[] = [];
  let peak = 0;
  for (const item of data) {
    const value = unitCount(item.value);
    if (value > peak) peak = value;
    rows.push({ label: item.label, value, drawnRows: 0, clipped: false });
  }

  const axisTop = limitCount(max, peak);
  const drawRows = Math.min(axisTop, limitCount(ceiling, BAR_GEOMETRY.ceiling));

  // 空数据（含「全是 0」）不画：一排零高度的空槽既占版面又不说什么。
  const hasUnits = peak > 0 && rows.length > 0;

  const clipped = rows.some((row) => row.value > drawRows);
  const showValues = clipped;

  const head = showValues ? BAR_GEOMETRY.valueHead : 0;
  const baseline = head + drawRows * BAR_GEOMETRY.row;
  // 至少一个柱位的宽度：空数据已走空状态，这里只是不让 `viewBox="0 0 0 …"` 出现。
  const width = Math.max(rows.length * BAR_GEOMETRY.slot, BAR_GEOMETRY.slot);
  const height = baseline + BAR_GEOMETRY.axisGap + BAR_GEOMETRY.labelHeight;

  const squares: { x: number; y: number }[] = [];
  const placed: BarPlanRow[] = rows.map((row, index) => {
    const drawnRows = Math.min(row.value, drawRows);
    const x =
      index * BAR_GEOMETRY.slot +
      (BAR_GEOMETRY.slot - BAR_GEOMETRY.bar) / 2 +
      (BAR_GEOMETRY.bar - BAR_GEOMETRY.square) / 2;
    const centerX = index * BAR_GEOMETRY.slot + BAR_GEOMETRY.slot / 2;
    const topY = baseline - drawnRows * BAR_GEOMETRY.row;
    for (let unit = 0; unit < drawnRows; unit += 1) {
      squares.push({ x, y: baseline - (unit + 1) * BAR_GEOMETRY.row + BAR_GEOMETRY.gap });
    }
    return { ...row, drawnRows, clipped: row.value > drawRows, x, centerX, topY };
  });

  return {
    rows: placed,
    peak,
    axisTop,
    drawRows,
    clipped,
    showValues,
    hasUnits,
    width,
    height,
    baseline,
    squares,
  };
}

export type LineInput = { x: string; y: number };

export type LinePlan = {
  samples: { x: string; y: number }[];
  /** 有没有点可连；为 `false` 时组件走 `EmptyState`。 */
  hasPoints: boolean;
  /** 单条 `M/L` 折线的 `d`。没有点时是空串（组件不会画它）。 */
  path: string;
  width: number;
  height: number;
  plotLeft: number;
  plotWidth: number;
  plotHeight: number;
  topY: number;
  baselineY: number;
  firstLabel: string;
  lastLabel: string;
  /** 只有一个点时首尾重合，只标一次（重复标会叠字）。 */
  showLastLabel: boolean;
  axisLabels: { label: string; y: number }[];
};

/** 比例归一化：非有限值按 0，其余夹进 [0, 1]——图上不会出现 NaN 坐标，也不会冲出画布。 */
export function ratioOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  return value > 1 ? 1 : value;
}

/** 保留两位小数：坐标里的浮点尾巴既没用，又让产物 HTML 变得难读。 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 折线图画法。
 *
 * 横轴按点数均分：只有 1 个点时跨度是 0，**不做除法**，直接把点放在左端。
 * 纵轴固定 0..1（完成率），所以高度怎么变都不会算出 `NaN` 比例。
 */
export function planLine({
  points,
  height,
  width = LINE_GEOMETRY.width,
}: {
  points: LineInput[];
  height?: number;
  width?: number;
}): LinePlan {
  const samples = points.map((point) => ({ x: point.x, y: ratioOf(point.y) }));

  const h = limitCount(height, LINE_GEOMETRY.height);
  const canvasHeight = Math.min(Math.max(h, LINE_GEOMETRY.minHeight), LINE_GEOMETRY.maxHeight);
  const canvasWidth = Math.max(limitCount(width, LINE_GEOMETRY.width), 40);

  const plotLeft = LINE_GEOMETRY.padLeft;
  const plotWidth = Math.max(canvasWidth - LINE_GEOMETRY.padLeft - LINE_GEOMETRY.padRight, 1);
  const plotHeight = Math.max(
    canvasHeight - LINE_GEOMETRY.padTop - LINE_GEOMETRY.padBottom,
    1,
  );
  const topY = LINE_GEOMETRY.padTop;
  const baselineY = canvasHeight - LINE_GEOMETRY.padBottom;

  const stepX = (index: number): number => {
    // 只有一个点时没有跨度：不做除法，固定在绘图区左端。
    if (samples.length <= 1) return round2(plotLeft);
    return round2(plotLeft + (plotWidth * index) / (samples.length - 1));
  };
  const stepY = (value: number): number => round2(baselineY - plotHeight * value);

  const path = samples
    .map((sample, index) => `${index === 0 ? 'M' : 'L'}${stepX(index)} ${stepY(sample.y)}`)
    .join(' ');

  return {
    samples,
    hasPoints: samples.length > 0,
    path,
    width: canvasWidth,
    height: canvasHeight,
    plotLeft,
    plotWidth,
    plotHeight,
    topY,
    baselineY,
    firstLabel: samples[0]?.x ?? '',
    lastLabel: samples[samples.length - 1]?.x ?? '',
    showLastLabel: samples.length > 1,
    // 中间不画网格线：一条线加两个数字已经够读。
    axisLabels: [
      { label: '100%', y: round2(topY) },
      { label: '0%', y: round2(baselineY) },
    ],
  };
}
