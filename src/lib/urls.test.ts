import { describe, expect, test } from 'vitest';

import { withBase } from './urls';

describe('withBase', () => {
  test('根部署时原样返回', () => {
    expect(withBase('/archive', '/')).toBe('/archive');
    expect(withBase('/', '/')).toBe('/');
  });

  test('子路径部署时加前缀', () => {
    expect(withBase('/archive', '/TODO/')).toBe('/TODO/archive');
    expect(withBase('/', '/TODO/')).toBe('/TODO/');
    expect(withBase('/date/2026-10-28', '/TODO/')).toBe('/TODO/date/2026-10-28');
  });

  test('base 缺结尾斜杠时不重复斜杠', () => {
    expect(withBase('/stats', '/TODO')).toBe('/TODO/stats');
  });

  test('路径缺开头斜杠时补上', () => {
    expect(withBase('tags/工作', '/TODO/')).toBe('/TODO/tags/工作');
  });
});
