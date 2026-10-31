#!/usr/bin/env node
/**
 * E2E 的服务进程：**先构建，再预览**。
 *
 * 为什么要一个脚本而不是 `npm run build && npx astro preview --port 4323`：
 *
 * 1. **验收的是产物**。`astro preview` 只伺服 `dist/`，而 `dist/` 是可以过期的——
 *    对着上一次的产物跑一遍全绿，什么也没证明。所以构建是这条命令的第一步，
 *    且构建失败必须让服务起不来（Playwright 会以"webServer 启动失败"报出来），
 *    而不是拿旧 dist 假装成功。
 * 2. **端口只有一个真相**。端口写死在 `playwright.config.ts` 的 `BASE_URL` 里，
 *    这个脚本从环境变量接过来，两处不会漂。默认 4323 是刻意的：4321 是
 *    `astro dev` 的默认端口，本地同时开着 dev server 时不该互相抢占。
 * 3. **Windows 上不经过 npm**。`npm run preview -- --port 4323` 在 PowerShell 5.1 下
 *    会被吃掉第一个 `--`，`--port` 根本到不了 astro（同一个坑在 `scripts/archive.mjs`
 *    的头注释里）。这里直接调 astro 的 CLI 入口，argv 原样传递。
 *
 * 退出即清理：自己退出时把子进程一起杀掉，避免 Ctrl-C 之后留一个占着端口的孤儿
 * 预览服务——下一次跑 E2E 就会莫名其妙地"复用"它（`reuseExistingServer`），
 * 于是整套用例跑在一份谁也没构建过的旧产物上。
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { frozenToday } from '../tests/e2e/frozen-today.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.E2E_PORT ?? '4323';

/**
 * 冻结「今天」：种子数据里最新的日期（推导见 `frozen-today.mjs`）。
 *
 * 注入 `PUBLIC_BUILD_TODAY` 后，构建期所有 `todayInZone()`（六个页面 + 后台岛屿的
 * 客户端 bundle）都冻在种子的最新一天上——真实日期越过种子最后一天时，首页不再
 * 渲染成空状态，E2E 断言不会天天发红。spec 文件里的 `TODAY` 也从同一个 helper
 * 取值，两边逐字节一致。
 */
const FROZEN_TODAY = frozenToday();

/** Astro 的 CLI 入口（不经 node_modules/.bin，免掉平台上 .cmd 的解析差异）。 */
const ASTRO_CLI = join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs');

/** 当前活着的子进程。同一时刻只有一个（build 完才起 preview）。 */
let active = null;

/** 子进程：继承 stdio，让 Playwright 的 `stdout: 'pipe'` 能看见构建与预览日志。 */
function run(args) {
  active = spawn(process.execPath, [ASTRO_CLI, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PUBLIC_BUILD_TODAY: FROZEN_TODAY },
  });
  return active;
}

function shutdown(code) {
  if (active !== null && active.exitCode === null) {
    // `astro preview` 是常驻进程，不主动杀就活过父进程。
    active.kill('SIGTERM');
  }
  process.exit(code ?? 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const build = run(['build']);
build.on('exit', (code) => {
  if (code !== 0) {
    console.error(`[e2e-server] 构建失败（exit ${code}），不启动预览服务`);
    shutdown(code ?? 1);
    return;
  }
  console.log(
    `[e2e-server] 构建完成（今天冻结在种子最新日 ${FROZEN_TODAY}），启动预览服务 http://127.0.0.1:${PORT}`,
  );
  // `astro build` 本身不含剥注释与 swpp 那两段（它们在 package.json 的 build 串里）。
  // 这里补跑同样的两段，保证 E2E 跑的就是线上同款产物（sw.js / sw-dom.js 也生成）。
  const strip = spawnSync(process.execPath, [join(ROOT, 'scripts', 'strip-html-comments.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (strip.status !== 0) {
    console.error('[e2e-server] 剥注释失败，不启动预览服务');
    shutdown(strip.status ?? 1);
    return;
  }
  const swppCli = join(ROOT, 'node_modules', 'swpp-backends', 'dist', 'cli-index.js');
  const swpp = spawnSync(process.execPath, [swppCli, '-b', '--prod'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (swpp.status !== 0) {
    console.error('[e2e-server] swpp 构建失败，不启动预览服务');
    shutdown(swpp.status ?? 1);
    return;
  }
  // `--host 127.0.0.1`：astro preview 默认只听 `localhost`，而 `localhost` 在 Windows 上
  // 可能解析到 `::1`。Playwright 的健康检查打的是 `127.0.0.1`，两者不是同一个地址，
  // 服务明明起来了健康检查却一直超时（实测踩过：报"Timed out waiting from config.webServer"，
  // 而日志里服务是 ready 的）。显式绑 IPv4 回环，让两边是同一个地址。
  const preview = run(['preview', '--host', '127.0.0.1', '--port', PORT]);
  preview.on('exit', (previewCode) => shutdown(previewCode ?? 0));
});
