/**
 * 后台状态机的「派生视图」计算——整个后台骨架里唯一一条行为规则，
 * 所以它是纯函数、单独一个文件，配一份穷举组合的测试（`view-state.test.ts`）。
 *
 * ## 为什么要派生而不是再存一个状态
 *
 * 状态机只有四个状态：`locked`（要口令）/ `disconnected`（没连上 GitHub）/
 * `ready`（可以编辑）/ `publishing`（正在提交）。`dirty`（有未保存改动）**不是第五个状态**，
 * 而是 `ready` 之上的派生条件：只有在就绪之上才谈得上「改过没改」。
 *
 * 把 `view` 算出来而不是存起来，就从根上排除了「未就绪但有未保存改动」这种非法组合——
 * 那种状态没有地方可以被写入，因为它是算出来的。
 */

/** 状态机的四个状态。 */
export type Phase = 'locked' | 'disconnected' | 'ready' | 'publishing';

/** 实际渲染的视图 = 状态机状态 + `ready` 下的派生条件 `dirty`。 */
export type View = Phase | 'dirty';

/**
 * 由状态机状态与 `dirty` 算出实际渲染的视图。
 *
 * `dirty` 只在 `ready` 下有意义：其余三个状态无论传什么都不影响结果。
 */
export function deriveView(phase: Phase, dirty: boolean): View {
  return phase === 'ready' && dirty ? 'dirty' : phase;
}
