import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 勾选框（任务的 `done`）。基于 Radix：键盘、`aria-checked`、暗色都由原语负责。
 *
 * 尺寸对齐前台 `ProgressTicks` 的那 9px 小方块语汇，取 1rem 便于点按；
 * 勾选态用 `primary` 实心 + 反白勾，不用 `seal`——朱红留给「印章/删除」这类语义。
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-[2px] border border-border bg-card',
        'transition-colors hover:border-muted-foreground/50',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'data-[state=checked]:text-primary-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
