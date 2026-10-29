import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 多行文本域（备注、发布说明用）。
 *
 * 只设 `min-h`，不用固定高度：自动高度交给使用方的 `rows`，
 * 后台的备注框不该在写长内容时出现内部滚动条。
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-20 w-full min-w-0 resize-y rounded-[var(--radius)] border border-border bg-card',
        'px-2.5 py-2 text-[0.9375rem] leading-relaxed text-foreground',
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

export { Textarea };
