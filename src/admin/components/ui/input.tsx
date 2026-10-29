import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 单行输入框。
 *
 * 底色用 `card`（比 `background` 更白一点的纸），边框用 `border`——
 * 和前台「簿纸上贴索引卡」的语汇一致，不引入调试面板式的灰底输入框。
 */
function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-[var(--radius)] border border-border bg-card',
        'px-2.5 py-1 text-[0.9375rem] text-foreground',
        'transition-colors placeholder:text-muted-foreground/70',
        'hover:border-muted-foreground/40 focus-visible:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-seal',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
