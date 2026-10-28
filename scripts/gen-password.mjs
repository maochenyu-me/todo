#!/usr/bin/env node
/**
 * 管理员密码派生值生成器（Node CLI，**不参与**浏览器 bundle）。
 *
 * 用法：`npm run gen-password`
 *
 * 做什么：
 *   1. 交互式读一个密码（**不回显**，支持 PowerShell / cmd / bash）。
 *   2. 校验长度 ≥ 8。
 *   3. 生成 `pbkdf2$600000$<b64salt>$<b64hash>`（PBKDF2-SHA256，随机 16 字节 salt，32 字节 hash）。
 *   4. 把**唯一一行**派生值写到 stdout，其余提示全部写到 stderr。
 *
 * 刻意不做的事：
 *   - **不写 `.env`**：留给人肉粘贴，避免脚本悄悄改掉用户的配置。
 *   - **不回显明文密码**，也不把它写进任何输出/临时文件。
 *
 * 之所以要 600000 轮：`.env` 里只有派生值，而它的最终归宿是打进静态站点的 bundle，
 * 任何人下载站点都能拿到。轮数越多，离线穷举字典的成本越高；单次 SHA-256 则几秒可反查。
 */

import { pbkdf2 as pbkdf2Callback, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { promisify } from 'node:util';

import { readPasswordFromStream } from './read-password.mjs';

const pbkdf2 = promisify(pbkdf2Callback);

/** `.env` 里的变量名。派生值以 `PUBLIC_` 前缀公开进 bundle —— 这是本设计有意的取舍。 */
const ENV_VAR = 'PUBLIC_ADMIN_PASSWORD_KDF';

const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const MIN_PASSWORD_LENGTH = 8;

/** 静音输出：readline 会把用户敲的字回显到这里，丢掉即可。 */
const muted = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

function fail(message) {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exitCode = 1;
}

/**
 * 读密码。两条路径：
 * - 终端（`stdin.isTTY`）：`readline` + 静音 output，输入不回显。
 * - 管道（`'pw' | npm run gen-password`）：把 stdin 全读完取第一行。
 *   管道模式下本就没有回显问题，读完即走，不会因为等不到 EOF 而挂住。
 *
 * 管道分支交给 `read-password.mjs`：它用 `StringDecoder` 逐块解码，
 * 不会把一个跨 chunk 边界的多字节字符切成两个 `U+FFFD`。
 */
async function readPassword() {
  if (!process.stdin.isTTY) {
    process.stderr.write('从标准输入读取密码…\n');
    return readPasswordFromStream(process.stdin);
  }

  process.stderr.write(`请输入管理员密码（至少 ${MIN_PASSWORD_LENGTH} 位，输入不会显示）：`);
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    const answer = await new Promise((resolve, reject) => {
      rl.question('', resolve);
      rl.once('SIGINT', () => reject(new Error('已取消')));
    });
    return answer;
  } finally {
    rl.close();
    muted.end();
  }
}

async function main() {
  const password = await readPassword();
  // 交互式输入后回一个换行，让后续输出从行首开始（管道模式下不需要）。
  if (process.stdin.isTTY) process.stderr.write('\n');

  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`密码太短：至少需要 ${MIN_PASSWORD_LENGTH} 个字符，当前为 ${password.length} 个。`);
    return;
  }

  const salt = randomBytes(SALT_BYTES);
  const hash = await pbkdf2(password, salt, ITERATIONS, HASH_BYTES, 'sha256');
  const stored = `pbkdf2$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;

  // --- stdout：只此一行，方便 `>> .env` 或复制 ---
  process.stdout.write(`${stored}\n`);

  // --- stderr：给人看的说明 ---
  process.stderr.write(
    [
      '',
      '✓ 已生成 PBKDF2 派生值（上方那一行）。',
      '',
      '下一步：打开项目根目录的 .env（没有就从 .env.example 复制一份），',
      `把这一行写进去（等号两边不要空格，值不要加引号）：`,
      '',
      `  ${ENV_VAR}=<粘贴上面那一行>`,
      '',
      '然后重新运行 npm run build（或 npm run dev）让新值生效。',
      '提示：.env 属于密钥，不要提交进仓库；明文密码请自己记住，本脚本不会保存它。',
      '',
    ].join('\n'),
  );
}

try {
  await main();
} catch (error) {
  fail(`生成失败：${error instanceof Error ? error.message : String(error)}`);
}
