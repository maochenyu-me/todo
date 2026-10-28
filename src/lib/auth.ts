/**
 * 管理员密码的**校验**逻辑（纯浏览器可用）。
 *
 * 铁律：本文件**不得 import 任何 `node:*` 模块**（`auth.test.ts` 里有守卫测试）。
 * 它会被 Vite 打进客户端 bundle —— 后台登录框要在浏览器里校验密码。
 * 只用 WebCrypto（`globalThis.crypto.subtle`），Node ≥ 20 同样有，所以测试与浏览器跑同一份代码。
 *
 * ## 安全模型（后来者请先读完这段，再决定要不要"改进"）
 *
 * 1. `.env` 里**只有派生值** `pbkdf2$<iterations>$<b64salt>$<b64hash>`，永远不存明文密码。
 *    派生由 `scripts/gen-password.mjs` 离线完成，构建时通过 `PUBLIC_ADMIN_PASSWORD_KDF`
 *    （`PUBLIC_` 前缀 = Astro 会把它公开进 bundle，这是本设计有意的取舍）注入。
 * 2. PBKDF2-SHA256，**600000 轮**，随机 16 字节 salt，32 字节 hash。
 *    600k 轮让"拿到 bundle 后离线穷举"变得昂贵；单次 SHA-256 几秒就能反查，绝不可取。
 *    轮数从 `stored` 字符串里读，不写死 —— 将来调参不必改代码。
 * 3. **这个密码门是「界面遮挡」，不是安全边界。** 代码在用户机器上，任何人都能
 *    改 JS、跳过校验、直接调后台接口。真正的保护是：GitHub token 只存在
 *    用户**自己**浏览器的 localStorage 里，从不进仓库、不进站点源码。
 *    所以不要在这里加"更安全"的复杂度（混淆、多轮校验、指纹）——那是假安全感。
 */

/** 解析结果。`hash.length` 决定 `deriveBits` 的位数，所以不单独存。 */
export type KdfParams = {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
};

/**
 * 只用「按 4 对齐 + 末尾 0~2 个 `=`」这一种规范形式的 base64。
 * 宽松解码（无 padding、URL-safe、空白）会让同一个值有多种写法，
 * 也容易把 `abc` 这种半截串当合法值放过去。
 */
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** 迭代数只接受十进制正整数，且必须是安全整数。`0` / 负数 / `1.5` / `1e6` 全部拒绝。 */
const ITERATIONS_RE = /^[1-9][0-9]*$/;

const ALGORITHM = 'pbkdf2';

/** 分块大小：一次性 `String.fromCharCode(...20 万个参数)` 会爆栈，所以按块拼。 */
const CHUNK = 8192;

/** `Uint8Array` → 标准 base64。浏览器（`btoa`）与 Node（全局 `btoa`）都走这条路径。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 标准 base64 → `Uint8Array`；非法输入返回 `null`（不抛异常）。
 *
 * 先做正则白名单校验，再 `atob`：`atob` 对非规范输入的行为在各环境略有差异，
 * 而 `parseKdf` 的返回值是"可信或拒绝"，不能有模糊地带。
 */
export function base64ToBytes(text: string): Uint8Array | null {
  if (!BASE64_RE.test(text)) return null;
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 解析 `.env` 里的 `pbkdf2$<iterations>$<b64salt>$<b64hash>`。
 * **任何畸形输入一律返回 `null`，绝不抛异常** —— 调用方（登录框）不该因为
 * 配置写错就白屏，只该"谁都进不去"。
 */
export function parseKdf(stored: string): KdfParams | null {
  if (typeof stored !== 'string') return null;
  // `.env` 粘贴进来常带尾随换行/空格，这里容忍首尾空白（只此一项宽容）。
  const parts = stored.trim().split('$');
  if (parts.length !== 4) return null;

  const [algorithm, rawIterations, rawSalt, rawHash] = parts as [string, string, string, string];
  if (algorithm !== ALGORITHM) return null;

  if (!ITERATIONS_RE.test(rawIterations)) return null;
  const iterations = Number(rawIterations);
  if (!Number.isSafeInteger(iterations) || iterations <= 0) return null;

  if (rawSalt === '' || rawHash === '') return null;
  const salt = base64ToBytes(rawSalt);
  const hash = base64ToBytes(rawHash);
  if (!salt || salt.length === 0) return null;
  if (!hash || hash.length === 0) return null;

  return { iterations, salt, hash };
}

/**
 * 定长时间比较两个字节数组。
 *
 * **长度先比、不等立刻 `false` 是有意的**：待比较的是 PBKDF2 派生的 hash，
 * 长度由我们自己写进 `.env`（固定 32 字节），不携带任何秘密；
 * 攻击者就算知道长度也只学到"hash 是 32 字节"。真正的秘密在内容里，
 * 所以内容部分严格逐字节异或累积、**没有任何提前退出**。
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * 校验密码。`subtle` 只为测试可注入而存在，默认取全局 WebCrypto。
 *
 * `iterations` **一律从 `stored` 读**，不写死 600000：测试用 1000 轮保持快速，
 * 生产用 600000 轮，同一份代码两者都成立。
 *
 * 任何异常（stored 畸形、`deriveBits` 不被支持、迭代数过大被实现拒绝……）
 * 都收敛成 `false`，绝不向 UI 抛错。
 *
 * 注意默认值**不能**写成参数默认值 `subtle: SubtleCrypto = globalThis.crypto.subtle`：
 * 参数默认值在函数体之前求值，若宿主里 `globalThis.crypto` 不存在（老浏览器、某些
 * SSR 沙箱、被 polyfill 前的早期启动阶段），读 `.subtle` 就会在 `try` 之外抛错，
 * "永不抛异常"的契约当场破功 —— 连"stored 畸形"这种本该直接 false 的调用都会变成 reject。
 * 所以全局查找挪进 `try`，缺失即返回 `false`（谁都不许进）。
 */
export async function verifyPassword(
  password: string,
  stored: string,
  subtle?: SubtleCrypto,
): Promise<boolean> {
  const parsed = parseKdf(stored);
  if (!parsed) return false;

  try {
    // 在 `try` 内解析默认值，见上方说明。
    const webcrypto = subtle ?? globalThis.crypto?.subtle;
    if (!webcrypto) return false;

    const key = await webcrypto.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await webcrypto.deriveBits(
      {
        name: 'PBKDF2',
        // 复制一份：`Uint8Array` 的泛型参数可能是 `ArrayBufferLike`（含 `SharedArrayBuffer`），
        // 而 WebCrypto 的 `BufferSource` 只接受 `ArrayBuffer` 之上建立的视图。
        salt: new Uint8Array(parsed.salt),
        iterations: parsed.iterations,
        hash: 'SHA-256',
      },
      key,
      parsed.hash.length * 8,
    );
    return constantTimeEqual(new Uint8Array(bits), parsed.hash);
  } catch {
    return false;
  }
}
