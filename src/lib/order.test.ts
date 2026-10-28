import { describe, expect, test } from 'vitest';

import { orderTasks } from './order';
import type { Task, TimeBlock } from './types';

function taskOf(id: string, order: number, timeBlock: TimeBlock | null): Task {
  return {
    id,
    title: `任务 ${id}`,
    done: false,
    completedAt: null,
    order,
    priority: 1,
    tags: [],
    note: '',
    timeBlock,
    createdAt: '2026-10-28T01:00:00.000Z',
    updatedAt: '2026-10-28T01:00:00.000Z',
  };
}

/** 无时间段的任务，只需 `order` 决定位置。 */
const noTime = (id: string, order: number) => taskOf(id, order, null);

/** 有时间的任务，`timeBlock.start` 决定位置。 */
const withTime = (id: string, start: string, end: string, order = 0) =>
  taskOf(id, order, { start, end });

const ids = (tasks: Task[]) => tasks.map((task) => task.id);

describe('orderTasks', () => {
  test('有时间段的按开始时间升序在前', () => {
    const r = orderTasks([
      noTime('b', 0),
      withTime('a', '10:00', '11:00'),
      withTime('c', '09:00', '09:30'),
    ]);
    expect(ids(r.scheduled)).toEqual(['c', 'a']);
    expect(ids(r.unscheduled)).toEqual(['b']);
  });

  test('同一时间段按 order 升序', () => {
    const r = orderTasks([
      withTime('p', '09:00', '10:00', 3),
      withTime('q', '09:00', '10:00', 1),
      withTime('r', '09:00', '10:00', 2),
    ]);
    expect(ids(r.scheduled)).toEqual(['q', 'r', 'p']);
  });

  test('无时间段的按 order 升序', () => {
    expect(ids(orderTasks([noTime('x', 2), noTime('y', 0)]).unscheduled)).toEqual(['y', 'x']);
  });

  test('两组各自排序，互不串味', () => {
    const r = orderTasks([
      noTime('n0', 5),
      withTime('t2', '14:00', '15:00'),
      noTime('n1', 1),
      withTime('t1', '08:00', '09:00'),
    ]);
    expect(ids(r.scheduled)).toEqual(['t1', 't2']);
    expect(ids(r.unscheduled)).toEqual(['n1', 'n0']);
  });

  test('不修改入参数组', () => {
    const input = [
      noTime('a', 1),
      withTime('b', '11:00', '12:00'),
      noTime('c', 0),
      withTime('d', '08:00', '09:00'),
    ];
    const before = ids(input);
    orderTasks(input);
    expect(ids(input)).toEqual(before);
  });

  test('空数组返回两个空数组', () => {
    expect(orderTasks([])).toEqual({ scheduled: [], unscheduled: [] });
  });

  test('全部无时间段时 scheduled 为空', () => {
    const r = orderTasks([noTime('a', 0), noTime('b', 1)]);
    expect(r.scheduled).toEqual([]);
    expect(ids(r.unscheduled)).toEqual(['a', 'b']);
  });

  test('全部有时间段时 unscheduled 为空', () => {
    const r = orderTasks([withTime('a', '07:00', '08:00'), withTime('b', '07:30', '08:30')]);
    expect(ids(r.scheduled)).toEqual(['a', 'b']);
    expect(r.unscheduled).toEqual([]);
  });
});
