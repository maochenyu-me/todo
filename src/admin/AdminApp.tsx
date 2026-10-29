import { CheckCircle2, CloudOff, Loader2, Lock, PencilLine } from 'lucide-react';
import * as React from 'react';

import { todayInZone } from '@/lib/date';
import { GitHubError, type GitHubClient } from '@/lib/github';
import { validateDay } from '@/lib/validate';
import type { DayEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

import { siteConfig } from '../../site.config.ts';
import { DayList } from './components/DayList';
import { StatusBar } from './components/StatusBar';
import { activeClient } from './client-holder';
import {
  buildCommitMessage,
  buildPublishPayload,
  type PublishPayload,
} from './publish';
import {
  adminReducer,
  hasUnsavedChanges,
  initialAdminState,
  loadWarningsOf,
  type AdminAction,
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
 * 挡住并列出原因（坏数据一旦发布，公开页面就得吃下它）。`onPublish` 的链路：
 * 状态收窄 → 校验/loadWarnings 双闸 → `PUBLISH_START` → `buildPublishPayload`
 * （纯函数，见 `./publish.ts`）→ `commitChanges` → `PUBLISH_OK`（清 dirty、记下
 * commit 链接）/ `PUBLISH_FAIL`（改动原样保留、红条提示）。client 由 `ConnectView`
 * 验证令牌后放进 `./client-holder.ts` 的模块单例——reducer 保持纯函数，不碰网络。
 *
 * ## 数据为什么不可能从构建产物里漏出来
 *
 * `disconnected` 这个状态变体里**没有 `days` 字段**。数据唯一来源是 `ConnectView`
 * 调 `client.getFile()` 从 GitHub 仓库现读；读到了才能 `TOKEN_OK` 拿到 `ready`。
 * 构建时读的那份 `src/data/` 快照只喂给公开页面，后台一眼都看不到。
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
          dispatch={dispatch}
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
 * 顺带把三类「必须让人看见的隐患」显示出来：`loadWarnings`（仓库里存在、
 * 这次却没能载入的日期）、`state.error`（`TOKEN_FAIL` / `PUBLISH_FAIL` 按设计
 * 都停留在 `ready` 并只挂一条错误——不显示它就成了看不见的状态）、以及
 * `lastCommit`（发布成功的 commit 链接，来自模块单例 client 的返回值）。
 */
function LoadedEditor({
  state,
  publishing,
  patchDay,
  selectDay,
  dispatch,
}: {
  state: Extract<AdminState, { status: 'ready' | 'publishing' }>;
  publishing: boolean;
  patchDay: (day: DayEntry) => void;
  selectDay: (date: string) => void;
  dispatch: React.Dispatch<AdminAction>;
}) {
  const { owner, repo, branch, commitMessage, authorName, authorEmail } = siteConfig.admin.github;
  const repoLabel = `${owner}/${repo}@${branch}`;

  /** 最近一次发布成功的 commit（htmlUrl 渲染成链接）。新一次发布开始 / 失败即清空。 */
  const [lastCommit, setLastCommit] = React.useState<{ sha: string; htmlUrl: string } | null>(null);

  const invalidDays = invalidDaysOf(state);
  const loadWarnings = loadWarningsOf(state);
  const error = 'error' in state ? state.error : undefined;

  const onPublish = React.useCallback(() => {
    if (state.status !== 'ready') return;
    // 第二道校验闸：按钮的 disabled 只是界面约束，真正的拦截在这里——
    // 有未过校验的天时宁可原地报错，也绝不把坏数据发出去。
    if (invalidDays.length > 0) {
      dispatch({
        type: 'PUBLISH_FAIL',
        message: `${invalidDays.length} 天未通过校验（${invalidDays.join('、')}），修正后才能发布`,
      });
      return;
    }
    // 第三道闸：loadWarnings 的日期拒绝写入（覆盖读不出来的文件就是丢数据）。
    // buildPublishPayload 是纯函数，在这里同步跑完；抛错就停在 ready，不进 publishing。
    const todayKey = todayInZone(siteConfig.site.timeZone);
    let payload: PublishPayload;
    try {
      payload = buildPublishPayload({
        days: state.days,
        dirty: state.dirty,
        todayKey,
        dataCfg: { activeDir: siteConfig.data.activeDir, archiveDir: siteConfig.data.archiveDir },
        afterMonths: siteConfig.data.archiveAfterMonths,
        unavailableDates: new Set(loadWarnings.map((warning) => warning.date)),
      });
    } catch (caught) {
      dispatch({
        type: 'PUBLISH_FAIL',
        message: caught instanceof Error ? caught.message : String(caught),
      });
      return;
    }

    let client: GitHubClient;
    try {
      client = activeClient();
    } catch (caught) {
      dispatch({
        type: 'PUBLISH_FAIL',
        message: caught instanceof Error ? caught.message : String(caught),
      });
      return;
    }

    setLastCommit(null);
    dispatch({ type: 'PUBLISH_START' });
    client
      .commitChanges({
        writes: payload.writes,
        deletes: payload.deletes,
        message: buildCommitMessage(commitMessage, todayKey, payload.summary),
        authorName,
        authorEmail,
      })
      .then((result) => {
        dispatch({ type: 'PUBLISH_OK' });
        setLastCommit({ sha: result.commitSha, htmlUrl: result.htmlUrl });
      })
      .catch((caught) => {
        // GitHubError 的消息已是完整中文句子（操作 + 状态码 + 处置建议），直接用；
        // 其余异常（真 bug）才包一层「发布失败：」。
        const message =
          caught instanceof GitHubError
            ? caught.message
            : `发布失败：${caught instanceof Error ? caught.message : String(caught)}`;
        dispatch({ type: 'PUBLISH_FAIL', message });
      });
  }, [state, invalidDays.length, loadWarnings, dispatch, commitMessage, authorName, authorEmail]);

  return (
    <div className="flex flex-col gap-4">
      <StatusBar
        repoLabel={repoLabel}
        tokenExpiresAt={state.tokenExpiresAt}
        dirtyCount={state.dirty.size}
        errorCount={invalidDays.length}
        publishing={publishing}
        onPublish={onPublish}
      />

      {lastCommit !== null ? (
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground" data-testid="last-commit">
          已发布{' '}
          <a
            href={lastCommit.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-2 hover:text-primary"
          >
            提交 {lastCommit.sha.slice(0, 7)}
          </a>
        </p>
      ) : null}

      {/*
        仓库里存在、但这次没载入的日期必须说出来。少读了几天却只显示"读取了 N 天"，
        用户会以为那就是全部——而仓库才是唯一真相。这些日期同时进 buildPublishPayload
        的 unavailableDates：dirty 若混进它们，发布在本地就被拒绝。
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
