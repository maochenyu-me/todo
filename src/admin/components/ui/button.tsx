import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 按钮：shadcn/ui 的 API（`variant` / `size` / `asChild`），但配色只用本站令牌。
 *
 * 与上游的两处刻意差异：
 * 1. **没有焦点环**。前台与后台共用 `:focus-visible { outline: 2px solid var(--primary) }`
 *    这条全局规则（后台在 `admin.astro` 里同样声明了一份），焦点环由它统一负责；
 *    组件再叠一层 ring 会画出两个圈。
 * 2. **没有 `secondary`/`destructive` 令牌**。本站色板只有 background/card/foreground/
 *    muted/border/primary/seal/done，所以 `secondary` 落到 `muted`、`destructive` 落到
 *    印章红 `seal`——变体名保留，色值换成本站approved的那一套。
 *
 * 圆角一律走 `--radius`：不引入第二套半径刻度。
 */
const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap',
    'rounded-[var(--radius)] border border-transparent',
    'font-medium transition-colors select-none',
    'disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        outline: 'border-border bg-card text-foreground hover:bg-muted',
        secondary: 'bg-muted text-foreground hover:bg-muted/70',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        destructive: 'border-seal/40 text-seal hover:bg-seal/10',
        link: 'text-primary underline underline-offset-4 hover:underline-offset-2',
      },
      size: {
        sm: 'h-7 px-2.5 text-[0.8125rem]',
        default: 'h-9 px-3.5 text-[0.875rem]',
        lg: 'h-10 px-4 text-[0.9375rem]',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** 把样式套给子元素（比如 `<a>`），不额外包一层 `<button>`。 */
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? 'default'}
      data-size={size ?? 'default'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
