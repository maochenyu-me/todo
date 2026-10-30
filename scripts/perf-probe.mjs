#!/usr/bin/env node
/**
 * 性能探针：在**限速 4G + 4× CPU** 下测量页面，用来给优化决策提供数字，而不是凭感觉。
 *
 * 用法（先自己起一个 preview 服务）：
 *   npx astro preview --host 127.0.0.1 --port 4399
 *   node scripts/perf-probe.mjs load      # 首屏：请求数 / 字节 / FCP / LCP
 *   node scripts/perf-probe.mjs nav       # 翻页：预取命中 vs 预取被挡住
 *
 * 环境变量：PERF_BASE（默认 http://127.0.0.1:4399/todo/）、PERF_RUNS（默认 3）。
 *
 * 为什么单独一个脚本而不是塞进 E2E：E2E 的职责是「功能对不对」，性能数字受机器负载
 * 影响很大，放进 CI 只会变成随机红。这里只做**人工对照**（改前/改后各跑一次）。
 */

import { chromium } from 'playwright';

const BASE = process.env.PERF_BASE ?? 'http://127.0.0.1:4399/todo/';
const RUNS = Number(process.env.PERF_RUNS ?? 3);

/** 慢速 4G：150ms RTT、1.6Mbps 下行，外加 4× CPU 降速（贴近中低端手机）。 */
const NETWORK = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** 新建一个已限速的页面；返回 { page, close }。 */
async function throttledPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return { page, close: () => context.close() };
}

/** 等 load 结束，并把 Resource Timing 的传输量汇总出来。 */
async function loadStats(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const bytes = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    return {
      requests: resources.length + 1,
      bytes: bytes + (nav?.transferSize || 0),
      dcl: Math.round(nav?.domContentLoadedEventEnd ?? 0),
      load: Math.round(nav?.loadEventEnd ?? 0),
    };
  });
}

/** LCP 只有通过 PerformanceObserver 才拿得到（buffered 让它在 load 之后仍可读）。 */
async function lcp(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        let value = null;
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          value = entries[entries.length - 1]?.startTime ?? null;
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(value === null ? null : Math.round(value));
        }, 500);
      }),
  );
}

async function measureLoad(browser) {
  const rows = [];
  for (let i = 0; i < RUNS; i += 1) {
    const { page, close } = await throttledPage(browser);
    const started = Date.now();
    await page.goto(BASE, { waitUntil: 'load' });
    const wall = Date.now() - started;
    const stats = await loadStats(page);
    const lcpValue = await lcp(page);
    rows.push({ ...stats, lcp: lcpValue, wall });
    await close();
  }
  return rows;
}

/**
 * 翻页耗时：两种条件，同一份产物。
 * - warm：让页面空闲 900ms，`<link rel=prefetch>` 有足够时间把下一天拉进缓存；
 * - cold：把 `/date/` 下的预取请求全部 abort（点击前一刻放开），模拟没有预取。
 */
async function measureNav(browser, condition) {
  const { page, close } = await throttledPage(browser);
  let blocking = condition === 'cold';
  await page.route('**/date/**', async (route) => {
    if (blocking && route.request().method() === 'GET') await route.abort();
    else await route.continue();
  });

  await page.goto(BASE, { waitUntil: 'load' });
  // 给预取留出空闲窗口（prefetch 是低优先级，需要一点时间）。
  await page.waitForTimeout(900);

  const link = page.locator('nav[aria-label="按日翻阅"] a').first();
  if ((await link.count()) === 0) {
    await close();
    return null;
  }

  blocking = false; // 点击之后允许真实导航
  const started = Date.now();
  await link.click();
  await page.waitForLoadState('load');
  await page.locator('h1').first().waitFor({ state: 'visible' });
  const wall = Date.now() - started;

  await close();
  return { wall };
}

const browser = await chromium.launch();
try {
  const mode = process.argv[2] ?? 'load';

  if (mode === 'load') {
    const rows = await measureLoad(browser);
    const pick = (key) => median(rows.map((row) => row[key] ?? 0));
    console.log(
      JSON.stringify(
        {
          base: BASE,
          runs: RUNS,
          requests: pick('requests'),
          bytes: pick('bytes'),
          fcp: null,
          lcp: pick('lcp'),
          dcl: pick('dcl'),
          load: pick('load'),
        },
        null,
        2,
      ),
    );
  } else if (mode === 'nav') {
    const warm = [];
    const cold = [];
    for (let i = 0; i < RUNS; i += 1) {
      const w = await measureNav(browser, 'warm');
      const c = await measureNav(browser, 'cold');
      if (w) warm.push(w.wall);
      if (c) cold.push(c.wall);
    }
    console.log(
      JSON.stringify(
        { warm: median(warm), cold: median(cold), warmRuns: warm, coldRuns: cold },
        null,
        2,
      ),
    );
  } else {
    console.error(`未知模式：${mode}（load | nav）`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
