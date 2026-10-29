import { GitBranch, KeyRound, Loader2, Send } from 'lucide-react';

import { Button } from './ui/button';

/**
 * 状态栏：发布闸门的可见形态。
 *
 * 显示四样东西：目标仓库、令牌有效期、未保存改动的天数、「保存并发布」按钮。
 * 按钮在三种情况下 `disabled`：正在发布、没有未保存改动、有未通过校验的天——
 * 前两个是"没东西可发"，最后一个是"发了会写坏数据"，三者对用户是不同的话，
 * 所以校验失败时另给一句提示而不是只把按钮变灰。
 *
 * `onPublish` 背后是完整发布链路（`PUBLISH_START` → `buildPublishPayload` →
 * `commitChanges` → `PUBLISH_OK`/`FAIL`），接线在 `AdminApp.tsx`；本组件只负责
 * disabled 逻辑与回调，不关心回调背后是什么。
 */

export type StatusBarProps = {
  /** 形如 `owner/repo@branch`。 */
  repoLabel: string;
  /** 令牌过期时刻（ISO 字符串）；`null` 表示未知（比如令牌没有过期时间）。 */
  tokenExpiresAt: string | null;
  /** 有未保存改动的天数（`dirty.size`）。 */
  dirtyCount: number;
  /** 未通过校验的天数；大于 0 时发布必须被挡住。 */
  errorCount: number;
  publishing: boolean;
  onPublish: () => void;
};

export function StatusBar({
  repoLabel,
  tokenExpiresAt,
  dirtyCount,
  errorCount,
  publishing,
  onPublish,
}: StatusBarProps) {
  const blocked = publishing || dirtyCount === 0 || errorCount > 0;

  return (
    <section
      aria-label="发布状态"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[var(--radius)] border border-border bg-card px-4 py-3 text-[0.8125rem] text-muted-foreground"
    >
      <span className="inline-flex items-center gap-1.5">
        <GitBranch className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        <code className="rounded-[var(--radius)] border border-border px-1 text-[0.8125rem] text-foreground">
          {repoLabel}
        </code>
      </span>

      <span className="inline-flex items-center gap-1.5">
        <KeyRound className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        {tokenExpiresAt !== null ? `令牌有效期至 ${tokenExpiresAt.slice(0, 10)}` : '令牌有效期未知'}
      </span>

      {/* data-testid 给自动化测试读改动数用，不参与样式。 */}
      <span data-testid="unsaved-changes" className="inline-flex items-center gap-1.5">
        {dirtyCount > 0 ? (
          <>
            <span className="size-1.5 rounded-full bg-seal" aria-hidden="true" />
            <span className="font-medium text-foreground">{dirtyCount} 天有未保存改动</span>
          </>
        ) : (
          '没有未保存的改动'
        )}
      </span>

      {dirtyCount > 0 && errorCount > 0 ? (
        <span className="text-seal">{errorCount} 天未通过校验，修正后才能发布</span>
      ) : null}

      <Button size="sm" className="ml-auto" disabled={blocked} onClick={onPublish}>
        {publishing ? (
          <>
            <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
            发布中…
          </>
        ) : (
          <>
            <Send className="size-4" strokeWidth={1.75} aria-hidden="true" />
            保存并发布
          </>
        )}
      </Button>
    </section>
  );
}
