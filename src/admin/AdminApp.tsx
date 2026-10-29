import { CheckCircle2, CloudOff, Loader2, Lock, PencilLine } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { Toaster } from './components/ui/sonner';
import {
  adminReducer,
  hasUnsavedChanges,
  initialAdminState,
  type AdminState,
} from './state/machine';
import { ConnectView } from './views/ConnectView';
import { LockedView } from './views/LockedView';
import { deriveView, type View } from './view-state';

/**
 * 后台外壳（`/admin` 的唯一 React 岛屿）。
 *
 * ## 状态从哪来
 *
 * 唯一的真相是 `useReducer(adminReducer)`（`./state/machine.ts`，纯函数、有穷举测试）。
 * 本文件只做三件事：算派生视图、把视图分派给对应组件、画外壳。
 *
 * `dirty`（有未保存改动）**不是第五个状态**，而是 `ready` 的派生条件——
 * `hasUnsavedChanges(state)` 再交给 `deriveView()` 折算成 `dirty` 视图。
 * 所以"未就绪却有未保存改动"这种组合没有地方可以写出来。
 *
 * ## 数据为什么不可能从构建产物里漏出来
 *
 * `disconnected` 这个状态变体里**没有 `days` 字段**。数据唯一来源是 `ConnectView`
 * 调 `client.getFile()` 从 GitHub 仓库现读；读到了才能 `TOKEN_OK` 拿到 `ready`。
 * 构建时读的那份 `src/data/` 快照只喂给公开页面，后台一眼都看不到。
 *
 * ## 还剩下的占位块
 *
 * - Task 15 → `ready` / `dirty` 换成条目编辑器（`EditorView` + 状态栏）
 * - Task 16 → `publishing` 换成提交进度
 *
 * Task 12 的「临时调试条」与「技术栈自检」面板本任务已删除：真实状态机接线后，
 * 再提供一个"手动跳到 ready"的按钮只会制造一个没有数据却有编辑入口的假状态。
 */

const VIEW_LABEL: Record<View, string> = {
  locked: '未解锁',
  disconnected: '未连接',
  ready: '就绪',
  dirty: '就绪 · 有未保存改动',
  publishing: '发布中',
};

/** `ready` / `dirty` / `publishing` 的占位文案。Task 15–16 会连同占位块一起替换。 */
const PLACEHOLDER: Record<'ready' | 'dirty' | 'publishing', { icon: typeof Lock; title: string; body: string }> =
  {
    ready: {
      icon: CheckCircle2,
      title: '已连接仓库（编辑器占位）',
      body: '数据已经从仓库读进来了。这里会显示当天的条目编辑器：新增、勾选、排序、加标签。由 Task 15 实现。',
    },
    dirty: {
      icon: PencilLine,
      title: '已连接 · 有未保存改动（编辑器占位）',
      body: '编辑入口与「保存并发布」会在这里出现。由 Task 15、16 实现。',
    },
    publishing: {
      icon: Loader2,
      title: '发布中（占位）',
      body: '这里会显示提交进度与失败重试；发布期间编辑入口锁住。由 Task 16 实现。',
    },
  };

export default function AdminApp({ siteTitle }: { siteTitle: string }) {
  const [state, dispatch] = React.useReducer(adminReducer, initialAdminState);

  const dirty = hasUnsavedChanges(state);
  const view: View = deriveView(state.status, dirty);
  const publishing = state.status === 'publishing';

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[64rem] flex-col gap-6 px-5 pt-8 pb-16 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-semibold tracking-[-0.01em]">{siteTitle} · 后台</h1>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            数据只从你的 GitHub 仓库读取；本机只保存访问令牌。
          </p>
        </div>
        {/* data-view 给自动化测试读当前状态用，不参与样式。 */}
        <span
          data-testid="admin-view"
          data-view={view}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-[0.8125rem]',
            publishing ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground',
          )}
        >
          {publishing ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <StatusIcon view={view} />
          )}
          {VIEW_LABEL[view]}
        </span>
      </header>

      {state.status === 'locked' ? <LockedView state={state} dispatch={dispatch} /> : null}
      {state.status === 'disconnected' ? <ConnectView state={state} dispatch={dispatch} /> : null}
      {state.status === 'ready' || state.status === 'publishing' ? (
        <LoadedPlaceholder state={state} view={view} />
      ) : null}

      <Toaster position="bottom-right" />
    </div>
  );
}

/** 状态徽标的小图标；`dirty` 与 `publishing` 各有自己的图标。 */
function StatusIcon({ view }: { view: View }) {
  const Icon =
    view === 'locked'
      ? Lock
      : view === 'disconnected'
        ? CloudOff
        : view === 'publishing'
          ? Loader2
          : view === 'dirty'
            ? PencilLine
            : CheckCircle2;
  return <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />;
}

/**
 * `ready` / `dirty` / `publishing` 的占位块（Task 15–16 替换）。
 *
 * 顺带把 `state.error` 显示出来：`TOKEN_FAIL` / `PUBLISH_FAIL` 按设计都停留在
 * `ready` 并只额外挂一条错误，如果这里不显示，那条错误就成了看不见的状态。
 */
function LoadedPlaceholder({
  state,
  view,
}: {
  state: Extract<AdminState, { status: 'ready' | 'publishing' }>;
  view: View;
}) {
  const { icon: ViewIcon, title, body } =
    PLACEHOLDER[view === 'dirty' || view === 'publishing' ? view : 'ready'];
  // `publishing` 变体没有 `error` 字段（正在提交，错误由失败分支收尾）。
  const error = 'error' in state ? state.error : undefined;
  const days = Object.keys(state.days).length;

  return (
    <section
      aria-labelledby="admin-view-title"
      className="flex flex-col items-start gap-3 rounded-[var(--radius)] border border-border bg-card px-5 py-6"
    >
      <h2 id="admin-view-title" className="flex items-center gap-2 text-[1.0625rem] font-semibold">
        <ViewIcon
          className={cn('size-4 text-muted-foreground', view === 'publishing' && 'animate-spin')}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        {title}
      </h2>
      <p className="max-w-[42rem] text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
      <p className="text-[0.8125rem] text-muted-foreground">
        已从仓库读取 {days} 天数据，当前选中 {state.selected}
        {view === 'dirty' ? `，${state.dirty.size} 天有未保存改动` : ''}。
      </p>
      {error ? (
        <p role="alert" className="text-[0.8125rem] leading-relaxed text-seal">
          {error}
        </p>
      ) : null}
    </section>
  );
}
