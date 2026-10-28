import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, test } from 'vitest';

import {
  collectTags,
  entriesByTag,
  hasTagPage,
  tagPath,
  tagRouteParams,
  tagSegment,
} from './tags';
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
 * ## 这组测试为什么这样写（别再改回「解码回原标签」那种同义反复）
 *
 * 旧版是 `decodeURIComponent(href.slice(...)) === tag`。那句话只证明了
 * `encodeURIComponent` / `decodeURIComponent` 互为逆函数——**与被点开的页面能不能
 * 落到磁盘上无关**，也正因为如此它放过了真实的 404。
 *
 * 修好之后又踩到第二个坑，一并记在这里：**「params → pathname → params」的往返本身
 * 也是盲的**。`getParams()` 只是拿正则去切 pathname 的原始捕获组、不做任何解码，
 * 所以只要 `getStaticPaths` 和 href 用的是同一个（哪怕是错的）变换，往返必然成立。
 * 实测：把 `tagSegment` 换成 `encodeURIComponent`（过度转义），往返断言**全绿**，
 * 而真实构建报 `NoMatchingStaticPathFound`、`dist/tags/` 根本不产出。
 *
 * 真正能证伪的判据只有一条——**与 Astro 对「原始标签」的处理对齐**：
 *
 * ```
 * tagSegment(原始标签) === Astro 为 params: { tag: 原始标签 } 生成的路径段
 * ```
 *
 * 右边是 `sanitizeParams` 的唯一权威输出。这条断言在「过度转义」和「转义不足」
 * 两个方向都会红（实测 `encodeURIComponent` 让 12 个用例里 10 个变红）。
 * 唯一的刻意偏离是 `/`：`sanitizeParams` 不管它，而 `a/b` 会让路由变成两段、
 * 构建硬失败，所以 `tagSegment` 必须额外把它转成 `%2F`——这一条例外单独断言。
 */
describe('tagSegment 必须与 Astro 对同一个标签的产物段一致', () => {
  /** `/tags/[tag]` 的 segments 形状。 */
  const SEGMENTS = [
    [{ content: 'tags', dynamic: false, spread: false }],
    [{ content: 'tag', dynamic: true, spread: false }],
  ];

  /** Astro 的路由生成器；给**原始**标签，返回它要落盘的 pathname。 */
  let generate: (params: Record<string, string>) => string;

  beforeAll(async () => {
    const mod = await import(
      pathToFileURL(resolve('node_modules/astro/dist/core/routing/generator.js')).href
    );
    generate = mod.getRouteGenerator(SEGMENTS, 'ignore');
  });

  /**
   * Astro 为**原始标签**生成的产物段（`sanitizeParams` 的输出）。
   *
   * 写盘时 `encodeURI(pathname)` 与 `fileURLToPath()` 的百分号解码互为逆运算，
   * 所以落到磁盘上的目录名就是这一段的字面值：`C#` → `C%23`、`工作` → `工作`。
   */
  function astroSegmentForRaw(rawTag: string): string {
    return generate({ tag: rawTag }).slice('/tags/'.length);
  }

  const CASES = [
    '工作',
    '我的 计划',
    'C++ & Rust',
    'C#',
    '#号',
    'a?b',
    'a b',
    'x&y=z',
    '100%',
    'a%2Fb',
    '工作 & C#',
  ];

  test('每个标签：tagSegment 的结果等于 Astro 为该标签生成的产物段', () => {
    for (const tag of CASES) {
      expect(tagSegment(tag), `标签 ${tag}`).toBe(astroSegmentForRaw(tag));
    }
  });

  test('过度转义会红：encodeURIComponent 与 Astro 的段不一致（反证本断言非空）', () => {
    // 这条不是为了测 encodeURIComponent，而是给上一条做**反证**：
    // 若把 tagSegment 换成 encodeURIComponent，上一条会红——这里把「为什么红」写死。
    const overEscaped = CASES.filter((tag) => encodeURIComponent(tag) !== astroSegmentForRaw(tag));
    expect(overEscaped.length).toBeGreaterThan(0);
    // 具体到最要命的几个：中文、空格、& 都会被过度转义。
    for (const tag of ['工作', '我的 计划', 'C++ & Rust']) {
      expect(encodeURIComponent(tag), `标签 ${tag} 应被过度转义`).not.toBe(astroSegmentForRaw(tag));
    }
  });

  test('/ 是唯一刻意偏离 Astro 的地方：Astro 不转它，我们转成 %2F', () => {
    // Astro 原样保留 `/`，会生成 `/tags/a/b` 两段 URL，配不上单段路由、构建硬失败。
    expect(astroSegmentForRaw('a/b')).toBe('a/b');
    expect(tagSegment('a/b')).toBe('a%2Fb');
    // 除了 `/`，其余字符都与 Astro 一致（上面第一条已逐字覆盖）。
  });

  /**
   * 这条**验的是页面真正交给 Astro 的那个值**，不是重算一遍。
   *
   * 评审点出的第二个盲区：旧测试自己调 `tagSegment(tag)`，于是页面里把
   * `params` 改回 `{ tag }` 也不会有任何断言变红。这里断言
   * `tagRouteParams()`——即 `[tag].astro` 里 `params:` 的那一行——同时再对页面
   * 源码做一次漂移检查，确保它真的在调 `tagRouteParams` 而不是把原始标签直传。
   */
  test('页面交给 Astro 的 params 就是与产物段一致的那个值', () => {
    for (const tag of CASES) {
      const params = tagRouteParams(tag);
      expect(params).toEqual({ tag: astroSegmentForRaw(tag) });
      // 也钉死「不是原始标签」：≥1 个字符被转义的用例必须不同。
      if (tagSegment(tag) !== tag) expect(params.tag).not.toBe(tag);
    }
  });

  test('[tag].astro 真的在用 tagRouteParams，没有把原始标签直传（页面漂移检查）', () => {
    const source = readFileSync(
      resolve('src/pages/tags/[tag].astro'),
      'utf8',
    );
    // `getStaticPaths` 里必须有 `params: tagRouteParams(tag)`。
    expect(source).toContain('params: tagRouteParams(tag)');
    // 绝不能退回 `params: { tag }`（原始标签直传，`#`/`?`/空格会让构建红）。
    expect(source).not.toMatch(/params:\s*\{\s*tag\s*\}/);
  });
});

describe('tagPath 的段与磁盘目录一致（按浏览器的解码方式核对）', () => {
  /**
   * 浏览器/静态托管拿到 href 后解析出的**路径段**。
   *
   * 用 `decodeURIComponent` 而不是 `decodeURI`：`decodeURI` **不会**解 `%23`/`%3F`
   * 这类保留字符的转义，会给出 `%23号` 这种「看起来正好等于目录名」的假绿。
   * 真实托管是把段完整解一次，`%23` 真的变成 `#`。
   */
  function segmentFromHref(href: string): string {
    const start = href.indexOf('/tags/') + '/tags/'.length;
    return decodeURIComponent(href.slice(start));
  }

  /** 磁盘目录名（字面值，含真实的 `%`），与 `tagSegment` 的输出相同。 */
  function artifactDir(tag: string): string {
    return tagSegment(tag);
  }

  test('每个标签的 href 完整解码一次后等于磁盘目录名', () => {
    for (const tag of ['工作', '我的 计划', 'C++ & Rust', 'C#', '#号', 'a?b', 'a b', 'x&y=z', '工作 & C#']) {
      expect(segmentFromHref(tagPath(tag, '/')), `标签 ${tag}`).toBe(artifactDir(tag));
    }
  });

  test('含 # / ? 的标签不再落进「编码差一级」的坑（回归护栏）', () => {
    for (const tag of ['C#', '#号', 'a?b']) {
      const dir = segmentFromHref(tagPath(tag, '/'));
      // 产物目录名是 `C%23` 这种带字面 `%` 的串，绝不是原始标签本身。
      expect(dir).toBe(tagSegment(tag));
      expect(dir).not.toBe(tag);
    }
  });

  test('a/b 的 href 不出现多余的层级（否则构建抛 Missing parameter）', () => {
    const href = tagPath('a/b', '/');
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
