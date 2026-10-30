/**
 * 单日翻阅的链接口径。
 *
 * **一份判定，两个消费者**：底部「按日翻阅」（`DayView`）与页面预取（`<link rel="prefetch">`，
 * 由 `BaseLayout` 渲染）。两边如果各算一次，迟早出现「翻页有链接、预取没有」，
 * 更糟的是「预取了一个不存在的 URL」——那样每次打开页面都会安静地打一次 404。
 *
 * 规则：
 * - 相邻那天是**今天** → 一定可链，地址就是 `/`（今天没写文件也是真实页面）；
 * - 相邻那天磁盘上有记录 → `/date/<key>`；
 * - 其余 → `null`（不渲染链接，也不预取）。
 *
 * 本文件无框架依赖，纯函数可单测。
 */
import { addDays } from './date';
import { withBase } from './urls';

export interface DayNavInput {
  /** 当前正在看的那一天。 */
  dateKey: string;
  /** 站点时区里的「今天」。 */
  todayKey: string;
  prevHasData: boolean;
  nextHasData: boolean;
}

export interface DayNav {
  /** 前一天的目标地址；`null` 表示既无记录也不是今天。 */
  prev: string | null;
  next: string | null;
  /** 「回到今天」；当前就在今天时是 `null`。 */
  today: string | null;
}

/** 某一天的可链地址：今天 → `/`；有记录 → `/date/<key>`；否则 `null`。 */
export function hrefFor(dateKey: string, todayKey: string, hasData: boolean): string | null {
  if (dateKey === todayKey) return withBase('/');
  return hasData ? withBase(`/date/${dateKey}`) : null;
}

/** 当前页的翻阅三件套：前一天、后一天、回到今天。 */
export function dayNav({ dateKey, todayKey, prevHasData, nextHasData }: DayNavInput): DayNav {
  return {
    prev: hrefFor(addDays(dateKey, -1), todayKey, prevHasData),
    next: hrefFor(addDays(dateKey, 1), todayKey, nextHasData),
    today: dateKey === todayKey ? null : withBase('/'),
  };
}

/** 预取目标：翻阅三件套里真正存在的那些（顺序＝优先级：先相邻日，后今天）。 */
export function prefetchTargets(nav: DayNav): string[] {
  return [nav.prev, nav.next, nav.today].filter((href): href is string => href !== null);
}
