import { ArrowDown, ArrowUp, Ellipsis, PencilLine, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

import { formatLong } from '@/lib/date';
import type { DayEntry, Task } from '@/lib/types';
import { cn } from '@/lib/utils';

import type { TaskDraft } from '../state/operations';
import { addTask, deleteTask, moveTask, toggleDone, updateTask } from '../state/operations';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { TaskEditorDialog } from '../components/TaskEditorDialog';

/**
 * 编辑器主视图：一天的全部待办 + 五个操作入口。
 *
 * ## 本组件不实现任何数据变换
 *
 * 行上每个按钮都只是「调 `operations.ts` 的纯函数 → 把返回的新一天交给
 * `patchDay`」。`patchDay`（由 `AdminApp` 提供）内部走 `PATCH_DAY` 落 reducer
 * ——五个操作**全部**经 reducer，这里绝不绕开它自己存一份副本。
 *
 * ## 桌面与移动的两套操作入口
 *
 * 桌面（`sm` 以上）：每行四个图标按钮，一眼可见。
 * 窄屏（375px）：四个图标挤爆一行，收进行尾的 `⋯`（`Ellipsis`）菜单，
 * 点开显示同名的文字按钮。`menuTaskId` 记录当前展开哪一行——同一时刻
 * 只有一行展开，切换行时旧的自动收起。
 *
 * 删除是唯一不可逆的操作，用 `window.confirm` 拦一道：误触的代价是丢一条
 * 用户手写的内容，而「撤销」本面板没有（改动直接落在 reducer 里）。
 */

/** 打开的对话框状态；`null` 表示关闭。新增与编辑共用同一个 `TaskEditorDialog`。 */
type DialogState = { mode: 'create' } | { mode: 'edit'; task: Task } | null;

const PRIORITY_LABEL: Record<0 | 2, string> = { 0: '高', 2: '低' };

export type EditorViewProps = {
  entry: DayEntry;
  /** 发布中锁住全部入口（reducer 在 `publishing` 下会拒绝 `PATCH_DAY`，这里同步锁 UI）。 */
  publishing: boolean;
  /** 编辑结果回传入口：内部实现必须走 `PATCH_DAY`。 */
  patchDay: (day: DayEntry) => void;
};

export function EditorView({ entry, publishing, patchDay }: EditorViewProps) {
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [menuTaskId, setMenuTaskId] = React.useState<string | null>(null);

  function commit(next: DayEntry): void {
    patchDay(next);
    setMenuTaskId(null);
  }

  function submitDraft(draft: TaskDraft): void {
    if (dialog === null) return;
    if (dialog.mode === 'create') {
      commit(addTask(entry, draft));
    } else {
      commit(updateTask(entry, { ...dialog.task, ...draft }));
    }
  }

  function confirmDelete(task: Task): void {
    if (window.confirm(`删除待办「${task.title}」？删除后要点「保存并发布」才会写入仓库。`)) {
      commit(deleteTask(entry, task.id));
    }
  }

  const isEmpty = entry.tasks.length === 0;

  return (
    <section aria-label={`编辑 ${formatLong(entry.date)}`} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
          {formatLong(entry.date)}
        </h2>
        <Button
          size="sm"
          disabled={publishing}
          onClick={() => {
            setMenuTaskId(null);
            setDialog({ mode: 'create' });
          }}
        >
          <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
          新增待办
        </Button>
      </div>

      {isEmpty ? (
        <p className="rounded-[var(--radius)] border border-dashed border-border px-4 py-8 text-center text-[0.875rem] leading-relaxed text-muted-foreground">
          这一天还没有待办。点右上角「新增待办」写下第一件。
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {entry.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isFirst={task.order === 0}
              isLast={task.order === entry.tasks.length - 1}
              publishing={publishing}
              menuOpen={menuTaskId === task.id}
              onToggleMenu={() =>
                setMenuTaskId((current) => (current === task.id ? null : task.id))
              }
              onMove={(dir) => commit(moveTask(entry, task.id, dir))}
              onEdit={() => {
                setMenuTaskId(null);
                setDialog({ mode: 'edit', task });
              }}
              onDelete={() => confirmDelete(task)}
              onToggleDone={() => commit(toggleDone(entry, task.id))}
            />
          ))}
        </ol>
      )}

      <TaskEditorDialog
        open={dialog !== null}
        mode={dialog?.mode === 'edit' ? 'edit' : 'create'}
        task={dialog?.mode === 'edit' ? dialog.task : null}
        publishing={publishing}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onSubmit={submitDraft}
      />
    </section>
  );
}

type TaskRowProps = {
  task: Task;
  isFirst: boolean;
  isLast: boolean;
  publishing: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onMove: (dir: 'up' | 'down') => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleDone: () => void;
};

function TaskRow({
  task,
  isFirst,
  isLast,
  publishing,
  menuOpen,
  onToggleMenu,
  onMove,
  onEdit,
  onDelete,
  onToggleDone,
}: TaskRowProps) {
  const iconButtonClass = 'size-8';
  const iconStroke = 1.75;

  return (
    <li className="rounded-[var(--radius)] border border-border bg-card px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={task.done}
          disabled={publishing}
          onCheckedChange={(checked) => {
            if (checked !== 'indeterminate') onToggleDone();
          }}
          aria-label={task.done ? `标记「${task.title}」为未完成` : `完成「${task.title}」`}
        />

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-[0.9375rem] leading-relaxed break-words',
              task.done && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </p>
          {(task.timeBlock !== null || task.tags.length > 0 || task.priority !== 1 || task.note !== '') && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted-foreground">
              {task.timeBlock !== null ? (
                <span className="tabular-nums">
                  {task.timeBlock.start}–{task.timeBlock.end}
                </span>
              ) : null}
              {task.priority !== 1 ? (
                <span
                  className={cn(
                    'rounded-[var(--radius)] border px-1',
                    task.priority === 0 ? 'border-seal/40 text-seal' : 'border-border',
                  )}
                >
                  {PRIORITY_LABEL[task.priority]}
                </span>
              ) : null}
              {task.tags.map((tag) => (
                <span key={tag} className="rounded-[var(--radius)] bg-muted px-1">
                  {tag}
                </span>
              ))}
              {task.note !== '' ? <span>有备注</span> : null}
            </div>
          )}
        </div>

        {/* 桌面：四个图标按钮直接排开；窄屏隐藏（`hidden sm:flex`）。 */}
        <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
          <Button
            variant="ghost"
            className={iconButtonClass}
            size="icon"
            disabled={publishing || isFirst}
            aria-label={`上移「${task.title}」`}
            onClick={() => onMove('up')}
          >
            <ArrowUp className="size-4" strokeWidth={iconStroke} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            className={iconButtonClass}
            size="icon"
            disabled={publishing || isLast}
            aria-label={`下移「${task.title}」`}
            onClick={() => onMove('down')}
          >
            <ArrowDown className="size-4" strokeWidth={iconStroke} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            className={iconButtonClass}
            size="icon"
            disabled={publishing}
            aria-label={`编辑「${task.title}」`}
            onClick={onEdit}
          >
            <PencilLine className="size-4" strokeWidth={iconStroke} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            className={cn(iconButtonClass, 'hover:text-seal')}
            size="icon"
            disabled={publishing}
            aria-label={`删除「${task.title}」`}
            onClick={onDelete}
          >
            <Trash2 className="size-4" strokeWidth={iconStroke} aria-hidden="true" />
          </Button>
        </div>

        {/* 窄屏：`⋯` 展开文字操作，避免四个图标挤爆 375px 的行。 */}
        <Button
          variant="ghost"
          className={cn('size-8 shrink-0 sm:hidden', menuOpen && 'bg-muted text-foreground')}
          size="icon"
          disabled={publishing}
          aria-label={`${task.title} 的更多操作`}
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
        >
          <Ellipsis className="size-4" strokeWidth={iconStroke} aria-hidden="true" />
        </Button>
      </div>

      {menuOpen ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={publishing || isFirst}
            onClick={() => onMove('up')}
          >
            上移
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={publishing || isLast}
            onClick={() => onMove('down')}
          >
            下移
          </Button>
          <Button variant="ghost" size="sm" disabled={publishing} onClick={onEdit}>
            编辑
          </Button>
          <Button variant="ghost" size="sm" className="text-seal hover:text-seal" disabled={publishing} onClick={onDelete}>
            删除
          </Button>
        </div>
      ) : null}
    </li>
  );
}
