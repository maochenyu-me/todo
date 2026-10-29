import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 标签页（编辑器里的「条目 / 备注 / 发布」这类平级分区）。
 *
 * 视觉语汇刻意复刻前台 `Rail` 的导航标签：一排等宽词，当前那项下方压一道
 * `primary` 实线——后台不应该长得像另一个站。
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-3', className)} {...props} />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex items-center gap-1 border-b border-border', className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        '-mb-px inline-flex items-center justify-center gap-1.5 border-b-2 border-transparent',
        'px-2.5 py-1.5 text-[0.875rem] whitespace-nowrap text-muted-foreground transition-colors',
        'hover:text-foreground',
        'data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('outline-none', className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
