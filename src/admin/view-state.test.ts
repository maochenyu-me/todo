import { describe, expect, test } from 'vitest';

import { deriveView, type Phase, type View } from './view-state';

/**
 * `deriveView` 是后台骨架里唯一一条行为规则：`dirty` 只在 `ready` 之上派生出一个视图，
 * 其余状态完全不受它影响。所以这里把两个入参的**全部组合**都铺一遍，
 * 而不是只挑两个「典型」用例。
 */
describe('deriveView', () => {
  /** 两个入参的全部组合：四个状态 × `dirty` 的真假。 */
  const cases: Array<[Phase, boolean, View]> = [
    // `ready` 是唯一会因 `dirty` 改变结果的相位
    ['ready', true, 'dirty'],
    ['ready', false, 'ready'],
    // 其余三个相位：`dirty` 传什么都原样返回
    ['locked', true, 'locked'],
    ['locked', false, 'locked'],
    ['disconnected', true, 'disconnected'],
    ['disconnected', false, 'disconnected'],
    ['publishing', true, 'publishing'],
    ['publishing', false, 'publishing'],
  ];

  test.each(cases)('phase=%s dirty=%s → %s', (phase, dirty, expected) => {
    expect(deriveView(phase, dirty)).toBe(expected);
  });

  test('穷举覆盖：4 个相位 × dirty 的 2 种取值，一条都不能漏', () => {
    const phases: Phase[] = ['locked', 'disconnected', 'ready', 'publishing'];
    expect(cases).toHaveLength(phases.length * 2);
    for (const phase of phases) {
      for (const dirty of [true, false]) {
        expect(cases.some(([p, d]) => p === phase && d === dirty)).toBe(true);
      }
    }
  });

  test('`ready` 是唯一受 dirty 影响的状态', () => {
    const phases: Phase[] = ['locked', 'disconnected', 'ready', 'publishing'];
    const affected = phases.filter((phase) => deriveView(phase, true) !== deriveView(phase, false));
    expect(affected).toEqual(['ready']);
  });

  test('`dirty` 视图只在就绪之上出现，永远不会从别的状态漏出来', () => {
    const phases: Phase[] = ['locked', 'disconnected', 'ready', 'publishing'];
    for (const phase of phases) {
      const views = [deriveView(phase, true), deriveView(phase, false)];
      for (const view of views) {
        if (view === 'dirty') expect(phase).toBe('ready');
      }
    }
  });
});
