import * as React from 'react';

import { formatMedium } from '@/lib/date';
import type { DayEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * 左栏日期列表：只列日期，不显示完成数。
 *
 * 「只列日期」是刻意的：这一栏的职责是**选一天去编辑**，完成进度是读者视角的
 * 信息（公开页面的刻度条已经承担了），混进来只会让人在编辑时反复看到无关数字。
 *
 * 被修改过（在 `dirty` 里）的日期加一枚印章色的小点：它不解释"改了什么"，
 * 只提醒"这一天还没发布"。最新的日期排最上面——编辑的对象通常是最近的日子。
 */

export type DayListProps = {
  days: Record<string, DayEntry>;
  selected: string;
  dirty: ReadonlySet<string>;
  onSelect: (date: string) => void;
  /** 发布中锁定：`SELECT_DAY` 在 `publishing` 下不生效，点了没反应不如不让点。 */
  disabled?: boolean;
};

export function DayList({ days, selected, dirty, onSelect, disabled = false }: DayListProps) {
  const dates = React.useMemo(() => Object.keys(days).sort().reverse(), [days]);

  return (
    <nav aria-label="选择日期" className="rounded-[var(--radius)] border border-border bg-card p-2">
      <ul className="flex max-h-[16rem] flex-col gap-0.5 overflow-y-auto md:max-h-[36rem]">
        {dates.map((date) => {
          const isDirty = dirty.has(date);
          const isCurrent = date === selected;
          return (
            <li key={date}>
              <button
                type="button"
                disabled={disabled}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => onSelect(date)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[var(--radius)] px-2.5 py-1.5 text-left text-[0.875rem] transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  isCurrent
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {/*
                  占位圆点：无论有没有未保存改动都渲染同一尺寸的元素，
                  日期文字的横向位置不会因为出现小点而跳动。
                */}
                <span className="flex size-1.5 shrink-0 items-center justify-center" aria-hidden="true">
                  {isDirty ? <span className="size-1.5 rounded-full bg-seal" /> : null}
                </span>
                {isDirty ? <span className="sr-only">有未保存改动，</span> : null}
                {formatMedium(date)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
