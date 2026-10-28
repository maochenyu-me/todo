import { describe, expect, test } from 'vitest';

import { capTasks } from './paging';
import type { Task } from './types';

function tasks(n: number): Task[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `任务 ${i}`,
    done: false,
    completedAt: null,
    order: i,
    priority: 1 as const,
    tags: [],
    note: '',
    timeBlock: null,
    createdAt: '2026-10-28T01:00:00.000Z',
    updatedAt: '2026-10-28T01:00:00.000Z',
  }));
}

describe('capTasks', () => {
  test('未超上限时全部保留，无隐藏计数', () => {
    const r = capTasks(tasks(3), 200);

    expect(r.shown).toHaveLength(3);
    expect(r.hidden).toBe(0);
    expect(r.cap).toBe(200);
  });

  test('刚好等于上限时不算超', () => {
    const r = capTasks(tasks(200), 200);

    expect(r.shown).toHaveLength(200);
    expect(r.hidden).toBe(0);
  });

  test('超上限时只留前 N 条并报出隐藏条数', () => {
    const r = capTasks(tasks(205), 200);

    expect(r.shown).toHaveLength(200);
    expect(r.hidden).toBe(5);
    expect(r.cap).toBe(200);
    expect(r.shown[0]?.id).toBe('t0');
    expect(r.shown.at(-1)?.id).toBe('t199');
  });

  test('上限为 0 视为「不限」，而不是「一条都不显示」', () => {
    // 配置成 0 的用意几乎不可能是「全站每天渲染成空页」——那比失去护栏更糟。
    // 该值只在防止病态文件炸页面时有意义，非正数即视为关掉这个护栏。
    const r = capTasks(tasks(7), 0);

    expect(r.shown).toHaveLength(7);
    expect(r.hidden).toBe(0);
    expect(r.cap).toBeNull();
  });

  test('负数与 NaN 同样视为「不限」', () => {
    for (const bad of [-1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const r = capTasks(tasks(5), bad);
      expect(r.shown).toHaveLength(5);
      expect(r.hidden).toBe(0);
      expect(r.cap).toBeNull();
    }
  });

  test('正的上限即「不限」，不会隐藏任何一条', () => {
    const r = capTasks(tasks(5), Number.POSITIVE_INFINITY);

    expect(r.shown).toHaveLength(5);
    expect(r.hidden).toBe(0);
    expect(r.cap).toBeNull();
  });

  test('小数上限向下取整，隐藏计数与渲染条数相加等于总数', () => {
    const r = capTasks(tasks(10), 3.9);

    expect(r.shown).toHaveLength(3);
    expect(r.hidden).toBe(7);
    expect(r.cap).toBe(3);
  });

  test('空数组不会出现负的隐藏计数', () => {
    expect(capTasks([], 200)).toEqual({ shown: [], hidden: 0, cap: 200 });
  });

  test('不修改入参数组', () => {
    const input = tasks(5);
    capTasks(input, 2);

    expect(input).toHaveLength(5);
  });

  test('有上限时 hidden 恒为正（调用方据此决定是否显示提示，绝不会读到 0）', () => {
    for (const cap of [1, 5, 199, 200]) {
      const r = capTasks(tasks(205), cap);
      expect(r.hidden).toBeGreaterThan(0);
      expect(r.cap).toBe(cap);
    }
  });
});
