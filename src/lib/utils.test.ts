import { describe, expect, test } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  test('拼接普通类名', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  test('忽略假值', () => {
    expect(cn('a', false, undefined, null, '', 'b')).toBe('a b');
  });

  test('条件对象写法', () => {
    expect(cn({ a: true, b: false }, 'c')).toBe('a c');
  });

  test('数组写法会拍平', () => {
    expect(cn(['a', ['b', false]], 'c')).toBe('a b c');
  });

  test('tailwind-merge 消解同类工具类冲突，后者胜', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('bg-card text-foreground', 'bg-primary')).toBe('text-foreground bg-primary');
  });

  test('不相干的工具类不会被误删', () => {
    expect(cn('px-2 py-1', 'text-sm')).toBe('px-2 py-1 text-sm');
  });

  test('调用方传入的 className 能覆盖组件内置样式', () => {
    // 组件的典型写法：cn(内置, props.className)
    expect(cn('w-full border-border', 'border-seal')).toBe('w-full border-seal');
  });
});
