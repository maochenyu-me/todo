import { CloudOff, KeyRound, Loader2, PlugZap, Trash2 } from 'lucide-react';
import * as React from 'react';

import { isValidDateKey, todayInZone } from '@/lib/date';
import { parseEntry } from '@/lib/entry-codec';
import { createGitHubClient, GitHubError, type GitHubClient, type GitHubConfig } from '@/lib/github';
import type { DayEntry } from '@/lib/types';

import { siteConfig } from '../../../site.config.ts';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { setActiveClient } from '../client-holder';
import type { AdminAction, AdminState } from '../state/machine';

/**
 * 连接页：把一条 fine-grained PAT 换成「已连接的仓库」。
 *
 * ## 数据只能来自仓库
 *
 * 这里的 `listDataPaths()` + `getFile()` 是后台**唯一**的数据入口。构建产物里虽然也有
 * 一份数据（Astro 在构建时读了 `src/data/`），但那只是某一刻的快照——后台如果读它，
 * 就会出现"网页上是旧的、仓库里是新的"这种双真相。所以：连不上就什么都看不到
 * （`disconnected` 状态里根本没有 `days` 字段）。
 *
 * ## 令牌去哪了
 *
 * 只进 `localStorage["todo.gh.token"]`，只在本机浏览器里。不进 URL、不进日志、
 * 不进错误消息——错误消息里的令牌会被 `scrubToken()` 抹掉，这是最后一道保险。
 *
 * ## 为什么「验证通过才落盘」
 *
 * 一个连不上仓库的令牌留在本机，只会让下次打开页面时白等一轮验证再报错。
 *
 * ## 为什么只读活跃区
 *
 * `listDataPaths()` 会同时给出活跃区（最近几个月的）和归档区（更早的）路径。
 * 后台编辑的是**活跃窗口**，归档区是只读历史，所以这里只取活跃区的文件内容，
 * 外加"今天"那一天（万一站点闲置久了，今天已经在归档区）。否则要为一堆历史文件
 * 各发一次 Contents API 请求，连接等待时间会随站点年龄线性增长。
 */

/** 令牌的 storage key。`localStorage`：关掉浏览器再回来还能连。 */
const TOKEN_KEY = 'todo.gh.token';

/** 并发读取的请求数：GitHub 对突发请求不友好，但串行又要等太久。 */
const LOAD_CONCURRENCY = 6;

type Progress = { done: number; total: number };

function readStoredToken(): string | null {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    if (raw === null) return null;
    const token = raw.trim();
    return token === '' ? null : token;
  } catch {
    // 隐私模式/被禁用的 localStorage：当作"没有存过令牌"。
    return null;
  }
}

function saveStoredToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 存不进去不影响本次连接，只是下次要重新粘贴。
  }
}

function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 忽略。
  }
}

/** 仓库相对路径 → 日期 key（`src/data/todos/2026-10-28.json` → `2026-10-28`）。 */
function dateKeyOfPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dateKey = name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
  return isValidDateKey(dateKey) ? dateKey : null;
}

/** 把令牌从任何要展示/上报的字符串里抹掉（令牌不该出现在消息里，这是保险）。 */
function scrubToken(message: string, token: string): string {
  if (token === '' || !message.includes(token)) return message;
  return message.split(token).join('（令牌已隐藏）');
}

/**
 * 把异常翻译成一句能指导下一步的中文。
 *
 * `GitHubError.status === null` 表示**根本没连上**（断网、DNS、代理拦截），
 * 这时不该把 `Failed to fetch` 原样丢给用户。
 */
function readableFailure(what: string, error: unknown): string {
  if (error instanceof GitHubError) {
    if (error.status === null) {
      return `${what}失败：连不上 GitHub（网络中断或被拦截），请检查网络后重试`;
    }
    // 带状态码的 `GitHubError` 消息本身已经是完整中文句子（操作名 + 状态码 + 处置建议），
    // 再套一层「${what}失败：」会变成"验证令牌失败：验证仓库访问权限失败（HTTP 500）…"。
    return error.message;
  }
  const reason = error instanceof Error && error.message !== '' ? error.message : String(error);
  return `${what}失败：${reason}`;
}

/** 限并发地跑完一组异步任务（保持仓库读取不把浏览器与 API 限流一起打爆）。 */
async function forEachWithLimit<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  const size = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  const workers = Array.from({ length: size }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await run(items[index]!);
    }
  });
  await Promise.all(workers);
}

export type ConnectViewProps = {
  state: Extract<AdminState, { status: 'disconnected' }>;
  dispatch: React.Dispatch<AdminAction>;
  /**
   * 客户端工厂，**只为测试注入**（默认 `createGitHubClient`）。
   * 浏览器里没有真令牌时，用它接一个假的 GitHub 就能把成功路径也走一遍。
   */
  createClient?: (cfg: GitHubConfig) => GitHubClient;
};

export function ConnectView({ state, dispatch, createClient = createGitHubClient }: ConnectViewProps) {
  const { owner, repo, branch, apiBase } = siteConfig.admin.github;
  const repoLabel = `${owner}/${repo}@${branch}`;

  const [token, setToken] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [progress, setProgress] = React.useState<Progress | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [storedTokenPresent, setStoredTokenPresent] = React.useState(false);
  // 用例/浏览器测试脚本靠它读"连接进度"，也方便以后接进度条。
  const errorId = React.useId();
  const tokenRef = React.useRef<HTMLInputElement>(null);
  // 上面存过的令牌只在挂载时自动试一次（重渲染不该反复发请求）。
  const autoTried = React.useRef(false);

  const connect = React.useCallback(
    async (rawToken: string) => {
      const candidate = rawToken.trim();
      if (candidate === '') {
        dispatch({ type: 'TOKEN_FAIL', message: '请先粘贴 GitHub 令牌' });
        tokenRef.current?.focus();
        return;
      }

      setPending(true);
      setWarnings([]);
      setProgress(null);
      // 记录失败的日期，用于决定"全挂了"还是"部分缺"。
      const failures: string[] = [];

      try {
        let client: GitHubClient;
        try {
          client = createClient({ token: candidate, owner, repo, branch, apiBase });
        } catch (error) {
          dispatch({ type: 'TOKEN_FAIL', message: scrubToken(readableFailure('创建连接', error), candidate) });
          return;
        }

        // `verify()` 只对 401/403/404 返回 `ok: false`，5xx 与网络故障**抛错**。
        let expiresAt: string | null = null;
        try {
          const verified = await client.verify();
          if (!verified.ok) {
            dispatch({
              type: 'TOKEN_FAIL',
              message: scrubToken(verified.message ?? '这个令牌访问不了仓库，请检查权限', candidate),
            });
            return;
          }
          expiresAt = verified.expiresAt;
        } catch (error) {
          dispatch({ type: 'TOKEN_FAIL', message: scrubToken(readableFailure('验证令牌', error), candidate) });
          return;
        }

        // 验证通过 → 令牌才值得留在本机。
        saveStoredToken(candidate);
        setStoredTokenPresent(true);
        // client 与令牌走同一条交接路径：后续「保存并发布」用的就是刚验证过的这个。
        setActiveClient(client);

        const paths = await client.listDataPaths();
        const todayKey = todayInZone(siteConfig.site.timeZone);
        const activeDates = paths.active
          .map(dateKeyOfPath)
          .filter((key): key is string => key !== null);
        // 活跃区全读 + 今天（站点闲置很久时今天可能已经归档）
        const wanted = new Set(activeDates);
        for (const path of paths.archive) {
          if (dateKeyOfPath(path) === todayKey) wanted.add(todayKey);
        }
        const dates = [...wanted].sort();

        const days: Record<string, DayEntry> = {};
        setProgress({ done: 0, total: dates.length });

        const pathOf = new Map<string, string>();
        for (const path of [...paths.active, ...paths.archive]) {
          const key = dateKeyOfPath(path);
          if (key !== null && !pathOf.has(key)) pathOf.set(key, path);
        }

        await forEachWithLimit(dates, LOAD_CONCURRENCY, async (dateKey) => {
          const path = pathOf.get(dateKey);
          if (path === undefined) return;
          try {
            const file = await client.getFile(path);
            // `null` = 这期间文件被删了：不是错误，跳过。
            if (file !== null) {
              const parsed = parseEntry(file.content, dateKey);
              if (parsed.ok) days[dateKey] = parsed.entry;
              else failures.push(`${dateKey}：${parsed.errors[0] ?? '格式不符合数据文件规范'}`);
            }
          } catch (error) {
            failures.push(`${dateKey}：${scrubToken(readableFailure('读取', error), candidate)}`);
          }
          setProgress((prev) => (prev === null ? prev : { done: prev.done + 1, total: prev.total }));
        });

        // 一个都没读出来 = 这次连接其实没成功（令牌中途失效、仓库空了、全被拒）。
        if (dates.length > 0 && Object.keys(days).length === 0) {
          dispatch({
            type: 'TOKEN_FAIL',
            message: scrubToken(
              `连上了仓库，但一份数据文件都没读出来：${failures[0] ?? '仓库里没有 data 文件'}`,
              candidate,
            ),
          });
          return;
        }

        /*
         * 仓库里**一个数据文件都没有**（第一次使用 / 清库之后）：合成「今天的空白页」，
         * 否则 `TOKEN_OK` 会因为 `days` 为空而被 reducer 拒绝，界面永远停在未连接——
         * 连"新建第一天"的入口都到不了。
         *
         * 为什么不标 dirty：这是**占位**，不是改动。用户写了第一条待办才会 `PATCH_DAY`
         * 变脏，发布链路也只写 dirty 的日期，所以不会凭空在仓库里建出一个空文件。
         * 注意这里只覆盖"零个文件"的情形；有文件但全部读不出来时仍然报错（覆盖即丢数据）。
         */
        if (dates.length === 0) {
          days[todayKey] = { date: todayKey, tasks: [] };
        }

        setWarnings(failures);
        setToken('');
        // `selected` 由 reducer 从 `days` 派生（`todayKey` 只是"希望优先选中哪天"）：
        // 选中的那天必须真的载入了，否则编辑器会把仓库里那份读不出来的文件当成空白一天覆盖掉。
        // `failures` 也一并带上：它们在 `ready` 里必须继续可见，否则"少读了几天"会彻底静默。
        dispatch({
          type: 'TOKEN_OK',
          days,
          todayKey,
          tokenExpiresAt: expiresAt,
          loadWarnings: failures.map((message) => ({
            date: message.slice(0, message.indexOf('：')),
            message,
          })),
        });
      } catch (error) {
        // `listDataPaths()` 之类的失败（含目录树被截断、5xx、网络中断）。
        dispatch({ type: 'TOKEN_FAIL', message: scrubToken(readableFailure('读取仓库数据', error), candidate) });
      } finally {
        setPending(false);
        setProgress(null);
      }
    },
    [apiBase, branch, createClient, dispatch, owner, repo],
  );

  // 挂载时：本机存过令牌就自动试一次（省掉每次打开都要粘贴）。
  React.useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    const stored = readStoredToken();
    if (stored === null) return;
    setStoredTokenPresent(true);
    void connect(stored);
  }, [connect]);

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;
    void connect(token);
  }

  function handleClear(): void {
    clearStoredToken();
    // client 里还留着旧令牌的引用，断开时必须一并清掉。
    setActiveClient(null);
    setStoredTokenPresent(false);
    setWarnings([]);
    setToken('');
    dispatch({ type: 'CLEAR_TOKEN' });
  }

  return (
    <section
      aria-labelledby="admin-view-title"
      className="flex flex-col items-start gap-4 rounded-[var(--radius)] border border-border bg-card px-5 py-6"
    >
      <h2 id="admin-view-title" className="flex items-center gap-2 text-[1.0625rem] font-semibold">
        <CloudOff className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        连接 GitHub 仓库
      </h2>

      <p className="max-w-[42rem] text-[0.9375rem] leading-relaxed text-muted-foreground">
        后台的数据<strong className="font-medium text-foreground">只从你的 GitHub 仓库读</strong>
        ，连接之前这里看不到任何一天的内容。目标仓库：
        <code className="rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">{repoLabel}</code>
      </p>

      <div className="flex w-full max-w-[42rem] flex-col gap-2 rounded-[var(--radius)] border border-border px-4 py-3">
        <p className="flex items-center gap-1.5 text-[0.875rem] font-medium">
          <KeyRound className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          需要一条 fine-grained（细粒度）令牌
        </p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[0.875rem] leading-relaxed text-muted-foreground">
          <li>
            GitHub → Settings → Developer settings → Personal access tokens →
            <span className="whitespace-nowrap"> Fine-grained tokens</span> → 生成新令牌。
          </li>
          <li>
            <strong className="font-medium text-foreground">Repository access</strong> 只勾这一个仓库：
            <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">{repo}</code>
            （不要选 All repositories）。
          </li>
          <li>
            <strong className="font-medium text-foreground">Permissions</strong> 里只给
            <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
              Contents: Read and write
            </code>
            —— 读写数据文件只此一项，多给的权限都是多余的。
          </li>
        </ol>
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          令牌只保存在<strong className="font-medium text-foreground">这台浏览器</strong>的 localStorage
          里，不会进入仓库、不会进入站点源码，
          也不会出现在地址栏或错误提示里。换一台设备要重新粘贴一次。
        </p>
      </div>

      <form className="flex w-full max-w-sm flex-col gap-3" onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-github-token">访问令牌</Label>
          <Input
            id="admin-github-token"
            ref={tokenRef}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={storedTokenPresent ? '本机已保存令牌，粘贴新的可替换' : 'github_pat_…'}
            disabled={pending}
            value={token}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? errorId : undefined}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>

        {state.error ? (
          <p id={errorId} role="alert" className="text-[0.8125rem] leading-relaxed text-seal">
            {state.error}
          </p>
        ) : null}

        {warnings.length > 0 ? (
          <ul className="flex flex-col gap-1 text-[0.8125rem] leading-relaxed text-seal">
            {warnings.slice(0, 5).map((warning) => (
              <li key={warning}>没能载入 {warning}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                正在验证…
              </>
            ) : (
              <>
                <PlugZap className="size-4" strokeWidth={1.75} aria-hidden="true" />
                验证并连接
              </>
            )}
          </Button>
          {storedTokenPresent ? (
            <Button type="button" variant="outline" disabled={pending} onClick={handleClear}>
              <Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
              清除令牌
            </Button>
          ) : null}
          <span aria-live="polite" className="text-[0.8125rem] text-muted-foreground">
            {pending
              ? progress === null
                ? '正在验证令牌…'
                : `正在读取数据文件 ${progress.done}/${progress.total}…`
              : ''}
          </span>
        </div>
      </form>
    </section>
  );
}

/** 仅供测试复用：读/清本机保存的令牌（都不会把令牌写进日志）。 */
export { readStoredToken, TOKEN_KEY };
