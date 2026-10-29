import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 模态对话框（新建条目、确认发布、放弃未保存改动这类打断式操作）。
 *
 * 基于 Radix Dialog：焦点陷阱、Esc 关闭、`aria-modal`、滚动锁都由原语负责。
 * 遮罩用 `foreground` 加透明度（半透明墨色），不写死黑色十六进制值——
 * 暗色下它会自动变成浅色遮罩，与令牌一起翻转。
 *
 * 刻意**不加进出场动画**：本站没有引入动画工具类（也不引第二套 CSS 依赖），
 * 而 `prefers-reduced-motion` 下动画本来就要关掉，零动画是这里最诚实的默认。
 * 需要动效时在 Task 13–16 里补，别在这一次接线里塞进来。
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 z-50 bg-foreground/30', className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          'max-h-[calc(100dvh-4rem)] overflow-y-auto',
          'rounded-[var(--radius)] border border-border bg-card p-5 text-card-foreground',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="dialog-close"
          className={cn(
            'absolute top-3 right-3 rounded-[2px] p-1 text-muted-foreground',
            'transition-colors hover:text-foreground',
          )}
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('mt-5 flex flex-wrap items-center justify-end gap-2', className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-[1.0625rem] font-semibold text-foreground', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-[0.875rem] leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
};
