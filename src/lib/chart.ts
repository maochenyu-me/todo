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
   * 这是**下限**：`planBars()` 会按实际标签宽度算一遍，取
   * `max(slot, 最宽标签 + labelGap)`，所以 36 只对窄标签（`8/10`）生效，
   * 换成 `10/26` 或 `12月31日` 时柱位会自动加宽，绝不会撞字。
   */
  slot: 36,
  /** 相邻两个柱底标签之间至少要留的缝。 */
  labelGap: 6,
  /** 柱子本身的宽度。 */
  bar: 16,
  /** 基线到柱底文字底边的距离。20 而不是 18：12px 字的下伸约 3px，再加 1px 余量。 */
  labelHeight: 20,
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
   * 于是 `axisFont = 14` 渲染成 `14 × 0.875 = 12.25px`，仍在可读线上。
   */
  width: 320,
  /**
   * 画布宽度的**上限**（显式加宽时的钳制）。
   *
   * 统计页的折线图在宽容器里会传入更大的 `width`（与 `planBars` 的只加宽不缩窄同口径）：
   * 加宽摊开的是 90 个采样点的横轴步距，轴文字仍是 14px 用户单位、1:1 渲染。
   * 上限只防手滑传进离谱的值；窄屏不缩放，由组件的横向滚动兜底。
   */
  maxWidth: 1200,
  /** 缺省画布高度。 */
  height: 120,
  minHeight: 60,
  maxHeight: 320,
  /**
   * 左侧留给纵轴读数（`100%` / `0%`）的宽度。
   *
   * 这个数**不是**审美选择，是被字宽算出来的：`100%` 在 14px 下最宽 2.645em ≈ 37.0px
   * （见 `advanceEm`），加上 6px 缝 = 43.0px；留 46 是给字体差异和亚像素余量。
   *
   * 曾经的 34 是个真事故：`text-anchor="end"` 把标签的右边缘钉在 `46-…`→当时是
   * `34-6=28`，而 37px 的字宽从 28 往左伸到 −9，`1` 整个落在 viewBox 外面被裁掉，
   * 页面上于是印出「00%」。`chart.test.ts` 里的 label-fit 断言就是防这个的。
   */
  padLeft: 46,
  padRight: 6,
  padTop: 10,
  padBottom: 22,
  /** 纵轴读数与轴线的水平间距。 */
  yLabelGap: 6,
  /** 横轴首尾两个标签之间至少留的空档（px）；小于它就算「叠字」。 */
  minXLabelGap: 8,
  /** 轴文字字号（用户单位）。随画布缩放，算式见上面 `width`。 */
  axisFont: 14,
} as const;

/**
 * 逐字符的字宽估计（单位 `em`）。
 *
 * 为什么需要它：SVG 里没有「自动换行/自动留白」，文字超出 viewBox 会被**静默裁掉**——
 * 页面照样构建成功，只有人眼能发现少了个 `1`。真正量字宽要有字体引擎，构建期没有；
 * 这里取一个**偏保守**的上界，把「装不下」变成构建期就能断言的事。
 *
 * 数值是实测出来的：在 100px 字号下量 Segoe UI / Arial / Tahoma 三套最常见的西文字体，
 * 逐字符取**最大值**（见 `task-10-report.md` 的量表）。中文按 1em 算（实测 1.000–1.047）。
 *
 * 只覆盖图表里会出现的字符（数字、`%`、`/`、`-`、空格、ASCII 字母、CJK）。
 * 遇到没登记的字符一律按 `1em` 估——宁可高估到报警，也不要低估到裁字。
 */
const CHAR_EM: Record<string, number> = {
  '0': 0.556,
  '1': 0.556,
  '2': 0.556,
  '3': 0.556,
  '4': 0.556,
  '5': 0.556,
  '6': 0.556,
  '7': 0.556,
  '8': 0.556,
  '9': 0.556,
  '%': 0.977,
  '/': 0.39,
  '-': 0.4,
  ':': 0.34,
  '.': 0.28,
  ' ': 0,
};

/** ASCII 字母：实测最宽 0.667em（`A`），取它当上界。 */
const LETTER_EM = 0.667;
/** 中文与全角标点：实测 1.000–1.047em。 */
const CJK_EM = 1.05;

/**
 * 估算一段文字在给定字号下的**前进宽度**（px）。偏保守的上界，不是精确排版值。
 *
 * 用途只有一个：在构建期断言「这个标签装得进那个空隙」。它不需要和浏览器像素级一致，
 * 只需要**不低于**真实宽度——所以每个字符都取三种常见字体的最大值。
 */
export function advanceEm(text: string, fontSize: number): number {
  let em = 0;
  for (const char of text) {
    const known = CHAR_EM[char];
    if (known !== undefined) {
      em += known;
      continue;
    }
    // ASCII 字母
    if (/[A-Za-z]/.test(char)) {
      em += LETTER_EM;
      continue;
    }
    // 其余按全角算：CJK、全角标点，以及任何未登记的字符（宁可高估）。
    em += CJK_EM;
  }
  return em * fontSize;
}

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
  /**
   * 柱底标签会不会**装不进自己的柱位**（相邻两个标签会撞在一起）。
   *
   * 构建期就能知道的事，不要留给读者的眼睛：组件据此加宽柱位（见组件里的
   * `labelSlot`），测试据此钉住「最宽的标签 + 最小缝 ≤ 柱位」。
   */
  labelFits: boolean;
  /** 最宽的那个柱底标签的估算宽度（px）。 */
  widestLabel: number;
  /** 最宽的柱顶数值标签的估算宽度（px）；没有截断时为 0。 */
  widestValue: number;
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
  /**
   * 目标画布宽度（用户单位 = 像素）。缺省不设：柱位取自然宽度（见 `slot`）。
   *
   * 存在理由只有一处：宽屏上这张图要铺满比正文更宽的图表列（`/stats`）。而**加宽柱位
   * 不会改动字号**——方块 8、柱底字 12 都是固定的用户单位，柱位只是它们之间的间距，
   * 所以它可以既铺满 672px 又不把刻度字放大成 17px。这一点和折线图完全不同：
   * 那边加宽画布会把 14px 的轴字按比例放大（或缩小时压到读不清）。
   *
   * 只**加宽**、绝不缩窄：目标比自然宽度小、非正数或非有限值时，按自然宽度画——
   * 窄屏另有横向滚动兜底（见 `BarSquares`），这里不需要也不应该帮忙「挤紧」。
   */
  width?: number;
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
export function planBars({ data, max, ceiling, width }: BarPlanInput): BarPlan {
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

  /*
   * 柱位宽度：既要装得下柱底标签，也要装得下柱顶那个真实数值。
   *
   * 这是「构建期就该知道的事」的典型：柱位固定 36 而标签是 `10/26`（12px 下约 30.8px，
   * 三套西文字体里最宽的那套）+ 缝，只要换个字体或换个日期写法就会撞在一起。
   * 这里按实际标签量一遍，取「固定柱位」与「最宽标签 + 缝」的较大值——
   * 于是在任何数据下都不会撞字，而常见数据（`8/10` 这类窄标签）仍然用紧凑的 36。
   */
  const labelGap = BAR_GEOMETRY.labelGap;
  const widestLabel = rows.reduce(
    (widest, row) => Math.max(widest, advanceEm(row.label, BAR_GEOMETRY.axisFont)),
    0,
  );
  const widestValue = showValues
    ? rows.reduce(
        (widest, row) =>
          row.value > drawRows
            ? Math.max(widest, advanceEm(String(row.value), BAR_GEOMETRY.valueFont))
            : widest,
        0,
      )
    : 0;

  // 标签与数值共用同一个柱位；两者都要留缝。
  const naturalSlot = Math.max(
    BAR_GEOMETRY.slot,
    Math.ceil(Math.max(widestLabel, widestValue) + labelGap),
  );
  // 判据：最宽的标签 + 最小缝 ≤ 生效柱位（宽度是取 max 来的，所以恒成立；
  // 这个字段用来在测试里钉住「将来若有人把 max 去掉，立刻红」）。
  const labelFits = Math.max(widestLabel, widestValue) + labelGap <= naturalSlot;

  const head = showValues ? BAR_GEOMETRY.valueHead : 0;
  const baseline = head + drawRows * BAR_GEOMETRY.row;

  /*
   * 柱位（`slot`）＝相邻两根柱子的中心距。
   *
   * 缺省就是自然宽度 `naturalSlot`。调用方给了更大的 `width` 时，把多出来的横向空间
   * **平均分给 12 个柱位**：字号、方块边长、柱宽一个都不动，只是间距变大。
   * 这正是这张图能「铺满宽列而不放大字号」的原因（见 `BarPlanInput.width`）。
   *
   * 只加宽不缩窄：目标比自然宽度小（含窄屏）时一律按自然宽度画——挤紧会把
   * 柱底标签推到撞字，而窄屏本来就该靠横向滚动看全（`BarSquares` 的容器负责）。
   */
  const naturalWidth = Math.max(rows.length * naturalSlot, naturalSlot);
  const requested = Number.isFinite(width) ? Math.floor(width as number) : 0;
  const stretched = rows.length > 0 && requested > naturalWidth;
  const slot = stretched ? requested / rows.length : naturalSlot;
  // 至少一个柱位的宽度：空数据已走空状态，这里只是不让 `viewBox="0 0 0 …"` 出现。
  const planWidth = Math.max(rows.length * slot, slot);
  const height = baseline + BAR_GEOMETRY.axisGap + BAR_GEOMETRY.labelHeight;

  const squares: { x: number; y: number }[] = [];
  const placed: BarPlanRow[] = rows.map((row, index) => {
    const drawnRows = Math.min(row.value, drawRows);
    const centerX = index * slot + slot / 2;
    // 方块按柱心居中；只在被拉宽时才四舍五入到整像素（8px 的小方块落在半像素上会发虚），
    // 自然宽度下 `slot` 本身是整数，四舍五入拿到的仍是原来的坐标。
    const rawX = centerX - BAR_GEOMETRY.bar / 2 + (BAR_GEOMETRY.bar - BAR_GEOMETRY.square) / 2;
    const x = stretched ? Math.round(rawX) : rawX;
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
    width: planWidth,
    height,
    baseline,
    squares,
    labelFits,
    widestLabel,
    widestValue,
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
  /**
   * 纵轴读数有没有**伸出画布左边**。
   *
   * 必须是 plan 的一部分而不是组件里的临时判断：`text-anchor="end"` 把标签右边缘钉在
   * `plotLeft - yLabelGap`，若字宽超过 `plotLeft - yLabelGap`，左边那几个字符就落在
   * viewBox 外面被静默裁掉（曾经把 `100%` 印成 `00%`）。
   */
  yLabelFits: boolean;
  /** 最宽的纵轴读数的估算宽度（px）。 */
  widestYLabel: number;
  /**
   * 首尾两个横轴标签会不会撞在一起。
   *
   * `formatLong()` 的写法（`2026年7月31日 周五`）在 14px 下有 130px 以上，两个加起来
   * 就超过了 270px 的绘图区——两个都画出来会叠成一团。装不下时组件只画尾部那个
   * （「到哪天为止」比「从哪天开始」更重要），并把完整范围留在 aria-label 与表格里。
   */
  xLabelsFit: boolean;
  /** 首尾两个标签需要的总宽度（px）。 */
  xLabelsWidth: number;
  /** 首尾标签之间实际能腾出的空档（px），可能为负。 */
  xLabelGap: number;
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

/** 纵轴读数：只有 0% 与 100% 两个。中间不画网格线——一条线加两个数字已经够读。 */
const axisLabelTexts = ['100%', '0%'];

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
  /*
   * 宽度口径与 `planBars` 一致：**只加宽、绝不缩窄**。
   * 非法值回落到自然宽度 320；合法但更小的值抬回 320（窄屏有横向滚动兜底，不帮忙挤紧）；
   * 超过 `maxWidth` 的钳回上限，防手滑。
   */
  const canvasWidth = Math.min(
    Math.max(limitCount(width, LINE_GEOMETRY.width), LINE_GEOMETRY.width),
    LINE_GEOMETRY.maxWidth,
  );

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

  const firstLabel = samples[0]?.x ?? '';
  const lastLabel = samples[samples.length - 1]?.x ?? '';
  const showLastLabel = samples.length > 1;

  /*
   * 纵轴读数能不能装进左边距。
   *
   * `text-anchor="end"` ⇒ 标签右边缘在 `plotLeft - yLabelGap`，往左伸 `width`。
   * 装得下 ⇔ `width ≤ plotLeft - yLabelGap`。这条判据以前没人写，于是字号从 8 涨到 14
   * 而 padLeft 没跟上时，`100%` 的 `1` 就被裁掉、页面上印出「00%」。
   */
  const widestYLabel = axisLabelTexts.reduce(
    (widest, text) => Math.max(widest, advanceEm(text, LINE_GEOMETRY.axisFont)),
    0,
  );
  const yLabelFits = widestYLabel <= plotLeft - LINE_GEOMETRY.yLabelGap;

  /*
   * 首尾两个横轴标签会不会撞。
   *
   * 绘图区宽度是 `plotWidth`；两个标签分别贴左端、贴右端，各自居外对齐，
   * 所以它们占掉的总宽度就是两个字宽之和，中间剩下的才是空档。
   */
  const xLabelsWidth = showLastLabel
    ? advanceEm(firstLabel, LINE_GEOMETRY.axisFont) +
      advanceEm(lastLabel, LINE_GEOMETRY.axisFont)
    : 0;
  const xLabelGap = plotWidth - xLabelsWidth;
  const xLabelsFit = !showLastLabel || xLabelGap >= LINE_GEOMETRY.minXLabelGap;

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
    firstLabel,
    lastLabel,
    showLastLabel,
    // 中间不画网格线：一条线加两个数字已经够读。
    axisLabels: axisLabelTexts.map((label, index) => ({
      label,
      y: round2(index === 0 ? topY : baselineY),
    })),
    yLabelFits,
    widestYLabel,
    xLabelsFit,
    xLabelsWidth,
    xLabelGap,
  };
}
