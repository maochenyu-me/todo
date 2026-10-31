import * as React from 'react';

import { formatMedium, isValidDateKey } from '@/lib/date';
import type { DayEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

import { Button } from './ui/button';
import { Input } from './ui/input';

/**
 * 左栏日期列表：只列日期，不显示完成数。
 *
 * 「只列日期」是刻意的：这一栏的职责是**选一天去编辑**，完成进度是读者视角的
 * 信息（公开页面的刻度条已经承担了），混进来只会让人在编辑时反复看到无关数字。
 *
 * 被修改过（在 `dirty` 里）的日期加一枚印章色的小点：它不解释"改了什么"，
 * 只提醒"这一天还没发布"。最新的日期排最上面——编辑的对象通常是最近的日子。
 *
 * 顶部是「新建一天」：给仓库里还没有的日期开一张空白页（允许任意合法日期，含未来）。
 * 日期已存在时**只是切过去**，不会覆盖——所以这里不做"已存在"的报错，
 * 那是最常见的一种误记，报错只会挡路。真正的结构约束在 reducer 的 `NEW_DAY` 里。
 */

export type DayListProps = {
  days: Record<string, DayEntry>;
  selected: string;
  dirty: ReadonlySet<string>;
  onSelect: (date: string) => void;
  /** 新建一天；日期已存在由 reducer 折成"选中"，UI 不重复判断。 */
  onNewDay: (date: string) => void;
  /** 「今天」的唯一依据（站点时区），用作日期输入框的默认值。 */
  todayKey: string;
  /** 发布中锁定：`SELECT_DAY` 在 `publishing` 下不生效，点了没反应不如不让点。 */
  disabled?: boolean;
};

export function DayList({
  days,
  selected,
  dirty,
  onSelect,
  onNewDay,
  todayKey,
  disabled = false,
}: DayListProps) {
  const dates = React.useMemo(() => Object.keys(days).sort().reverse(), [days]);
  const [draftDate, setDraftDate] = React.useState(todayKey);
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();

  function handleCreate(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = draftDate.trim();
    if (!isValidDateKey(value)) {
      setError('请选一个真实存在的日期（YYYY-MM-DD）');
      return;
    }
    setError(null);
    onNewDay(value);
  }

  return (
    <nav aria-label="选择日期" className="rounded-[var(--radius)] border border-border bg-card p-2">
      <form onSubmit={handleCreate} className="mb-1 flex flex-col gap-1.5 border-b border-border px-1 pb-2">
        <label htmlFor="admin-new-day" className="text-[0.75rem] text-muted-foreground">
          新建一天
        </label>
        <div className="flex items-center gap-1">
          <Input
            id="admin-new-day"
            type="date"
            value={draftDate}
            disabled={disabled}
            aria-invalid={error !== null || undefined}
            aria-describedby={error !== null ? errorId : undefined}
            onChange={(event) => {
              setDraftDate(event.target.value);
              setError(null);
            }}
            className="h-8 min-w-0 flex-1 px-1.5 text-[0.8125rem]"
          />
          <Button type="submit" size="sm" variant="outline" disabled={disabled} className="h-8 shrink-0 px-2">
            创建
          </Button>
        </div>
        {error !== null ? (
          <p id={errorId} role="alert" className="text-[0.75rem] leading-relaxed text-seal">
            {error}
          </p>
        ) : null}
      </form>

      <ul className="flex max-h-[16rem] flex-col gap-0.5 overflow-y-auto md:max-h-[34rem]">
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
