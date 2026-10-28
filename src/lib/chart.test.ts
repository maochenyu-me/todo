import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { BAR_GEOMETRY, LINE_GEOMETRY, planBars, planLine } from './chart';

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

    expect(tall.width).toBe(BAR_GEOMETRY.slot);
    // 12 根柱子 ⇒ 12 个柱位。
    expect(planBars({ data: normalWeeks() }).width).toBe(12 * BAR_GEOMETRY.slot);
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
