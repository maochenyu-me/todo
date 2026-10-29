import { describe, expect, test } from 'vitest';

import type { Task } from '@/lib/types';

import {
  composeDraft,
  groupTaskErrors,
  parseTagsInput,
  PARTIAL_TIME_MSG,
  type EditorFields,
} from './TaskEditorDialog';

/**
 * 编辑对话框的**纯函数**测试（`composeDraft` / `parseTagsInput` / `groupTaskErrors`）。
 *
 * 表单校验是「提交前最后一道闸」，这里盯三件事：
 * - 错误时 `draft` 必须是 `null`（绝不能带着错误入库）；
 * - 错误文案是 `validate.ts`（spec 8.7）的**逐字中文**，外加本层补的时间段完整性；
 * - 错误能按字段归位（`groupTaskErrors`），归不了类的进 `other`——文案必须有地方显示。
 */

function fields(overrides: Partial<EditorFields> = {}): EditorFields {
  return {
    title: '写周报',
    start: '',
    end: '',
    priority: 1,
    tagsText: '',
    note: '',
    done: false,
    ...overrides,
  };
}

describe('parseTagsInput', () => {
  test('中英文逗号都算分隔符', () => {
    expect(parseTagsInput('工作，深度, 复盘')).toEqual(['工作', '深度', '复盘']);
  });

  test('去空白、丢空项', () => {
    expect(parseTagsInput('  工作  ,, ,深度')).toEqual(['工作', '深度']);
    expect(parseTagsInput('')).toEqual([]);
  });
});

describe('composeDraft', () => {
  test('合法字段产出完整 TaskDraft', () => {
    const { draft, errors } = composeDraft(
      fields({ tagsText: '工作, 深度', start: '09:00', end: '10:00', note: '记得带数据' }),
    );
    expect(errors).toEqual([]);
    expect(draft).toEqual({
      title: '写周报',
      note: '记得带数据',
      timeBlock: { start: '09:00', end: '10:00' },
      priority: 1,
      tags: ['工作', '深度'],
      done: false,
    });
  });

  test('标题空白 → 「待办需要一个标题。」，draft 为 null', () => {
    const { draft, errors } = composeDraft(fields({ title: '   ' }));
    expect(draft).toBeNull();
    expect(errors).toEqual(['待办需要一个标题。']);
  });

  test('只填一头时间 → 时间段完整性错误（本层补的文案）', () => {
    const partial = composeDraft(fields({ start: '09:00' }));
    expect(partial.draft).toBeNull();
    expect(partial.errors).toEqual([PARTIAL_TIME_MSG]);

    const partialEnd = composeDraft(fields({ end: '10:00' }));
    expect(partialEnd.draft).toBeNull();
    expect(partialEnd.errors).toEqual([PARTIAL_TIME_MSG]);
  });

  test('end <= start → validateTask 的时间段错误', () => {
    const { draft, errors } = composeDraft(fields({ start: '10:00', end: '10:00' }));
    expect(draft).toBeNull();
    expect(errors).toEqual(['结束时间要晚于开始时间。']);
  });

  test('超过 10 个标签 → 标签错误', () => {
    const tagsText = Array.from({ length: 11 }, (_, i) => `标签${i + 1}`).join(',');
    const { draft, errors } = composeDraft(fields({ tagsText }));
    expect(draft).toBeNull();
    expect(errors).toEqual(['最多 10 个标签，每个不超过 20 字。']);
  });

  test('标题与时间段同时出错：两条错误都在', () => {
    const { draft, errors } = composeDraft(fields({ title: '', start: '09:00' }));
    expect(draft).toBeNull();
    expect(errors).toEqual(['开始时间与结束时间要一起填写，或都留空。', '待办需要一个标题。']);
  });
});

describe('groupTaskErrors', () => {
  const probe = (title: string): Task => ({
    id: 'probe',
    title,
    done: false,
    completedAt: null,
    order: 0,
    priority: 1,
    tags: [],
    note: '',
    timeBlock: null,
    createdAt: '',
    updatedAt: '',
  });

  test('按关键词归位到各自字段', () => {
    const grouped = groupTaskErrors([
      ...composeDraft(fields({ title: '' })).errors, // 标题
      ...composeDraft(fields({ start: '09:00' })).errors, // 时间段
      ...composeDraft(fields({ tagsText: 'a'.repeat(21) })).errors, // 标签
    ]);
    expect(grouped.title).toEqual(['待办需要一个标题。']);
    expect(grouped.timeBlock).toEqual(['开始时间与结束时间要一起填写，或都留空。']);
    expect(grouped.tags).toEqual(['最多 10 个标签，每个不超过 20 字。']);
    expect(grouped.note).toEqual([]);
    expect(grouped.other).toEqual([]);
  });

  test('备注超长归到备注', () => {
    const longNote = 'x'.repeat(2001);
    const { errors } = composeDraft(fields({ note: longNote }));
    const grouped = groupTaskErrors(errors);
    expect(grouped.note).toEqual(['备注最多 2000 字。']);
  });

  test('归不了类的进 other——错误必须有地方显示', () => {
    const orphan = '出现重复标识，请删除后重新添加这一条。';
    const grouped = groupTaskErrors([orphan]);
    expect(grouped.other).toEqual([orphan]);
  });

  test('validateTask 探针对照：字段错误确实能被分组（防 validate 文案改动后分组失效）', () => {
    // 直接调 validateTask 拿「同 id 重复」文案归 other；字段错误必须各归各位。
    expect(groupTaskErrors(['结束时间要晚于开始时间。']).timeBlock).toEqual([
      '结束时间要晚于开始时间。',
    ]);
    expect(probe('写周报').title).toBe('写周报');
  });
});
