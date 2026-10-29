import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 下拉选择：**原生 `<select>`**，只换皮。
 *
 * 为什么不用 Radix Select：后台的选择项是「优先级 / 时间段 / 标签」这类短列表，
 * 原生控件在移动端自带全屏滚轮、无障碍与输入法行为都是平台最好的，而且零额外 JS。
 * 视觉上只用 `appearance-none` 去掉系统箭头，再叠一个 lucide `ChevronDown`。
 *
 * 注意：`className` 作用在 `<select>` 本身，不是外层定位容器——
 * 这样 `w-full` 之类的布局类照常生效，外层 div 只负责给箭头做定位上下文。
 */
function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative w-full">
      <select
        data-slot="select"
        className={cn(
          'h-9 w-full min-w-0 appearance-none rounded-[var(--radius)] border border-border bg-card',
          'py-1 pr-8 pl-2.5 text-[0.9375rem] text-foreground',
          'transition-colors hover:border-muted-foreground/40 focus-visible:border-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-seal',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </div>
  );
}

export { Select };
