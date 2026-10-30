import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 配置：跑 **构建产物**，不是 dev server。
 *
 * 为什么必须是 `astro preview` + `dist/`：
 * 后台的数据来自 GitHub、前台的数据来自构建期的 `src/data/` 快照，两者只有"真构建
 * 一遍"才能同时处在可信状态。dev server 下 Astro 按需编译，`getStaticPaths` 的
 * 日期集合会随文件变动漂移，测出来的页面数不代表用户看到的东西。
 *
 * ## webServer 的 command 为什么这么写
 *
 * **不要写成 `npm run preview -- --port 4323`。** Windows PowerShell 5.1 会把传给
 * npm 的第一个 `--` 吃掉，`--port` 从未到达 astro，于是预览服务落在默认端口——测试
 * 报"连不上"，而日志里看不出任何异常（`archive.mjs` 里也记了同一个坑）。直接调
 * `npx astro preview` 并把参数分开传，绕开 npm 这一层。
 *
 * ## 构建放在 webServer 里，不放在 globalSetup
 *
 * 实测顺序是 **webServer 先起、globalSetup 后跑**（`playwright test` 先拉起服务再把
 * 控制权交给 globalSetup）。把 `npm run build` 放进 globalSetup 就等于让服务去伺服
 * 一份还没构建出来的 `dist/`。所以构建是 webServer 命令的第一步。
 *
 * `PUBLIC_ADMIN_PASSWORD_KDF` 在这里显式给出：解锁派生值是**构建时**内联进 bundle 的，
 * 而 `.env` 是 gitignored 的（CI 上没有它）。E2E 要能解锁，就必须自己带一份。测试口令
 * 是 `test-pass-12345`，派生值与 `.env` 里那行完全一致——同一口令换一套 salt 也能验通，
 * 但保持一致可以让人用同一套凭据手工复现失败用例。`$` 这里不需要转义：转义是
 * **dotenv 文本格式**的要求，这里是进程环境变量，值按字面传递。
 */
const PORT = 4323;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** 与 `.env` 里那行等价（口令 `test-pass-12345`）。只用于 E2E，不是任何真实凭据。 */
const TEST_KDF =
  'pbkdf2$600000$oFsW0NH7CKGb3GEXjPXrSw==$M7IfGEC2DanLqcgQf7QCACEgha7PwOMrb7vLFcP8Sx8=';

export default defineConfig({
  testDir: './tests/e2e',
  // 全量重跑比"只跑改过的"更可信：用例之间有共享的构建产物。
  fullyParallel: false,
  // CI 上不许有 `test.only` 悄悄溜过去。
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 单线程：所有用例共用一个 preview 服务与一份 dist，且 admin 用例依赖请求顺序断言。
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: {
    // 解锁要跑 600000 轮 PBKDF2（桌面浏览器上几百毫秒到数秒），默认 5s 在慢机器上不够。
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-375',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    // basePath='/todo' 下根路径 404，探活必须打站点前缀（见 site.config.ts basePath）。
    url: `${BASE_URL}/todo/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PUBLIC_ADMIN_PASSWORD_KDF: TEST_KDF },
  },
});
