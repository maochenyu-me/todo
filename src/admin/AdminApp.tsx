import { CheckCircle2, CloudOff, Loader2, Lock, PencilLine } from 'lucide-react';
import * as React from 'react';

import { validateDay } from '@/lib/validate';
import type { DayEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

import { siteConfig } from '../../site.config.ts';
import { DayList } from './components/DayList';
import { StatusBar } from './components/StatusBar';
import {
  adminReducer,
  hasUnsavedChanges,
  initialAdminState,
  loadWarningsOf,
  type AdminState,
} from './state/machine';
import { ConnectView } from './views/ConnectView';
import { EditorView } from './views/EditorView';
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
 * ## 编辑器的接线
 *
 * `EditorView` 的每个操作都调 `operations.ts` 的纯函数拿到「新的一天」，再经
 * `patchDay` 分派 `PATCH_DAY` 落回 reducer——本文件**不持有任何编辑副本**，
 * reducer 的 `days` 就是编辑器画面的唯一来源。
 *
 * 发布闸门：`dirty` 里每一天都要过 `validateDay()`，有不过的就把「保存并发布」
 * 挡住并列出原因（坏数据一旦发布，公开页面就得吃下它）。真实发布链路
 * （`PUBLISH_START` → commit → `PUBLISH_OK`/`FAIL`）由 Task 16 接线。
 *
 * ## 数据为什么不可能从构建产物里漏出来
 *
 * `disconnected` 这个状态变体里**没有 `days` 字段**。数据唯一来源是 `ConnectView`
 * 调 `client.getFile()` 从 GitHub 仓库现读；读到了才能 `TOKEN_OK` 拿到 `ready`。
 * 构建时读的那份 `src/data/` 快照只喂给公开页面，后台一眼都看不到。
 *
 * ## 还剩下的占位块
 *
 * - Task 16 → `publishing` 换成提交进度，`onPublish` 接上真实发布链路。
 */

const VIEW_LABEL: Record<View, string> = {
  locked: '未解锁',
  disconnected: '未连接',
  ready: '就绪',
  dirty: '就绪 · 有未保存改动',
  publishing: '发布中',
};

/** 每个视图一个图标——徽标（`StatusIcon`）共用这一张表，加视图时只有一处要改。 */
const VIEW_ICON: Record<View, typeof Lock> = {
  locked: Lock,
  disconnected: CloudOff,
  ready: CheckCircle2,
  dirty: PencilLine,
  publishing: Loader2,
};

/** 校验不过的日期（`dirty` 的子集）：发布闸门的依据。 */
function invalidDaysOf(state: Extract<AdminState, { status: 'ready' | 'publishing' }>): string[] {
  const invalid: string[] = [];
  for (const date of state.dirty) {
    const entry = state.days[date];
    if (entry !== undefined && validateDay(entry).length > 0) invalid.push(date);
  }
  return invalid;
}

export default function AdminApp({ siteTitle }: { siteTitle: string }) {
  const [state, dispatch] = React.useReducer(adminReducer, initialAdminState);

  const dirty = hasUnsavedChanges(state);
  const view: View = deriveView(state.status, dirty);
  const publishing = state.status === 'publishing';

  const patchDay = React.useCallback(
    (day: DayEntry) => dispatch({ type: 'PATCH_DAY', day }),
    [dispatch],
  );
  const selectDay = React.useCallback(
    (date: string) => dispatch({ type: 'SELECT_DAY', date }),
    [dispatch],
  );

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
        <LoadedEditor
          state={state}
          publishing={publishing}
          patchDay={patchDay}
          selectDay={selectDay}
        />
      ) : null}
    </div>
  );
}

/** 状态徽标的小图标；取自 `VIEW_ICON`。 */
function StatusIcon({ view }: { view: View }) {
  const Icon = VIEW_ICON[view];
  return <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />;
}

/**
 * `ready` / `publishing` 的编辑器：状态栏 + 日期列表 + 当天条目。
 *
 * 顺带把两类「必须让人看见的隐患」显示出来：`loadWarnings`（仓库里存在、
 * 这次却没能载入的日期）与 `state.error`（`TOKEN_FAIL` / `PUBLISH_FAIL` 按设计
 * 都停留在 `ready` 并只挂一条错误——不显示它就成了看不见的状态）。
 */
function LoadedEditor({
  state,
  publishing,
  patchDay,
  selectDay,
}: {
  state: Extract<AdminState, { status: 'ready' | 'publishing' }>;
  publishing: boolean;
  patchDay: (day: DayEntry) => void;
  selectDay: (date: string) => void;
}) {
  const repoLabel = (() => {
    const { owner, repo, branch } = siteConfig.admin.github;
    return `${owner}/${repo}@${branch}`;
  })();

  const invalidDays = invalidDaysOf(state);
  const loadWarnings = loadWarningsOf(state);
  const error = 'error' in state ? state.error : undefined;

  return (
    <div className="flex flex-col gap-4">
      <StatusBar
        repoLabel={repoLabel}
        tokenExpiresAt={state.tokenExpiresAt}
        dirtyCount={state.dirty.size}
        errorCount={invalidDays.length}
        publishing={publishing}
        onPublish={() => {
          // Task 16 接线：PUBLISH_START → GitHub commit → PUBLISH_OK / PUBLISH_FAIL。
        }}
      />

      {/*
        仓库里存在、但这次没载入的日期必须说出来。少读了几天却只显示"读取了 N 天"，
        用户会以为那就是全部——而仓库才是唯一真相。Task 16 的发布链路应当拒绝写入这些日期。
      */}
      {loadWarnings.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-[0.8125rem] font-medium text-seal">
            有 {loadWarnings.length} 天没能载入，这些日期暂时不能编辑：
          </p>
          <ul className="flex flex-col gap-0.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
            {loadWarnings.map((warning) => (
              <li key={warning.date}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[0.8125rem] leading-relaxed text-seal">
          {error}
        </p>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
        <DayList
          days={state.days}
          selected={state.selected}
          dirty={state.dirty}
          onSelect={selectDay}
          disabled={publishing}
        />
        <EditorView
          entry={state.days[state.selected]}
          publishing={publishing}
          patchDay={patchDay}
        />
      </div>
    </div>
  );
}
