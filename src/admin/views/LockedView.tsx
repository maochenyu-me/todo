import { KeyRound, Loader2, ShieldQuestion, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { parseKdf, verifyPassword } from '@/lib/auth';

import { siteConfig } from '../../../site.config.ts';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import type { AdminAction, AdminState } from '../state/machine';

/**
 * 锁屏：口令输入 → `verifyPassword()` → `UNLOCK_OK`。
 *
 * ## 这个口令门是「界面遮挡」，不是安全边界
 *
 * 代码跑在用户自己的浏览器里，任何人都能改 JS 跳过校验。真正的保护是
 * **GitHub 令牌只存在用户自己浏览器的 localStorage 里**（见 `src/lib/auth.ts` 文件头）。
 * 所以这里不做任何"更安全"的花活：不混淆、不多轮校验、不加指纹。
 *
 * ## 两个刻意的 UI 决定
 *
 * 1. **必须有「校验中…」**：`PBKDF2-SHA256` 跑 600000 轮，在桌面浏览器上也要几百毫秒。
 *    期间按钮与输入框禁用并给出中文提示 —— 否则用户会以为点了没反应，然后连点五次。
 * 2. **`.env` 没配时给配置指引，而不是"密码错误"**：`verifyPassword()` 对畸形或缺失的
 *    `stored` 一律返回 `false`（它的契约是"永不抛异常"）。如果这里不先判断，
 *    首次部署最常见的错误（忘了配 `PUBLIC_ADMIN_PASSWORD_KDF`）会表现成
 *    「口令不正确」——一个把人引向错误方向的诊断。
 */

/** 解锁会话的 storage key。`sessionStorage`：关掉标签页就该重新输口令。 */
const UNLOCK_KEY = 'todo.unlock';

type UnlockSession = { unlockedAt: string; expiresAt: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 读会话。**任何异常都收敛成 `null`**（隐私模式下 `sessionStorage` 可能直接抛错，
 * 手工改坏的值也不该让锁屏白屏）——最坏结果只是"再输一次口令"。
 */
function readUnlockSession(): UnlockSession | null {
  try {
    const raw = window.sessionStorage.getItem(UNLOCK_KEY);
    if (raw === null || raw === '') return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const { unlockedAt, expiresAt } = parsed;
    if (typeof unlockedAt !== 'string' || typeof expiresAt !== 'string') return null;
    if (Number.isNaN(Date.parse(expiresAt))) return null;
    return { unlockedAt, expiresAt };
  } catch {
    return null;
  }
}

function clearUnlockSession(): void {
  try {
    window.sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    // 忽略：清不掉最多是多输一次口令。
  }
}

/** 写入会话：`expiresAt` = 现在 + `siteConfig.admin.sessionMinutes` 分钟。 */
function writeUnlockSession(now: number): UnlockSession {
  const session: UnlockSession = {
    unlockedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + siteConfig.admin.sessionMinutes * 60_000).toISOString(),
  };
  try {
    window.sessionStorage.setItem(UNLOCK_KEY, JSON.stringify(session));
  } catch {
    // 存不进去（隐私模式/配额满）不阻止本次解锁，只是刷新后要再输一次。
  }
  return session;
}

export type LockedViewProps = {
  state: Extract<AdminState, { status: 'locked' }>;
  dispatch: React.Dispatch<AdminAction>;
};

export function LockedView({ state, dispatch }: LockedViewProps) {
  // `.env` 的派生值在构建时被内联进来；缺席时是 `undefined`（不是空字符串）。
  const storedKdf = (import.meta.env.PUBLIC_ADMIN_PASSWORD_KDF ?? '').trim();

  // 三种配置状态，必须分开处理——它们的"下一步"完全不同：
  // - `missing`：还没配（首次部署）。
  // - `malformed`：配了，但值解析不出 `pbkdf2$<轮数>$<salt>$<hash>`。
  //   最常见的原因就是把 `gen-password` 的**未转义**输出粘进了 `.env`：
  //   dotenv 会把 `$600000` / `$<salt>` / `$<hash>` 当变量展开成空串，
  //   整串于是塌成 `pbkdf2`。这一点必须说出来，否则用户只会看到"口令不正确"，
  //   然后一直在猜自己记错了密码。
  // - `configured`：形状合法，可以进入校验。
  const missing = storedKdf === '';
  const malformed = !missing && parseKdf(storedKdf) === null;
  const configured = !missing && !malformed;

  const [password, setPassword] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const errorId = React.useId();

  // 挂载时：本机已有未过期的解锁会话，且站点不要求刷新重输口令 → 直接放行。
  // 依赖数组只放 `dispatch`（`useReducer` 的 dispatch 恒定），所以只跑一次。
  React.useEffect(() => {
    if (!configured) return;
    const session = readUnlockSession();
    if (!session) return;
    if (Date.now() >= Date.parse(session.expiresAt)) {
      // 过期的会话留着只会让人以为"明明登录过"，顺手清掉。
      clearUnlockSession();
      return;
    }
    if (!siteConfig.admin.requirePasswordOnRefresh) dispatch({ type: 'UNLOCK_OK' });
  }, [configured, dispatch]);

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!configured || pending) return;
    if (password === '') {
      dispatch({ type: 'UNLOCK_FAIL', message: '请先输入口令' });
      inputRef.current?.focus();
      return;
    }

    setPending(true);
    // `verifyPassword` 永不抛异常：畸形配置、缺 WebCrypto 都收敛成 `false`。
    const ok = await verifyPassword(password, storedKdf);
    setPending(false);

    if (!ok) {
      dispatch({ type: 'UNLOCK_FAIL', message: '口令不正确，请重新输入' });
      setPassword(''); // 清空输入框：让用户从头敲，而不是在错误的口令上改
      inputRef.current?.focus();
      return;
    }

    writeUnlockSession(Date.now());
    dispatch({ type: 'UNLOCK_OK' });
  }

  if (malformed) {
    // 值存在但解析不出四段。最常见的原因见上方注释：未转义的 `$` 被 dotenv 吃掉。
    // 这里**不能**退化成「口令不正确」——那会把用户引向"我是不是记错密码了"，
    // 而真正的修复动作是重新粘贴一行配置。
    const preview = storedKdf.length > 120 ? `${storedKdf.slice(0, 120)}…` : storedKdf;
    return (
      <section
        aria-labelledby="admin-view-title"
        className="flex flex-col items-start gap-3 rounded-[var(--radius)] border border-border bg-card px-5 py-6"
      >
        <h2 id="admin-view-title" className="flex items-center gap-2 text-[1.0625rem] font-semibold">
          <TriangleAlert className="size-4 text-seal" strokeWidth={1.75} aria-hidden="true" />
          口令配置的值不完整
        </h2>
        <p className="max-w-[42rem] text-[0.9375rem] leading-relaxed text-muted-foreground">
          <code className="mr-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
            PUBLIC_ADMIN_PASSWORD_KDF
          </code>
          现在解析不出合法的派生值。它应该是四段
          <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
            pbkdf2$轮数$salt$hash
          </code>
          ，所以在这修好之前谁都进不来。
        </p>

        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
          <li>
            <strong className="font-medium text-foreground">最可能的原因：粘贴了没转义的那一行。</strong>
            <code className="mr-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
              .env
            </code>
            会把 <code className="text-[0.8125rem]">$600000</code>、
            <code className="mx-1 text-[0.8125rem]">$salt</code>、
            <code className="mx-1 text-[0.8125rem]">$hash</code>
            当成变量名展开成空串，整串于是塌成
            <code className="mx-1 text-[0.8125rem]">pbkdf2</code>
            —— 口令自然永远校验不过，而且看不出原因。
          </li>
          <li>
            <strong className="font-medium text-foreground">另一种可能：</strong>
            值里还留着
            <code className="mx-1 text-[0.8125rem]">.env.example</code>
            的占位符（
            <code className="text-[0.8125rem]">&lt;base64-salt&gt;</code> 之类）。
          </li>
        </ul>

        <p className="max-w-[42rem] text-[0.9375rem] leading-relaxed text-muted-foreground">
          修复：重新运行
          <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
            npm run gen-password
          </code>
          ，把输出的<strong className="font-medium text-foreground">那一整行原样</strong>
          粘贴进根目录的
          <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
            .env
          </code>
          （其中的 <code className="text-[0.8125rem]">$</code> 已经写成
          <code className="mx-1 text-[0.8125rem]">\$</code>
          ，反斜杠会在加载时被还原），然后重新构建或重启
          <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
            npm run dev
          </code>
          。
        </p>

        <p className="max-w-[42rem] break-all text-[0.8125rem] leading-relaxed text-muted-foreground">
          当前读到的值（截断显示，用来确认症状）：
          <code className="ml-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
            {preview}
          </code>
        </p>
      </section>
    );
  }

  if (!configured) {
    return (
      <section
        aria-labelledby="admin-view-title"
        className="flex flex-col items-start gap-3 rounded-[var(--radius)] border border-border bg-card px-5 py-6"
      >
        <h2 id="admin-view-title" className="flex items-center gap-2 text-[1.0625rem] font-semibold">
          <ShieldQuestion className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          还没配置管理员口令
        </h2>
        <p className="max-w-[42rem] text-[0.9375rem] leading-relaxed text-muted-foreground">
          本站的登录框只认
          <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
            .env
          </code>
          里的 PBKDF2 派生值，而现在这个值是空的。按下面三步配一次：
        </p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
          <li>
            在项目根目录运行
            <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
              npm run gen-password
            </code>
            ，按提示输入口令，脚本会输出一行派生值（明文密码不落盘）。
          </li>
          <li>
            把输出的那一整行原样粘贴进根目录的
            <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
              .env
            </code>
            （没有就复制
            <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
              .env.example
            </code>
            ）：
            <code className="mt-1 block rounded-[var(--radius)] border border-border px-2 py-1 text-[0.8125rem]">
              PUBLIC_ADMIN_PASSWORD_KDF=pbkdf2\$600000\$…\$…
            </code>
            <span className="mt-1 block">
              值里的 <code className="text-[0.8125rem]">\$</code> 是必须的转义：
              <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
                .env
              </code>
              会把
              <code className="mx-1 text-[0.8125rem]">$名字</code>
              当变量展开，不转义就会把派生值吃掉。脚本输出的已经是转义好的形式。
            </span>
          </li>
          <li>
            重新构建（或重启
            <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
              npm run dev
            </code>
            ）后刷新本页。
          </li>
        </ol>
        <p className="max-w-[42rem] text-[0.8125rem] leading-relaxed text-muted-foreground">
          <code className="mr-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
            .env
          </code>
          已在
          <code className="mx-1 rounded-[var(--radius)] border border-border px-1 text-[0.8125rem]">
            .gitignore
          </code>
          里：派生值会随站点一起公开（这是有意的取舍），但配置文件本身不进仓库。
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="admin-view-title"
      className="flex flex-col items-start gap-4 rounded-[var(--radius)] border border-border bg-card px-5 py-6"
    >
      <h2 id="admin-view-title" className="flex items-center gap-2 text-[1.0625rem] font-semibold">
        <KeyRound className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        输入管理员口令
      </h2>
      <p className="max-w-[42rem] text-[0.9375rem] leading-relaxed text-muted-foreground">
        口令只用来遮挡界面，校验在这台浏览器里完成；解锁后的数据要从你自己的 GitHub 仓库现读。
      </p>

      {/* 用 <form>：回车即可提交，不需要额外挂键盘事件。 */}
      <form className="flex w-full max-w-sm flex-col gap-3" onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-password">口令</Label>
          <Input
            id="admin-password"
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            autoFocus
            disabled={pending}
            value={password}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? errorId : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {state.error ? (
          // `role="alert"`：读屏软件会在错误出现的同一刻念出来，而不是等用户找回焦点。
          <p id={errorId} role="alert" className="text-[0.8125rem] text-seal">
            {state.error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                校验中…
              </>
            ) : (
              '解锁'
            )}
          </Button>
          <span aria-live="polite" className="text-[0.8125rem] text-muted-foreground">
            {pending ? '正在校验口令，请稍候…' : ''}
          </span>
        </div>
      </form>
    </section>
  );
}

/** 仅供测试与其它视图复用：清掉本机的解锁会话。 */
export { clearUnlockSession, readUnlockSession, UNLOCK_KEY };
