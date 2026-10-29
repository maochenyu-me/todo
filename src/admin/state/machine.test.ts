import { describe, expect, test } from 'vitest';

import type { DayEntry } from '@/lib/types';

import { adminReducer, type AdminAction, type AdminState } from './machine';

/**
 * 后台状态机（`adminReducer`）的测试。
 *
 * 这里盯的不是"每个分支返回了什么"，而是**结构上不可能出现的组合**：
 * - `disconnected` 里根本没有 `days` 字段，所以"没连上却显示数据"写不出来；
 * - `TOKEN_FAIL` / `PUBLISH_FAIL` 停在 `ready`，`days` 与 `dirty` 是原对象带过来的，
 *   所以"失败后改动丢了"需要 reducer 主动去清空才会发生（测试直接比较对象引用）；
 * - 四个状态 × 十个动作的每个组合都要返回一个合法状态（末尾的穷举用例）。
 */

const DATE = '2026-10-28';

/** 一天的样本数据。 */
function sampleEntry(dateKey: string, title = '把归档脚本的时区写死'): DayEntry {
  return {
    date: dateKey,
    tasks: [
      {
        id: 'k3f9x2',
        title,
        done: false,
        completedAt: null,
        order: 0,
        priority: 1,
        tags: ['开发'],
        note: '',
        timeBlock: null,
        createdAt: `${dateKey}T09:00:00+08:00`,
        updatedAt: `${dateKey}T09:00:00+08:00`,
      },
    ],
  };
}

/** brief 里的 `sampleDays()`：一天的合法数据。 */
function sampleDays(): Record<string, DayEntry> {
  return { [DATE]: sampleEntry(DATE) };
}

/** brief 里的 `readyState()`：已连接、选中当天、且当天有未保存改动。 */
function readyState(): AdminState & { status: 'ready' } {
  return {
    status: 'ready',
    days: sampleDays(),
    selected: DATE,
    dirty: new Set([DATE]),
    tokenExpiresAt: null,
  };
}

describe('adminReducer', () => {
  // --- brief 的四条用例，逐字保留 ---

  test('locked 输对密码进入 disconnected 且不含 day 数据', () => {
    const s = adminReducer({ status: 'locked' }, { type: 'UNLOCK_OK' });
    expect(s.status).toBe('disconnected');
    expect('days' in s).toBe(false); // Review Focus: 无 token 不见数据
  });

  test('token 失效时改动保留', () => {
    const before: AdminState = {
      status: 'ready',
      days: sampleDays(),
      selected: '2026-10-28',
      dirty: new Set(['2026-10-28']),
      tokenExpiresAt: null,
    };
    const after = adminReducer(before, { type: 'TOKEN_FAIL', message: '令牌已失效或被撤销，请重新输入' });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') throw new Error('unreachable');
    expect(after.dirty.has('2026-10-28')).toBe(true);
    expect(after.error).toContain('令牌已失效');
  });

  test('PUBLISH_FAIL 回到 ready 且 days 与 dirty 原样保留', () => {
    const before: AdminState = {
      status: 'publishing',
      days: sampleDays(),
      selected: '2026-10-28',
      dirty: new Set(['2026-10-28']),
      tokenExpiresAt: null,
    };
    const after = adminReducer(before, { type: 'PUBLISH_FAIL', message: '网络中断，改动还在，可以重试' });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') throw new Error('unreachable');
    expect(after.days['2026-10-28']).toBeDefined();
    expect(after.dirty.size).toBe(1);
  });

  test('CLEAR_TOKEN 清空数据回 disconnected', () => {
    const s = adminReducer(readyState(), { type: 'CLEAR_TOKEN' });
    expect(s.status).toBe('disconnected');
    expect('days' in s).toBe(false);
  });

  // --- 本任务补充的用例 ---

  test('UNLOCK_FAIL 留在 locked 并带上中文错误', () => {
    const s = adminReducer({ status: 'locked' }, { type: 'UNLOCK_FAIL', message: '口令不正确' });
    expect(s.status).toBe('locked');
    if (s.status !== 'locked') throw new Error('unreachable');
    expect(s.error).toBe('口令不正确');
    expect('days' in s).toBe(false);
  });

  test('TOKEN_OK 进入 ready：写入 days、清空 dirty、记下令牌过期时间', () => {
    const s = adminReducer(
      { status: 'disconnected', tokenExpiresAt: null },
      {
        type: 'TOKEN_OK',
        days: sampleDays(),
        selected: DATE,
        tokenExpiresAt: '2027-01-01T00:00:00Z',
      },
    );
    expect(s.status).toBe('ready');
    if (s.status !== 'ready') throw new Error('unreachable');
    expect(Object.keys(s.days)).toEqual([DATE]);
    expect(s.selected).toBe(DATE);
    // 刚刚从仓库读回来的数据，本地一处改动都没有。
    expect(s.dirty.size).toBe(0);
    expect(s.tokenExpiresAt).toBe('2027-01-01T00:00:00Z');
    expect(s.error).toBeUndefined();
  });

  test('PUBLISH_START 把 days / dirty / selected / tokenExpiresAt 一并带进 publishing', () => {
    const before = readyState();
    const started = adminReducer(before, { type: 'PUBLISH_START' });
    expect(started.status).toBe('publishing');
    if (started.status !== 'publishing') throw new Error('unreachable');
    // 逐项比较加上对象同一性：发布失败时要原样恢复，必须是同一份数据。
    expect(started.days).toBe(before.days);
    expect(started.dirty).toBe(before.dirty);
    expect(started.selected).toBe(before.selected);
    expect(started.tokenExpiresAt).toBe(before.tokenExpiresAt);
  });

  test('PUBLISH_OK 清空 dirty 回到 ready，数据留着', () => {
    const started = adminReducer(readyState(), { type: 'PUBLISH_START' });
    const done = adminReducer(started, { type: 'PUBLISH_OK' });
    expect(done.status).toBe('ready');
    if (done.status !== 'ready') throw new Error('unreachable');
    expect(done.days[DATE]).toBeDefined();
    expect(done.dirty.size).toBe(0);
    expect(done.error).toBeUndefined();
  });

  test('SELECT_DAY 只改 selected，不碰 dirty', () => {
    const before = readyState();
    const other = '2026-10-27';
    const after = adminReducer(before, { type: 'SELECT_DAY', date: other });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') throw new Error('unreachable');
    expect(after.selected).toBe(other);
    expect([...after.dirty]).toEqual([DATE]);
    expect(after.days).toBe(before.days);
  });

  test('PATCH_DAY 标记 dirty，且不改动上一份 state（不可变更新）', () => {
    const before = readyState(); // dirty 里已经有 DATE
    const prevDays = before.days;
    const prevDirty = before.dirty;
    const other = '2026-10-29';
    const patched = sampleEntry(other, '换一份内容');

    const after = adminReducer(before, { type: 'PATCH_DAY', day: patched });

    expect(after.status).toBe('ready');
    if (after.status !== 'ready') throw new Error('unreachable');
    // 新的日期被写进 days，并被标记为有改动
    expect(after.days[other]).toBe(patched);
    expect(after.dirty.has(other)).toBe(true);
    // 上一份 state 一个字段都没被动过（同一性 + 内容）
    expect(before.days).toBe(prevDays);
    expect(before.dirty).toBe(prevDirty);
    expect(Object.keys(before.days)).toEqual([DATE]);
    expect([...before.dirty]).toEqual([DATE]);
    // 新对象是新的，不是就地改写
    expect(after.days).not.toBe(prevDays);
    expect(after.dirty).not.toBe(prevDirty);
  });

  test('PATCH_DAY 替换同一天时覆盖旧的条目', () => {
    const before = readyState();
    const updated = sampleEntry(DATE, '改过的标题');
    const after = adminReducer(before, { type: 'PATCH_DAY', day: updated });
    if (after.status !== 'ready') throw new Error('unreachable');
    expect(after.days[DATE]).toBe(updated);
    expect(after.dirty.size).toBe(1); // 同一天重复改，dirty 不重复计数
  });

  test('publishing 下 CLEAR_TOKEN 也能干净回到 disconnected', () => {
    const publishing = adminReducer(readyState(), { type: 'PUBLISH_START' });
    const s = adminReducer(publishing, { type: 'CLEAR_TOKEN' });
    expect(s.status).toBe('disconnected');
    expect('days' in s).toBe(false);
    if (s.status !== 'disconnected') throw new Error('unreachable');
    expect(s.tokenExpiresAt).toBeNull();
  });

  test('publishing 下的 publish 类动作不会把状态搅乱（重入视为无操作）', () => {
    const publishing = adminReducer(readyState(), { type: 'PUBLISH_START' });
    expect(adminReducer(publishing, { type: 'PUBLISH_START' })).toBe(publishing);
    // 未发布就不该有"发布成功"：待发布中的 PUBLISH_OK 才收尾
    const done = adminReducer(publishing, { type: 'PUBLISH_OK' });
    expect(done.status).toBe('ready');
  });

  test('穷举：4 个状态 × 全部动作，结果永远是合法状态', () => {
    const states: AdminState[] = [
      { status: 'locked' },
      { status: 'disconnected', tokenExpiresAt: null },
      readyState(),
      { status: 'publishing', days: sampleDays(), selected: DATE, dirty: new Set([DATE]), tokenExpiresAt: null },
    ];
    const actions: AdminAction[] = [
      { type: 'UNLOCK_OK' },
      { type: 'UNLOCK_FAIL', message: 'x' },
      { type: 'TOKEN_OK', days: sampleDays(), selected: DATE, tokenExpiresAt: null },
      { type: 'TOKEN_FAIL', message: 'x' },
      { type: 'CLEAR_TOKEN' },
      { type: 'SELECT_DAY', date: DATE },
      { type: 'PATCH_DAY', day: sampleEntry(DATE) },
      { type: 'PUBLISH_START' },
      { type: 'PUBLISH_OK' },
      { type: 'PUBLISH_FAIL', message: 'x' },
    ];

    for (const state of states) {
      for (const action of actions) {
        const next = adminReducer(state, action);
        const where = `${state.status} + ${action.type}`;
        // 只有 ready / publishing 能携带数据；别的状态连字段都没有
        if (next.status === 'locked' || next.status === 'disconnected') {
          expect('days' in next, where).toBe(false);
          expect('dirty' in next, where).toBe(false);
        } else {
          expect(Array.isArray([...next.dirty]), where).toBe(true);
          expect(next.selected, where).toBeTypeOf('string');
          // dirty 永远是 days 键的子集：标记了改动却没有那天数据 = 状态坏掉
          for (const key of next.dirty) expect(Object.keys(next.days), where).toContain(key);
        }
        // publishing 是"正在提交"，不该带错误（错误只会出现在 ready / disconnected / locked）
        if (next.status === 'publishing') expect('error' in next, where).toBe(false);
      }
    }
  });

  test('未知动作不会被静默吞掉（穷举检查兜底）', () => {
    const bogus = { type: 'NOT_A_REAL_ACTION' } as unknown as AdminAction;
    expect(() => adminReducer(readyState(), bogus)).toThrow(/未知/);
  });
});
