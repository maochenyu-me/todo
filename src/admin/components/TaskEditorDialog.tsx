import * as React from 'react';

import type { Priority, Task } from '@/lib/types';
import { validateTask } from '@/lib/validate';

import type { TaskDraft } from '../state/operations';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';
import { Textarea } from './ui/textarea';

/**
 * 待办编辑对话框：新增与编辑共用一套表单。
 *
 * ## 校验只在本层发生，且发生在提交前
 *
 * 「保存」时先 `composeDraft()`：把表单字段折成 `TaskDraft` 并跑
 * `validateTask()`（`@/lib/validate`，spec 8.7 的逐字文案）。有错误就**不提交**，
 * 错误按字段归位、贴在各自输入框下方（`groupTaskErrors`）。
 * 入库（`PATCH_DAY`）前的自愈（补 `completedAt`、标签去重）由
 * `operations.ts` 的 `addTask` / `updateTask` 过 `normalizeTask` 完成——
 * 校验归本层，自愈归入库层，两件事不混。
 *
 * ## 表单状态只在打开时同步
 *
 * 关闭期间表单内容一律丢弃；再次打开时以目标任务（或空白）重置。
 * 这样"编辑 A → 关闭 → 编辑 B"绝不会残留 A 的字段。
 */

/** 时间段只填了一头时的错误（结构性问题，`validateTask` 管不到，本层补上）。 */
export const PARTIAL_TIME_MSG = '开始时间与结束时间要一起填写，或都留空。';

/** 表单字段：时间是两个独立的字符串（`<input type="time">` 的值，`''` 表示没填）。 */
export type EditorFields = {
  title: string;
  start: string;
  end: string;
  priority: Priority;
  tagsText: string;
  note: string;
  done: boolean;
};

/** 标签输入框的原文 → 标签数组：中英文逗号都算分隔符，去空白、丢空项。 */
export function parseTagsInput(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

/**
 * 表单字段 → `TaskDraft`，并跑一遍 `validateTask`（含时间段完整性检查）。
 * 有错误时 `draft` 为 `null`，错误是**给人看的中文**，直接贴到字段下方。
 */
export function composeDraft(fields: EditorFields): {
  draft: TaskDraft | null;
  errors: string[];
} {
  const errors: string[] = [];
  const tags = parseTagsInput(fields.tagsText);

  let timeBlock: { start: string; end: string } | null = null;
  if (fields.start === '' && fields.end === '') {
    timeBlock = null;
  } else if (fields.start !== '' && fields.end !== '') {
    timeBlock = { start: fields.start, end: fields.end };
  } else {
    errors.push(PARTIAL_TIME_MSG);
  }

  // `validateTask` 只看内容字段；`id` / 时间戳用探针值占位（它不校验这些）。
  const probe: Task = {
    id: 'probe',
    title: fields.title.trim(),
    done: fields.done,
    completedAt: null,
    order: 0,
    priority: fields.priority,
    tags,
    note: fields.note,
    timeBlock,
    createdAt: '',
    updatedAt: '',
  };
  errors.push(...validateTask(probe));

  if (errors.length > 0) return { draft: null, errors };
  return {
    draft: {
      title: fields.title.trim(),
      note: fields.note,
      timeBlock,
      priority: fields.priority,
      tags,
      done: fields.done,
    },
    errors: [],
  };
}

/**
 * 把 `validateTask` 的中文文案按字段归位，贴到各自输入框下方；
 * 归不了类的进 `other`（一般不会发生，但错误必须**有地方显示**，不能静默）。
 * 文案来自 `validate.ts` 的固定表格，按关键词匹配是稳的；改文案先改 spec 再改这里。
 */
export function groupTaskErrors(errors: readonly string[]): {
  title: string[];
  timeBlock: string[];
  tags: string[];
  note: string[];
  other: string[];
} {
  const title: string[] = [];
  const timeBlock: string[] = [];
  const tags: string[] = [];
  const note: string[] = [];
  const other: string[] = [];
  for (const message of errors) {
    if (message.includes('标题')) title.push(message);
    else if (message.includes('时间')) timeBlock.push(message);
    else if (message.includes('标签')) tags.push(message);
    else if (message.includes('备注')) note.push(message);
    else other.push(message);
  }
  return { title, timeBlock, tags, note, other };
}

const EMPTY_FIELDS: EditorFields = {
  title: '',
  start: '',
  end: '',
  priority: 1,
  tagsText: '',
  note: '',
  done: false,
};

function fieldsFromTask(task: Task): EditorFields {
  return {
    title: task.title,
    start: task.timeBlock?.start ?? '',
    end: task.timeBlock?.end ?? '',
    priority: task.priority,
    tagsText: task.tags.join(', '),
    note: task.note,
    done: task.done,
  };
}

export type TaskEditorDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  /** 编辑时的目标任务；新增时为 `null`。 */
  task: Task | null;
  publishing?: boolean;
  onOpenChange: (open: boolean) => void;
  /** 校验通过后带着 `TaskDraft` 调用；入库由调用方经 `PATCH_DAY` 完成。 */
  onSubmit: (draft: TaskDraft) => void;
};

export function TaskEditorDialog({
  open,
  mode,
  task,
  publishing = false,
  onOpenChange,
  onSubmit,
}: TaskEditorDialogProps) {
  const [fields, setFields] = React.useState<EditorFields>(EMPTY_FIELDS);
  const [errors, setErrors] = React.useState<string[]>([]);

  const titleErrorId = React.useId();
  const timeErrorId = React.useId();
  const tagsErrorId = React.useId();
  const noteErrorId = React.useId();
  const otherErrorId = React.useId();

  // 打开时以目标任务（或空白）重置表单；依赖 `task` 的引用即可，内容变化必然换引用。
  React.useEffect(() => {
    if (open) {
      setFields(task !== null ? fieldsFromTask(task) : EMPTY_FIELDS);
      setErrors([]);
    }
  }, [open, task]);

  const grouped = React.useMemo(() => groupTaskErrors(errors), [errors]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const { draft, errors: next } = composeDraft(fields);
    if (draft === null) {
      setErrors(next);
      return;
    }
    setErrors([]);
    onSubmit(draft);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!publishing) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '新增待办' : '编辑待办'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? '写清楚要做什么。只有标题必填，改动先留在本机，发布时才写入仓库。'
              : '改动先留在本机，点「保存并发布」后才写入仓库。'}
          </DialogDescription>
        </DialogHeader>

        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-title">标题</Label>
            <Input
              id="task-title"
              value={fields.title}
              disabled={publishing}
              aria-invalid={grouped.title.length > 0 || undefined}
              aria-describedby={grouped.title.length > 0 ? titleErrorId : undefined}
              onChange={(event) => setFields((f) => ({ ...f, title: event.target.value }))}
            />
            <FieldError id={titleErrorId} messages={grouped.title} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[0.875rem] leading-none font-medium text-foreground">
              时间段（可选）
            </span>
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Label htmlFor="task-start" className="text-[0.8125rem] text-muted-foreground">
                  开始
                </Label>
                <Input
                  id="task-start"
                  type="time"
                  value={fields.start}
                  disabled={publishing}
                  aria-invalid={grouped.timeBlock.length > 0 || undefined}
                  aria-describedby={grouped.timeBlock.length > 0 ? timeErrorId : undefined}
                  onChange={(event) => setFields((f) => ({ ...f, start: event.target.value }))}
                />
              </div>
              <span aria-hidden="true" className="mt-7 text-muted-foreground">
                –
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Label htmlFor="task-end" className="text-[0.8125rem] text-muted-foreground">
                  结束
                </Label>
                <Input
                  id="task-end"
                  type="time"
                  value={fields.end}
                  disabled={publishing}
                  aria-invalid={grouped.timeBlock.length > 0 || undefined}
                  aria-describedby={grouped.timeBlock.length > 0 ? timeErrorId : undefined}
                  onChange={(event) => setFields((f) => ({ ...f, end: event.target.value }))}
                />
              </div>
            </div>
            <FieldError id={timeErrorId} messages={grouped.timeBlock} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-priority">优先级</Label>
            <Select
              id="task-priority"
              value={String(fields.priority)}
              disabled={publishing}
              onChange={(event) =>
                setFields((f) => ({ ...f, priority: Number(event.target.value) as Priority }))
              }
            >
              <option value="0">高</option>
              <option value="1">中</option>
              <option value="2">低</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-tags">标签（用逗号分隔）</Label>
            <Input
              id="task-tags"
              value={fields.tagsText}
              placeholder="工作, 深度"
              disabled={publishing}
              aria-invalid={grouped.tags.length > 0 || undefined}
              aria-describedby={grouped.tags.length > 0 ? tagsErrorId : undefined}
              onChange={(event) => setFields((f) => ({ ...f, tagsText: event.target.value }))}
            />
            <FieldError id={tagsErrorId} messages={grouped.tags} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-note">备注</Label>
            <Textarea
              id="task-note"
              rows={3}
              value={fields.note}
              disabled={publishing}
              aria-invalid={grouped.note.length > 0 || undefined}
              aria-describedby={grouped.note.length > 0 ? noteErrorId : undefined}
              onChange={(event) => setFields((f) => ({ ...f, note: event.target.value }))}
            />
            <FieldError id={noteErrorId} messages={grouped.note} />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="task-done"
              checked={fields.done}
              disabled={publishing}
              onCheckedChange={(checked) => {
                if (checked !== 'indeterminate') setFields((f) => ({ ...f, done: checked }));
              }}
            />
            <Label htmlFor="task-done">已完成</Label>
          </div>

          {grouped.other.length > 0 ? (
            <FieldError id={otherErrorId} messages={grouped.other} />
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={publishing}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={publishing}>
              {mode === 'create' ? '添加' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 字段下方的错误文案块；`role="alert"` 让读屏软件立刻念出来。 */
function FieldError({ id, messages }: { id: string; messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div id={id} role="alert" className="flex flex-col gap-0.5">
      {messages.map((message) => (
        <p key={message} className="text-[0.8125rem] leading-relaxed text-seal">
          {message}
        </p>
      ))}
    </div>
  );
}
