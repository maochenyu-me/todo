import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, test } from 'vitest';

import { collectTags, entriesByTag, hasTagPage, tagPath, tagSegment } from './tags';
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
});

/**
 * ## 这条测试为什么这样写（别再改回「解码回原标签」那种同义反复）
 *
 * 旧版是 `decodeURIComponent(href.slice(...)) === tag`。那句话只证明了
 * `encodeURIComponent` / `decodeURIComponent` 互为逆函数——**与被点开的页面能不能
 * 落到磁盘上无关**，也正因为如此它放过了真实的 404：`encodeURIComponent('#号')`
 * 得到 `%23%E5%8F%B7`，解回 `#号` 完全成立，而 Astro 把产物写到 `%23号` 目录，
 * 于是链接 404。
 *
 * 真正的判据是「**href 解码一次之后，是不是那个产物目录名**」。为了不靠人肉推导
 * Astro 的编码规则，这里直接调 Astro 自己的 `getRouteGenerator`
 * （`astro/dist/core/routing/generator.js`，即 `sanitizeParams` 的调用点）
 * 来算出它会为 `params.tag` 生成什么 pathname，再用与
 * `dist/core/build/generate.js` 相同的方式（`encodeURI` → `fileURLToPath()` 的
 * 百分号解码）折成最终目录名。
 *
 * 这样只要 `tagSegment()` 与 Astro 的规则差一级，`decodeURI(href)` 就不再等于
 * Astro 的目录名，测试立刻红。文案里刻意不用 `decodeURIComponent` 解码整个 href：
 * 那会把 `/` 也一起吃掉。
 */
describe('tagPath 生成的链接必须命中 Astro 实际写出的产物目录', () => {
  /** `/tags/[tag]` 的 segments 形状。 */
  const SEGMENTS = [
    [{ content: 'tags', dynamic: false, spread: false }],
    [{ content: 'tag', dynamic: true, spread: false }],
  ];

  let generate: (params: Record<string, string>) => string;

  beforeAll(async () => {
    const mod = await import(
      pathToFileURL(resolve('node_modules/astro/dist/core/routing/generator.js')).href
    );
    generate = mod.getRouteGenerator(SEGMENTS, 'ignore');
  });

  /**
   * Astro 写盘时用的目录名：`generatePath()` 里 `encodeURI(pathname)` 交给
   * `getOutFolder()`，而 `fileURLToPath()` 会把 URL 路径的百分号转义解回去。
   * 两步互逆，所以结果就是 pathname 本身；这里**照样走一遍**，不直接假定，
   * 免得 Astro 哪天改了这两步的对称性。
   */
  /**
   * Astro 写盘时用的**目录名**（真实字节，已用构建产物核对）。
   *
   * `generatePath()` 里 `encodeURI(pathname)` 交给 `getOutFolder()`，写盘时
   * `fileURLToPath()` 再把 URL 路径的转义解回去。两步互逆 ⇒ 结果就是 pathname 本身。
   * 这里照样走一遍、不直接假定，免得 Astro 改了这两步的对称性而我们没发现。
   *
   * 注意用 `decodeURIComponent`（与 `segmentFromHref` 同一把尺子）：`decodeURI` 会
   * 保留 `%23`，那样两边都会「看起来对」，这条测试就退回成同义反复了。
   */
  function artifactDir(tagSegmentValue: string): string {
    const pathname = generate({ tag: tagSegmentValue });
    const encoded = encodeURI(pathname);
    return decodeURIComponent(encoded.slice('/tags/'.length));
  }

  /**
   * 浏览器/静态托管拿到 href 后解析出的**路径段**。
   *
   * 用 `decodeURIComponent` 而不是 `decodeURI`：这一步是整个修复的要害。
   * `decodeURI` **不会**解 `%23`、`%3F` 这类「保留字符」的转义，于是
   * `decodeURI('/tags/%23%E5%8F%B7')` 得到 `%23号`——看起来正好等于磁盘目录名，
   * 于是旧的错误实现也能「通过」这种检查（假绿）。真实托管是把段完整解一次，
   * `%23` 真的变成 `#`，去找 `#号` 目录，404。
   */
  function segmentFromHref(href: string): string {
    const start = href.indexOf('/tags/') + '/tags/'.length;
    return decodeURIComponent(href.slice(start));
  }

  const CASES = [
    '工作',
    '我的 计划',
    'C++ & Rust',
    'C#',
    '#号',
    'a?b',
    'a/b',
    'a b',
    'x&y=z',
    '100%',
    'a%2Fb',
    '工作 & C#',
  ];

  test('每个标签的 href 解码一次后等于 Astro 的产物目录名', () => {
    for (const tag of CASES) {
      const href = tagPath(tag, '/');
      expect({ tag, dir: segmentFromHref(href) }).toEqual({
        tag,
        dir: artifactDir(tagSegment(tag)),
      });
    }
  });

  test('getStaticPaths 用的段与 href 用的段是同一个（否则路由名与链接必然分叉）', () => {
    for (const tag of CASES) {
      const fromHref = segmentFromHref(tagPath(tag, '/'));
      // Astro 拿 getStaticPaths 的 `params.tag` 过 `sanitizeParams`，产出 pathname；
      // 它与 href 解出来的段相等，产物目录才会是同一个。
      const fromParams = generate({ tag: tagSegment(tag) }).slice('/tags/'.length);
      expect(fromParams, `标签 ${tag} 的 params 段与 href 段必须一致`).toBe(fromHref);
    }
  });

  test('含 # / ? 的标签不再落进「编码差一级」的坑（回归护栏）', () => {
    // 旧实现直接把 `encodeURIComponent(tag)` 当路径段。对 `#`/`?` 这类字符，
    // `encodeURIComponent` 与 `tagSegment` 给出的段**恰好相同**，所以差别不在段本身，
    // 而在旧版 href 只过了一次 `encodeURIComponent`、没有再过 `encodeURI`：
    // 于是 `decodeURI(href)` 得到的是原始标签，而磁盘上是 `tagSegment` 的结果。
    // 这条护栏钉住的正是「href 解一次必须落在 tagSegment 的产物上，而不是原始标签上」。
    for (const tag of ['C#', '#号', 'a?b']) {
      const dir = segmentFromHref(tagPath(tag, '/'));
      expect({ tag, dir }).toEqual({ tag, dir: tagSegment(tag) });
      // 原始标签绝不能等于产物目录名，否则说明编码根本没做。
      expect(dir).not.toBe(tag);
    }
  });

  test('a/b 不再产生嵌套路径（否则 [tag] 匹配不上，构建会抛 Missing parameter）', () => {
    const href = tagPath('a/b', '/');
    // href 里不能出现多余的 `/`：`/tags/a/b` 会让 Astro 报 Missing parameter: tag。
    expect(href).toBe('/tags/a%252Fb');
    expect(href.split('/').filter(Boolean)).toHaveLength(2); // ['tags', 'a%252Fb']
  });
});

describe('hasTagPage', () => {
  test('含 % 的标签不建页（Astro 的路由层不接受，实测能整站构建失败）', () => {
    expect(hasTagPage('100%')).toBe(false);
    expect(hasTagPage('pct % sign')).toBe(false);
    expect(hasTagPage('%')).toBe(false);
  });

  test('正常标签（含 # / ? 空格 中文）都建页', () => {
    for (const tag of ['工作', 'C#', '#号', 'a?b', 'a/b', '我的 计划', 'C++ & Rust', 'x&y=z']) {
      expect({ tag, ok: hasTagPage(tag) }).toEqual({ tag, ok: true });
    }
  });
});
