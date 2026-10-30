import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { BAR_GEOMETRY, LINE_GEOMETRY, advanceEm, planBars, planLine } from './chart';

/** 一本「正常」的 12 周数据：峰值远低于护栏。 */
function normalWeeks() {
  return [
    { label: '8/10', value: 17 },
    { label: '8/17', value: 20 },
    { label: '8/24', value: 9 },
    { label: '8/31', value: 4 },
    { label: '9/7', value: 12 },
    { label: '9/14', value: 0 },
    { label: '9/21', value: 31 },
    { label: '9/28', value: 6 },
    { label: '10/5', value: 14 },
    { label: '10/12', value: 11 },
    { label: '10/19', value: 24 },
    { label: '10/26', value: 12 },
  ];
}

describe('chart.ts — 单位归一化（病态输入不产生 NaN / 负数 / 非整数）', () => {
  test('负数 / NaN / -Infinity 一律按 0', () => {
    const plan = planBars({
      data: [
        { label: 'a', value: -3 },
        { label: 'b', value: Number.NaN },
        { label: 'c', value: Number.NEGATIVE_INFINITY },
      ],
    });
    expect(plan.rows.map((row) => row.value)).toEqual([0, 0, 0]);
    expect(plan.peak).toBe(0);
    expect(plan.hasUnits).toBe(false);
  });

  test('+Infinity 按 0（它不是「很高」，它是「不知道」）', () => {
    const plan = planBars({ data: [{ label: 'a', value: Number.POSITIVE_INFINITY }] });
    expect(plan.rows[0]?.value).toBe(0);
    expect(plan.hasUnits).toBe(false);
  });

  test('小数向下取整', () => {
    const plan = planBars({
      data: [
        { label: 'a', value: 2.9 },
        { label: 'b', value: 0.4 },
      ],
    });
    expect(plan.rows.map((row) => row.value)).toEqual([2, 0]);
    expect(plan.peak).toBe(2);
  });

  test('峰值取归一化后的最大值，且输出全部是有限整数', () => {
    const plan = planBars({ data: normalWeeks() });
    expect(plan.peak).toBe(31);
    for (const row of plan.rows) {
      expect(Number.isFinite(row.value)).toBe(true);
      expect(Number.isInteger(row.value)).toBe(true);
      expect(row.value).toBeGreaterThanOrEqual(0);
    }
    for (const n of [plan.width, plan.height, plan.baseline, plan.axisTop, plan.drawRows]) {
      expect(Number.isFinite(n)).toBe(true);
    }
  });
});

describe('chart.ts — 空数据判定（组件据此选 EmptyState）', () => {
  test('空数组 → hasUnits 为 false', () => {
    expect(planBars({ data: [] }).hasUnits).toBe(false);
  });

  test('全 0 → hasUnits 为 false（一排零高度的空槽什么也不说）', () => {
    expect(planBars({ data: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] }).hasUnits).toBe(
      false,
    );
  });

  test('只要有一个正数 → hasUnits 为 true', () => {
    expect(planBars({ data: [{ label: 'a', value: 0 }, { label: 'b', value: 1 }] }).hasUnits).toBe(
      true,
    );
  });
});

describe('chart.ts — 柱高比例（峰值落在护栏内时必须严格成正比）', () => {
  test('两倍的数值画两倍高', () => {
    const plan = planBars({
      data: [
        { label: 'a', value: 3 },
        { label: 'b', value: 6 },
        { label: 'c', value: 12 },
      ],
    });
    const [three, six, twelve] = plan.rows;
    expect(three?.drawnRows).toBe(3);
    expect(six?.drawnRows).toBe(6);
    expect(twelve?.drawnRows).toBe(12);
    // 像素高度同样成正比：一格 = 一个 row。
    expect((six?.drawnRows ?? 0) * BAR_GEOMETRY.row).toBe(
      2 * (three?.drawnRows ?? 0) * BAR_GEOMETRY.row,
    );
  });

  test('轴顶就是峰值（未传 max、未触发护栏时），柱子刚好画满画布', () => {
    const plan = planBars({ data: normalWeeks() });
    expect(plan.axisTop).toBe(31);
    expect(plan.drawRows).toBe(31);
    expect(plan.clipped).toBe(false);
    expect(plan.showValues).toBe(false);
    // 最高的那根柱子顶到基线之上的整段画幅。
    expect(plan.baseline - plan.drawRows * BAR_GEOMETRY.row).toBeGreaterThanOrEqual(0);
  });

  test('传了更高的 max：柱子按真实比例画，画布留白变多', () => {
    const plan = planBars({ data: [{ label: 'a', value: 4 }], max: 10 });
    expect(plan.axisTop).toBe(10);
    expect(plan.drawRows).toBe(10);
    expect(plan.rows[0]?.drawnRows).toBe(4);
    expect(plan.clipped).toBe(false);
  });

  test('max 非法（0 / 负数 / NaN / Infinity）时回落到峰值', () => {
    for (const max of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = planBars({ data: [{ label: 'a', value: 7 }], max });
      expect(plan.axisTop).toBe(7);
      expect(plan.drawRows).toBe(7);
    }
  });
});

describe('chart.ts — 护栏与截断：必须报出**真实峰值**，不能把护栏当成数据', () => {
  test('峰值超过护栏时：drawRows 封顶，但 peak / axisTop 仍是真实值', () => {
    // 一周 7 天 × 200 件 = 1400。这是真实可能的数据（maxTasksPerPage = 200）。
    const plan = planBars({ data: [{ label: 'w', value: 1400 }] });
    expect(plan.peak).toBe(1400);
    expect(plan.axisTop).toBe(1400);
    expect(plan.drawRows).toBe(BAR_GEOMETRY.ceiling);
    expect(plan.clipped).toBe(true);
    // 截断时必须把真实数值画出来，否则 40 和 1400 在图上长得一模一样。
    expect(plan.showValues).toBe(true);
  });

  test('截断时每根柱子各自报出自己被画成几格（夹取到画幅顶端）', () => {
    const plan = planBars({
      data: [
        { label: 'a', value: 5 },
        { label: 'b', value: 60 },
        { label: 'c', value: 1400 },
      ],
    });
    expect(plan.drawRows).toBe(BAR_GEOMETRY.ceiling);
    expect(plan.rows.map((row) => row.drawnRows)).toEqual([
      5,
      BAR_GEOMETRY.ceiling,
      BAR_GEOMETRY.ceiling,
    ]);
    expect(plan.rows.map((row) => row.clipped)).toEqual([false, true, true]);
    // 真实值一个都没被改写。
    expect(plan.rows.map((row) => row.value)).toEqual([5, 60, 1400]);
  });

  test('护栏本身可注入；非法护栏回落到默认值（0 不能把每天的柱子变成 0 格）', () => {
    const five = planBars({ data: [{ label: 'a', value: 9 }], ceiling: 5 });
    expect(five.drawRows).toBe(5);
    expect(five.clipped).toBe(true);

    for (const ceiling of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
      const plan = planBars({ data: [{ label: 'a', value: 9 }], ceiling });
      expect(plan.drawRows).toBe(9);
      expect(plan.clipped).toBe(false);
    }
  });

  test('恰好等于护栏不触发截断（边界）', () => {
    const plan = planBars({ data: [{ label: 'a', value: BAR_GEOMETRY.ceiling }] });
    expect(plan.clipped).toBe(false);
    expect(plan.showValues).toBe(false);
    expect(plan.rows[0]?.drawnRows).toBe(BAR_GEOMETRY.ceiling);
  });

  test('比护栏多一条就触发截断（边界）', () => {
    const plan = planBars({ data: [{ label: 'a', value: BAR_GEOMETRY.ceiling + 1 }] });
    expect(plan.clipped).toBe(true);
    expect(plan.showValues).toBe(true);
    expect(plan.rows[0]?.drawnRows).toBe(BAR_GEOMETRY.ceiling);
    expect(plan.rows[0]?.value).toBe(BAR_GEOMETRY.ceiling + 1);
  });

  test('调用方传的 max 低于峰值也算截断（同上，真实值仍然报出来）', () => {
    const plan = planBars({
      data: [
        { label: 'a', value: 9 },
        { label: 'b', value: 4 },
      ],
      max: 3,
    });
    expect(plan.axisTop).toBe(3);
    expect(plan.drawRows).toBe(3);
    expect(plan.clipped).toBe(true);
    expect(plan.peak).toBe(9);
    expect(plan.rows.map((row) => row.drawnRows)).toEqual([3, 3]);
  });

  test('画布尺寸随画幅变化，且不越界为负', () => {
    const tall = planBars({ data: [{ label: 'a', value: 1400 }] });
    const short = planBars({ data: [{ label: 'a', value: 2 }] });

    // 护栏的意义就在这里：1400 的画布与「刚好等于护栏」的画布一样高，
    // 而按真实值画会是 1400 格（14000 用户单位）——量级差别才是护栏存在的理由。
    const atCeiling = planBars({ data: [{ label: 'a', value: BAR_GEOMETRY.ceiling }] });
    expect(tall.drawRows).toBe(atCeiling.drawRows);
    // 截断时多一行柱顶数值，所以比「恰好等于护栏」略高一点点。
    expect(tall.height).toBe(atCeiling.height + BAR_GEOMETRY.valueHead);
    // 未截断的尺寸必须远大于截断后的（说明护栏真的起了作用）。
    expect(planBars({ data: [{ label: 'a', value: 1400 }], ceiling: 1400 }).height).toBeGreaterThan(
      tall.height * 10,
    );

    expect(tall.width).toBeGreaterThanOrEqual(BAR_GEOMETRY.slot);
    // 12 根柱子 ⇒ 12 个柱位；柱位会按标签宽度自动加宽，所以只断言下界与整除。
    const twelve = planBars({ data: normalWeeks() });
    expect(twelve.width % 12).toBe(0);
    expect(twelve.width).toBeGreaterThanOrEqual(12 * BAR_GEOMETRY.slot);
    for (const plan of [tall, short]) {
      expect(plan.height).toBeGreaterThan(0);
      expect(plan.baseline).toBeGreaterThan(0);
      expect(plan.baseline).toBeLessThan(plan.height);
    }
  });
});

describe('chart.ts — 折线路径', () => {
  test('没有点 → hasPoints 为 false，路径为空', () => {
    const plan = planLine({ points: [] });
    expect(plan.hasPoints).toBe(false);
    expect(plan.path).toBe('');
    expect(plan.samples).toEqual([]);
  });

  test('一个点 → 只画 M，不除零', () => {
    const plan = planLine({ points: [{ x: '2026-10-28', y: 0.5 }] });
    expect(plan.hasPoints).toBe(true);
    expect(plan.path.startsWith('M')).toBe(true);
    expect(plan.path).not.toContain('L');
    expect(plan.path).not.toMatch(/NaN|Infinity/);
    expect(plan.showLastLabel).toBe(false);
  });

  test('多个点：M 起头，其余全用 L，首尾贴住绘图区两端', () => {
    const plan = planLine({
      points: [
        { x: 'a', y: 0 },
        { x: 'b', y: 0.5 },
        { x: 'c', y: 1 },
      ],
    });
    expect(plan.path.match(/M/g)).toHaveLength(1);
    expect(plan.path.match(/L/g)).toHaveLength(2);
    expect(plan.path.startsWith(`M${plan.plotLeft} `)).toBe(true);
    expect(plan.path.endsWith(`L${plan.plotLeft + plan.plotWidth} ${plan.topY}`)).toBe(true);
    expect(plan.showLastLabel).toBe(true);
    expect(plan.firstLabel).toBe('a');
    expect(plan.lastLabel).toBe('c');
  });

  test('90 个点全部落进绘图区，且没有 NaN / Infinity', () => {
    const points = Array.from({ length: 90 }, (_, i) => ({
      x: `d${i}`,
      y: (i % 7) / 6,
    }));
    const plan = planLine({ points });
    expect(plan.hasPoints).toBe(true);
    expect(plan.path).not.toMatch(/NaN|Infinity/);
    const coords = plan.path.match(/-?\d+(?:\.\d+)?/g) ?? [];
    expect(coords.length).toBe(90 * 2);
    for (const raw of coords) {
      const n = Number(raw);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  test('y 越界被夹进 [0,1]，NaN / Infinity 当 0', () => {
    const plan = planLine({
      points: [
        { x: 'a', y: -2 },
        { x: 'b', y: 7 },
        { x: 'c', y: Number.NaN },
        { x: 'd', y: Number.POSITIVE_INFINITY },
      ],
    });
    expect(plan.samples.map((sample) => sample.y)).toEqual([0, 1, 0, 0]);
    expect(plan.path).not.toMatch(/NaN|Infinity/);
  });

  test('0 与 100% 分别贴住基线/顶线（纵轴不动）', () => {
    const plan = planLine({
      points: [
        { x: 'a', y: 0 },
        { x: 'b', y: 1 },
      ],
    });
    expect(plan.path).toBe(
      `M${plan.plotLeft} ${plan.baselineY} L${plan.plotLeft + plan.plotWidth} ${plan.topY}`,
    );
  });

  test('只有 1 个点时不画第二个横轴标签（会叠字）', () => {
    expect(planLine({ points: [{ x: 'a', y: 0 }] }).showLastLabel).toBe(false);
    expect(planLine({ points: [{ x: 'a', y: 0 }, { x: 'b', y: 0 }] }).showLastLabel).toBe(true);
  });

  test('高度可注入并夹进 [min,max]；非法值回落到默认', () => {
    const points = [{ x: 'a', y: 0.5 }];
    expect(planLine({ points, height: 200 }).height).toBe(200);
    expect(planLine({ points, height: 10 }).height).toBe(LINE_GEOMETRY.minHeight);
    expect(planLine({ points, height: 10_000 }).height).toBe(LINE_GEOMETRY.maxHeight);
    for (const height of [undefined, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(planLine({ points, height }).height).toBe(LINE_GEOMETRY.height);
    }
    // 绘图区永远为正，任何高度下都不可能算出 NaN 比例。
    for (const height of [60, 120, 200, 320]) {
      const plan = planLine({ points, height });
      expect(plan.plotHeight).toBeGreaterThan(0);
      expect(plan.plotWidth).toBeGreaterThan(0);
    }
  });

  test('纵轴只有 0% 与 100% 两个读数', () => {
    const plan = planLine({ points: [{ x: 'a', y: 0.3 }] });
    expect(plan.axisLabels.map((axis) => axis.label)).toEqual(['100%', '0%']);
    expect(plan.axisLabels[0]?.y).toBe(plan.topY);
    expect(plan.axisLabels[1]?.y).toBe(plan.baselineY);
  });

  test('宽度：显式加宽铺满目标值，字号不动（口径同 planBars）', () => {
    const points = [
      { x: 'a', y: 0 },
      { x: 'b', y: 1 },
    ];
    const plan = planLine({ points, width: 992 });
    expect(plan.width).toBe(992);
    // 加宽只摊开横轴：绘图区跟着变宽，首尾两点仍贴住两端。
    expect(plan.plotWidth).toBe(992 - LINE_GEOMETRY.padLeft - LINE_GEOMETRY.padRight);
    expect(plan.path).toBe(
      `M${plan.plotLeft} ${plan.baselineY} L${plan.plotLeft + plan.plotWidth} ${plan.topY}`,
    );
  });

  test('宽度：只加宽不缩窄，超上限钳回 maxWidth，非法值回落自然宽度', () => {
    const points = [{ x: 'a', y: 0.5 }];
    // 比自然宽度小 → 抬回 320（窄屏靠横向滚动兜底，不帮忙挤紧）。
    expect(planLine({ points, width: 100 }).width).toBe(LINE_GEOMETRY.width);
    // 超上限 → 钳回。
    expect(planLine({ points, width: 10_000 }).width).toBe(LINE_GEOMETRY.maxWidth);
    // 非法 → 自然宽度。
    for (const width of [undefined, Number.NaN, 0]) {
      expect(planLine({ points, width }).width).toBe(LINE_GEOMETRY.width);
    }
  });
});

describe('chart.ts — 标签装得下（防「文字被 viewBox 静默裁掉」）', () => {
  /*
   * 这一组是补上一次事故的护栏：`axisFont` 从 8 涨到 14，而 `padLeft` 只从 30 涨到 34，
   * 于是 `text-anchor="end"` 的 `100%`（14px 下最宽 2.645em ≈ 37px）有 9px 伸到
   * viewBox 外面，`1` 被裁掉，页面上印出「00%」。构建成功、测试全绿、只有人眼看得出来。
   */

  test('纵轴最宽的读数装得进左边距（`100%` 不许被裁）', () => {
    const plan = planLine({ points: [{ x: 'a', y: 0.5 }] });
    expect(plan.yLabelFits).toBe(true);
    // 判据与组件里的锚点算式必须一致：右边缘在 plotLeft - yLabelGap。
    expect(plan.widestYLabel).toBeLessThanOrEqual(plotBudget());
  });

  test('纵轴读数按三套常见字体的**最宽**那套算，不是按乐观值', () => {
    // Segoe UI 34.10 / Arial 35.81 / Tahoma 36.60（14px，实测）。
    // 估计值必须 ≥ 三者最大，否则 Tahoma 用户就会看到少了 1 的「00%」。
    const widest = planLine({ points: [] }).widestYLabel;
    expect(widest).toBeGreaterThanOrEqual(36.6 - 0.5);
    // 也别估到荒谬：不该超过两倍。
    expect(widest).toBeLessThan(37 * 2);
  });

  test('左边距够宽：padLeft 去掉缝之后仍容得下 widestYLabel', () => {
    expect(LINE_GEOMETRY.padLeft - LINE_GEOMETRY.yLabelGap).toBeGreaterThanOrEqual(
      planLine({ points: [] }).widestYLabel,
    );
  });

  test('横轴首尾标签装得进绘图区，或者明确判为装不下（二选一，不许含糊）', () => {
    const long = planLine({
      points: [
        { x: '2026年7月31日 周五', y: 0 },
        { x: '2026年10月28日 周三', y: 1 },
      ],
    });
    // 两个 formatLong 标签在 270px 绘图区里必然装不下——判据必须说出来。
    expect(long.xLabelsFit).toBe(false);
    expect(long.xLabelGap).toBeLessThan(LINE_GEOMETRY.minXLabelGap);
    // 装不下时组件只画尾部那个，而完整范围仍在 firstLabel / lastLabel 里。
    expect(long.firstLabel).toBe('2026年7月31日 周五');
    expect(long.lastLabel).toBe('2026年10月28日 周三');
  });

  test('短标签装得下时判为 true（不许一律说装不下）', () => {
    const short = planLine({
      points: [
        { x: '7/31', y: 0 },
        { x: '10/28', y: 1 },
      ],
    });
    expect(short.xLabelsFit).toBe(true);
    expect(short.xLabelGap).toBeGreaterThan(0);
  });

  test('单点时没有「首尾相撞」问题，不报装不下', () => {
    const plan = planLine({ points: [{ x: '2026年10月28日 周三', y: 0.5 }] });
    expect(plan.showLastLabel).toBe(false);
    expect(plan.xLabelsFit).toBe(true);
  });

  test('柱底标签装得进柱位（含最宽的 `月/日`）', () => {
    const plan = planBars({ data: normalWeeks() });
    expect(plan.labelFits).toBe(true);
    expect(plan.widestLabel + BAR_GEOMETRY.labelGap).toBeLessThanOrEqual(plan.width / 12);
  });

  test('柱位按实际标签宽度加宽，不是死守 36（更宽的日期写法也不撞字）', () => {
    const narrow = planBars({ data: [{ label: '8/10', value: 5 }] });
    const wide = planBars({
      data: [
        { label: '2026年10月19日 周一', value: 5 },
        { label: '2026年10月26日 周一', value: 7 },
      ],
    });
    expect(wide.labelFits).toBe(true);
    expect(wide.width / 2).toBeGreaterThan(narrow.width);
    // 相邻两根柱子的中心距 = 柱位，必须大于标签宽度 + 缝。
    const spacing = wide.rows[1]!.centerX - wide.rows[0]!.centerX;
    expect(spacing).toBeGreaterThanOrEqual(wide.widestLabel + BAR_GEOMETRY.labelGap);
  });

  test('传入 `width` 只拉开柱距，不动字号与方块边长（宽屏铺满的前提）', () => {
    const natural = planBars({ data: normalWeeks() });
    const wide = planBars({ data: normalWeeks(), width: 672 });

    // 画布真的变宽了，而且宽到要求的那个数。
    expect(wide.width).toBe(672);
    expect(wide.width).toBeGreaterThan(natural.width);

    // 高度与基线一个单位都没动：加宽是横向的事，绝不能顺带把图拉高。
    expect(wide.height).toBe(natural.height);
    expect(wide.baseline).toBe(natural.baseline);

    // 柱距变大，但柱底标签与柱顶数值的**估算宽度**没变——12px 就是 12px。
    const wideSpacing = wide.rows[1]!.centerX - wide.rows[0]!.centerX;
    const naturalSpacing = natural.rows[1]!.centerX - natural.rows[0]!.centerX;
    expect(wideSpacing).toBeGreaterThan(naturalSpacing);
    expect(wide.widestLabel).toBeCloseTo(natural.widestLabel, 10);
    expect(wide.labelFits).toBe(true);
  });

  test('`width` 大于自然宽度时，标签仍不许伸出画布两边', () => {
    const plan = planBars({ data: normalWeeks(), width: 672 });
    const half = plan.widestLabel / 2;
    const first = plan.rows[0]!;
    const last = plan.rows[plan.rows.length - 1]!;
    expect(first.centerX - half).toBeGreaterThanOrEqual(0);
    expect(last.centerX + half).toBeLessThanOrEqual(plan.width);
    // 方块也在画布内。
    for (const square of plan.squares) {
      expect(square.x).toBeGreaterThanOrEqual(0);
      expect(square.x + BAR_GEOMETRY.square).toBeLessThanOrEqual(plan.width);
    }
  });

  test('`width` 只加宽不缩窄：更小的值、非法值一律回到自然宽度', () => {
    const natural = planBars({ data: normalWeeks() });
    for (const width of [0, -100, 1, 280, natural.width - 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(planBars({ data: normalWeeks(), width }).width).toBe(natural.width);
    }
  });

  test('柱顶真实数值也装得进柱位（`1400` 这种四位数不能撞邻居）', () => {
    const plan = planBars({ data: [{ label: '10/26', value: 1400 }] });
    expect(plan.showValues).toBe(true);
    expect(plan.widestValue).toBeGreaterThan(0);
    expect(plan.widestValue + BAR_GEOMETRY.labelGap).toBeLessThanOrEqual(plan.width);
  });

  test('最右侧柱顶数值不会伸出画布（五位、六位数也一样）', () => {
    for (const value of [41, 205, 1400, 12345, 123456]) {
      const plan = planBars({ data: normalWeeks().map((w, i) => (i === 11 ? { ...w, value } : w)) });
      const last = plan.rows[plan.rows.length - 1]!;
      const half = plan.widestValue / 2;
      // 居中锚点 + 数值标签：右边缘 = centerX + 半宽，必须留在画布内。
      expect(last.centerX + half).toBeLessThanOrEqual(plan.width);
      expect(last.centerX - half).toBeGreaterThanOrEqual(0);
    }
  });

  test('一行里最靠右的标签不会伸出画布右边', () => {
    const plan = planBars({ data: normalWeeks() });
    const last = plan.rows[plan.rows.length - 1]!;
    const half = plan.widestLabel / 2;
    // 居中锚点：右边缘 = centerX + 半宽。
    expect(last.centerX + half).toBeLessThanOrEqual(plan.width);
    // 第一个也不许伸出左边。
    expect(plan.rows[0]!.centerX - half).toBeGreaterThanOrEqual(0);
  });
});

/** 纵轴读数可用的水平预算：left edge 到 plotLeft 之间的净宽。 */
function plotBudget() {
  return LINE_GEOMETRY.padLeft - LINE_GEOMETRY.yLabelGap;
}

describe('chart.ts — advanceEm 宽度估计', () => {
  test('已知字符按实测值累加', () => {
    // 0.556 + 0.556 + 0.556 + 0.977 = 2.645em
    expect(advanceEm('100%', 14)).toBeCloseTo(2.645 * 14, 5);
    expect(advanceEm('1400', 11)).toBeCloseTo(4 * 0.556 * 11, 5);
  });

  test('比实测最宽的字体还宽或相等（宁可高估，不肯低估）', () => {
    // 14px 实测：Segoe UI 34.10 / Arial 35.81 / Tahoma 36.60
    expect(advanceEm('100%', 14)).toBeGreaterThanOrEqual(36.6);
  });

  test('CJK 按 1em 以上算，未登记字符也不当成 0 宽', () => {
    expect(advanceEm('年', 14)).toBeGreaterThanOrEqual(14);
    expect(advanceEm('\u{1F600}', 14)).toBeGreaterThan(0);
  });

  test('空串与纯空格不产生负值或 NaN', () => {
    expect(advanceEm('', 14)).toBe(0);
    expect(advanceEm('   ', 14)).toBe(0);
    expect(Number.isFinite(advanceEm('  /  ', 14))).toBe(true);
  });
});

describe('chart.ts — 模块纯净性与可读字号底线', () => {
  test('不含 node 依赖、不含框架依赖（与 stats.ts / ticks.ts 同一条铁律）', () => {
    const source = readFileSync(new URL('./chart.ts', import.meta.url), 'utf8');
    expect(source.includes("from 'node:")).toBe(false);
    expect(source.includes('astro')).toBe(false);
    expect(source.includes('react')).toBe(false);
  });

  test('轴文字字号：画布最多 1:1 渲染，所以字号即最小渲染像素', () => {
    // 这两个数是可读性底线，不是随手写的：12/14px 在最窄容器（320px 屏的内容区，
    // 约 280px）缩放后仍有 12.3px；改前的 8/9 用户单位在同样条件下只剩约 6px。
    // 改小之前请先算一遍 `fontSize × min(1, 280 / width)`。
    expect(BAR_GEOMETRY.axisFont).toBeGreaterThanOrEqual(12);
    expect(BAR_GEOMETRY.valueFont).toBeGreaterThanOrEqual(11);
    expect(LINE_GEOMETRY.axisFont).toBeGreaterThanOrEqual(12);
    // 折线图会缩放：字号乘以最窄容器下的缩放比后仍须 ≥ 11.5px。
    expect(LINE_GEOMETRY.axisFont * (280 / LINE_GEOMETRY.width)).toBeGreaterThanOrEqual(11.5);
  });
});
