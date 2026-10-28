import { describe, expect, test } from 'vitest';

import { collectTags, entriesByTag, tagPath } from './tags';
import type { DayEntry, Task } from './types';

function taskOf(id: string, tags: string[], done = false): Task {
  return {
    id,
    title: `任务 ${id}`,
    done,
    completedAt: done ? '2026-10-28T01:00:00.000Z' : null,
    order: 0,
    priority: 1,
    tags,
    note: '',
    timeBlock: null,
    createdAt: '2026-10-28T01:00:00.000Z',
    updatedAt: '2026-10-28T01:00:00.000Z',
  };
}

function dayOf(date: string, ...tasks: Task[]): DayEntry {
  return { date, tasks };
}

const OPTS = { maxVisible: 30, minCount: 1 };

describe('collectTags', () => {
  test('空数据返回空数组', () => {
    expect(collectTags([], { maxVisible: 30, minCount: 1 })).toEqual([]);
  });

  test('统计每个标签被多少条任务用过', () => {
    const entries = [
      dayOf('2026-10-28', taskOf('a', ['工作', '读书']), taskOf('b', ['工作'])),
      dayOf('2026-10-27', taskOf('c', ['工作'])),
    ];
    expect(collectTags(entries, OPTS)).toEqual([
      { tag: '工作', count: 3 },
      { tag: '读书', count: 1 },
    ]);
  });

  test('少于 minCount 的标签被过滤', () => {
    const entries = [
      dayOf('2026-10-28', taskOf('a', ['常用', '独一次'])),
      dayOf('2026-10-27', taskOf('b', ['常用'])),
    ];
    expect(collectTags(entries, { maxVisible: 30, minCount: 2 })).toEqual([
      { tag: '常用', count: 2 },
    ]);
    // minCount 为 1 时同一条数据里两个标签都在。
    expect(collectTags(entries, { maxVisible: 30, minCount: 1 })).toEqual([
      { tag: '常用', count: 2 },
      { tag: '独一次', count: 1 },
    ]);
  });

  test('按 count 降序且截断到 maxVisible', () => {
    const entries = [
      dayOf(
        '2026-10-28',
        taskOf('a', ['甲', '乙', '丙']),
        taskOf('b', ['甲', '乙']),
        taskOf('c', ['甲']),
      ),
    ];
    expect(collectTags(entries, { maxVisible: 2, minCount: 1 })).toEqual([
      { tag: '甲', count: 3 },
      { tag: '乙', count: 2 },
    ]);
    expect(collectTags(entries, { maxVisible: 30, minCount: 1 }).map((t) => t.tag)).toEqual([
      '甲',
      '乙',
      '丙',
    ]);
  });

  test('count 相同时按标签升序，且不依赖 locale', () => {
    // 码点序：'B'(0x42) < 'a'(0x61)。localeCompare 在部分 locale 下会把 'a' 排在 'B' 前，
    // 那会让同一份数据在不同机器上排出的顺序不同——构建结果必须可复现。
    const entries = [dayOf('2026-10-28', taskOf('a', ['a', 'B', '工作']))];
    expect(collectTags(entries, OPTS).map((t) => t.tag)).toEqual(['B', 'a', '工作']);
  });

  test('同一条任务里重复写同一个标签只算一次', () => {
    const entries = [dayOf('2026-10-28', taskOf('a', ['工作', '工作', '工作']))];
    expect(collectTags(entries, OPTS)).toEqual([{ tag: '工作', count: 1 }]);
  });

  test('空白标签被忽略：它不该生成一个 /tags/ 这样的页面', () => {
    const entries = [dayOf('2026-10-28', taskOf('a', ['', '   ', '工作']))];
    expect(collectTags(entries, OPTS)).toEqual([{ tag: '工作', count: 1 }]);
  });

  test('maxVisible 非正数或非有限值时视为不截断', () => {
    const entries = [dayOf('2026-10-28', taskOf('a', ['甲', '乙', '丙']))];
    for (const maxVisible of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(collectTags(entries, { maxVisible, minCount: 1 })).toHaveLength(3);
    }
  });

  test('不修改入参：条目、任务与标签数组都原样', () => {
    const entries = [
      dayOf('2026-10-28', taskOf('a', ['乙', '甲'])),
      dayOf('2026-10-27', taskOf('b', ['甲'])),
    ];
    const before = JSON.stringify(entries);
    collectTags(entries, { maxVisible: 1, minCount: 1 });
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe('entriesByTag', () => {
  test('按日期倒序，最新的一天在最前', () => {
    const entries = [
      dayOf('2026-09-01', taskOf('a', ['工作'])),
      dayOf('2026-10-28', taskOf('b', ['工作'])),
      dayOf('2026-10-02', taskOf('c', ['工作'])),
    ];
    expect(entriesByTag(entries, '工作').map((d) => d.date)).toEqual([
      '2026-10-28',
      '2026-10-02',
      '2026-09-01',
    ]);
  });

  test('只保留带该标签的任务，且保持当天原有顺序', () => {
    const entries = [
      dayOf(
        '2026-10-28',
        taskOf('z', ['其它']),
        taskOf('y', ['工作', '读书']),
        taskOf('x', ['工作']),
      ),
    ];
    const days = entriesByTag(entries, '工作');
    expect(days).toHaveLength(1);
    expect(days[0]?.date).toBe('2026-10-28');
    expect(days[0]?.tasks.map((t) => t.id)).toEqual(['y', 'x']);
  });

  test('没有该标签时返回空数组', () => {
    const entries = [dayOf('2026-10-28', taskOf('a', ['工作']))];
    expect(entriesByTag(entries, '读书')).toEqual([]);
    expect(entriesByTag([], '工作')).toEqual([]);
  });

  test('不修改入参', () => {
    const entries = [
      dayOf('2026-10-27', taskOf('b', ['工作'])),
      dayOf('2026-10-28', taskOf('a', ['工作'])),
    ];
    const before = JSON.stringify(entries);
    entriesByTag(entries, '工作');
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe('tagPath', () => {
  test('中文与空格都编码，普通标签保持可读', () => {
    expect(tagPath('work', '/')).toBe('/tags/work');
    expect(tagPath('工作', '/')).toBe('/tags/%E5%B7%A5%E4%BD%9C');
    expect(tagPath('我的 计划', '/')).toBe('/tags/%E6%88%91%E7%9A%84%20%E8%AE%A1%E5%88%92');
  });

  test('base 前缀照样生效（编码要在 withBase 之前做）', () => {
    expect(tagPath('工作', '/TODO/')).toBe('/TODO/tags/%E5%B7%A5%E4%BD%9C');
  });

  test('编码结果能原样解回标签本身', () => {
    for (const tag of ['工作', '我的 计划', 'a/b', 'C++ & Rust', '#号']) {
      const href = tagPath(tag, '/');
      expect(decodeURIComponent(href.slice('/tags/'.length))).toBe(tag);
    }
  });
});
