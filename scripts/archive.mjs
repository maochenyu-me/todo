/**
 * 归档搬迁 CLI：把活跃区里超过归档期限的日期文件搬进 `src/data/archive/YYYY/`。
 *
 * ## 铁律
 *
 * - 只读本地文件、只移动本地文件，**不发起任何网络请求**。
 * - 搬不搬的决策**不在这里写**：`shouldArchive` / `planArchiveMove`
 *   （`src/lib/archive.ts`）是唯一真相——CLI 只是它的文件系统手臂。
 *   路径也全部经 `entryPath`（`src/lib/entry-codec.ts`）计算，
 *   与公开页面、发布链路（`src/admin/publish.ts`）用的是同一套约定。
 * - 目标文件**已存在时拒搬并跳过**（绝不覆盖）：搬迁的代价是源文件被移走，
 *   一旦覆盖同名归档，被覆盖的那份就没了。跳过时原文件原地不动，退出码 1，
 *   让操作者（或 CI）看见后再手工处理。
 *
 * ## 为什么经 Vite 加载 TS
 *
 * `archive.ts` 等模块用的是无扩展名 ESM 导入（`from './date'`），
 * 裸 Node 的类型剥离解析不了。项目本就有 vite（Astro 的依赖，零新增），
 * `ssrLoadModule` 能按 Vite 的解析规则加载同一份 TS 源——比在脚本里
 * 复制一份决策逻辑，或把全库导入改成带 `.ts` 扩展名，代价都小。
 *
 * 用法：
 * ```
 * npm run archive -- --dry-run   # 只打印将搬迁的文件，不动文件系统
 * npm run archive                # 实际搬迁
 * ```
 *
 * ⚠️ Windows PowerShell 5.1 会吃掉传给 npm 的第一个 `--`，`--dry-run` 到不了脚本
 * （实测 `npm run x -- --flag` 的 argv 是空的）。在这台机器上用下面任一形式：
 * ```
 * node scripts/archive.mjs --dry-run          # 直连，最可靠
 * npm run archive -- -- --dry-run             # 双 `--` 补偿（PowerShell 5.1）
 * ```
 */

import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { createServer } from 'vite';

const dryRun = process.argv.includes('--dry-run');

const vite = await createServer({
  root: process.cwd(),
  configFile: false, // 不加载 astro.config——这里只需要纯 TS 转译
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  // 决策、路径与日期的唯一真相，从源码加载（与公开页面/发布链路同源）。
  const { siteConfig } = await vite.ssrLoadModule('/site.config.ts');
  const { planArchiveMove } = await vite.ssrLoadModule('/src/lib/archive.ts');
  const { entryPath } = await vite.ssrLoadModule('/src/lib/entry-codec.ts');
  const { addMonths, isValidDateKey, todayInZone } = await vite.ssrLoadModule('/src/lib/date.ts');

  const dataCfg = { activeDir: siteConfig.data.activeDir, archiveDir: siteConfig.data.archiveDir };
  const afterMonths = siteConfig.data.archiveAfterMonths;
  const todayKey = todayInZone(siteConfig.site.timeZone);
  const cutoff = addMonths(todayKey, -afterMonths);

  // 扫活跃区：文件名必须恰好是 YYYY-MM-DD.json，别的名字不归这个工具管。
  const names = await readdir(dataCfg.activeDir);
  const dateKeys = [];
  const unrecognized = [];
  for (const name of names) {
    const key = name.replace(/\.json$/, '');
    if (name.endsWith('.json') && isValidDateKey(key)) {
      dateKeys.push(key);
    } else if (name !== '.gitkeep') {
      unrecognized.push(name);
    }
  }

  const { move } = planArchiveMove(dateKeys, todayKey, afterMonths);

  if (move.length === 0) {
    console.log(`无需搬迁（截止日 ${cutoff}，共 ${dateKeys.length} 个活跃日期）。`);
  }

  const skipped = [];
  const plannedOrMoved = []; // { dateKey, to }

  for (const dateKey of move) {
    const from = entryPath('active', dateKey, dataCfg);
    const to = entryPath('archive', dateKey, dataCfg);

    // 目标已存在 → 拒搬：覆盖归档等于丢数据。
    let exists = false;
    try {
      await readFile(to);
      exists = true;
    } catch {
      // 不存在，正常路径。
    }
    if (exists) {
      skipped.push({ from, to });
      continue;
    }

    if (!dryRun) {
      await mkdir(to.slice(0, to.lastIndexOf('/')), { recursive: true });
      await rename(from, to);
    }
    plannedOrMoved.push({ dateKey, to });
  }

  // 按年份汇总，和 brief 的输出示例（`已搬迁 37 个文件 → archive/2025/`）对齐。
  const countByYear = new Map();
  for (const { dateKey, to } of plannedOrMoved) {
    const year = dateKey.slice(0, 4);
    countByYear.set(year, (countByYear.get(year) ?? 0) + 1);
    if (dryRun) console.log(`  ${to}`);
  }
  for (const [year, count] of countByYear) {
    console.log(`${dryRun ? '将搬迁' : '已搬迁'} ${count} 个文件 → ${dataCfg.archiveDir}/${year}/`);
  }

  for (const { from, to } of skipped) {
    console.error(`跳过 ${from}：目标文件已存在（${to}）`);
  }
  for (const name of unrecognized) {
    console.error(`跳过无法识别的文件：${dataCfg.activeDir}/${name}`);
  }

  if (skipped.length > 0) process.exitCode = 1;
} finally {
  await vite.close();
}
