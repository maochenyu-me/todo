/**
 * 类名合并助手：`clsx` 处理条件拼接，`tailwind-merge` 消解冲突（后者胜）。
 *
 * 这是后台组件（`src/admin/components/ui/*`）共用的唯一入口，产物与 shadcn/ui 的
 * 惯例一致：组件从 props 收进来的 `className` 永远有机会覆盖内置样式，
 * 而不是变成两条互相打架的工具类。
 *
 * 只在**客户端岛屿**里使用——前台页面零 JS，一个字节都不会加载到这里。
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
