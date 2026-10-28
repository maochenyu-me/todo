# 待办簿（TODO）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一个纯静态、公开只读的日记式待办簿：Astro 构建期烘焙每日 JSON 数据，`/admin` 用一个 React 岛编辑，并以**单个 commit** 通过 GitHub Git Data API 提交回仓库。

**Architecture:** `src/lib/` 存放全部无框架依赖的纯逻辑（日期、数据读取、统计、校验、归档决策、GitHub 客户端、密码校验），可被 Vitest 直接单测。前台六个页面全部由 Astro 组件在构建期渲染成零 JS 的 HTML。唯一客户端岛屿是 `/admin`，它从 GitHub 仓库（而非构建产物）读数据，改动暂存于内存，点「保存并发布」时用 Git Data API 组装 blob → tree → commit → ref 完成原子提交。

**Tech Stack:** Astro 7.4.2 / React 19.3.1（仅岛屿）/ Tailwind CSS 4.3.3 / shadcn/ui（Radix）/ `@lucide/astro` + `lucide-react` 1.62.0 / Vitest 5.0.5 / Playwright 1.64.1 / TypeScript 5.9.3

**Spec:** `docs/superpowers/specs/2026-10-28-todo-site-design.md`

## Global Constraints

- 运行环境：Node **≥ 22.23.4**（Astro 7.4.2 硬性要求），npm 12.x。
- **Astro 7 的 Rust 编译器对 HTML 严格**：所有非空元素必须闭合；非法的块级嵌在 `<p>` 内不再被自动修正。
- **`compressHTML` 默认为 `'jsx'`**：相邻行内元素之间的空格会被吞掉，需要空格处显式写 `{" "}`。
- 站点时区固定 `Asia/Shanghai`，**所有"今天"的判断只能走 `src/lib/date.ts`**，禁止在页面或组件里直接 `new Date()` 取日期。
- 除 `/admin` 页面外，**不得引入任何 `client:*` 指令**；前台每页内联脚本总量目标 < 2KB（明暗切换脚本约 400 字节）。
- 任务字段固定：`id, title, done, completedAt, order, priority, tags, note, timeBlock, createdAt, updatedAt`。**不得增删字段**。
- `priority` 取值 `0=高 / 1=中 / 2=低`（数字）。
- 数据路径：活跃 `src/data/todos/YYYY-MM-DD.json`，归档 `src/data/archive/YYYY/YYYY-MM-DD.json`。
- 归档边界 `archiveAfterMonths: 6`，**只在两处触发**：`/admin` 保存时、`npm run archive` 手动执行。**构建期永不移动文件**。
- 秘密只有一个：`.env` 的 `PUBLIC_ADMIN_PASSWORD_KDF`。**GitHub token 不得出现在任何代码、构建产物或 `.env` 中**，只存 `localStorage["todo.gh.token"]`。
- 站点文案全部中文；日期显示用中文格式（如 `2026年10月28日 周三`）。
- 全站文案与数值来自 `site.config.ts`，页面内不得硬编码颜色值、月份数、分页上限、路径。
- 明文密码、token、真实仓库地址**不得写进 git 跟踪的任何文件**。

## Review Focus

以下五类是 spec 隐含、但容易在实现中被漏掉或做错的输入/条件，均已各自在对应任务里配了测试：

1. **跨时区的"今天"** —— 构建机跑在 UTC、访客在别处；`2026-10-28T16:30Z` 在北京时间已是次日 00:30，任何用 `new Date().toISOString().slice(0,10)` 的地方都会错一天。
2. **损坏或半截的数据文件** —— 文件里缺 `tasks`、`tasks` 不是数组、文件名日期与内容 `date` 不符、JSON 语法错误。站点必须仍能构建，且明确报出是哪个文件坏了，而不是整个构建崩掉或静默丢数据。
3. **归档搬迁的边界与幂等** —— 刚好第 6 个月当天该不该搬、同一文件被搬两次会不会产生重复条目、归档区文件被重复读取会不会在列表里出现两次。
4. **GitHub 提交的原子性与失败恢复** —— 中途某步失败（blob 上传失败、ref 被非快进拒绝、401 token 失效）后，面板里的改动必须原样保留且可重试，且**绝不能出现部分文件已提交的半截状态**。
5. **空数据与首访状态** —— 整个仓库没有任何数据文件、某一天没有记录、某个标签只剩 0 条、统计区间内完全没有数据。这些必须渲染成有意义的空状态，而不是 NaN、空白页或除零。

---

## Task 1: 项目脚手架与配置入口

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `site.config.ts`, `.env.example`, `.gitignore`, `src/styles/global.css`, `src/pages/index.astro`

**Interfaces:**
- Produces: `siteConfig`（default export 与具名 export 均有），字段见 spec 第 4 节，完整形状由本任务定义。
- Produces: CSS 变量 `--background --foreground --card --card-foreground --muted --muted-foreground --border --primary --primary-foreground --seal --done --radius`，明亮与 `.dark` 两套。

- [ ] **Step 1: 初始化项目并安装锁定版本依赖**

```bash
npm init -y
npm i astro@7.4.2 @astrojs/react@7.1.1 @astrojs/sitemap@3.7.4 react@19.3.1 react-dom@19.3.1 \
  tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 @lucide/astro@1.62.0 lucide-react@1.62.0 \
  clsx@2.1.1 tailwind-merge@3.7.0 class-variance-authority@0.7.1
npm i -D typescript@5.9.3 @types/react@19.3.0 @types/react-dom@19.3.0 vitest@5.0.5 @playwright/test@1.64.1 @astrojs/check@0.9.12
```

Expected: `node_modules` 生成，无 peer dependency 报错。

> `@astrojs/check` 必须装：`npm run check` 脚本引用它，不装则交互式提示并挂死非 TTY 环境。

- [ ] **Step 2: 写 `package.json` 的 scripts 与 `type: module`**

```json
{
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "gen-password": "node scripts/gen-password.mjs",
    "archive": "node scripts/archive.mjs"
  }
}
```

- [ ] **Step 3: 写 `site.config.ts`**

按 spec 第 4 节原样落地，其中 `theme.accent` 用 `{ light: "#BE3A2B", dark: "#E4675A" }`，`deploy.platform: "auto"`。**文件内不得出现密码、token。**

- [ ] **Step 4: 写 `astro.config.mjs`**

要点：`site` 与 `base` 从 `siteConfig.site` 读取；`vite.plugins: [tailwindcss()]`；`integrations: [react(), sitemap()]`；`trailingSlash: "ignore"`。

- [ ] **Step 5: 写 `src/styles/global.css`**

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
@theme { /* 映射 spec 7.2 的色值为 --color-* 令牌 */ }
:root { /* 明亮变量 */ }
.dark { /* 暗黑变量 */ }
```

`--seal` 明亮取 `#BE3A2B`、暗黑取 `#E4675A`（对应 `theme.accent`）。

- [ ] **Step 6: 写占位首页并验证构建与 base 路径**

`src/pages/index.astro` 只输出一个 `<h1>` 并引入 `global.css`，写好 `lang="zh-CN"`。

Run: `npm run build`
Expected: `dist/index.html` 存在，HTML 内引用的 CSS 路径带 `base` 前缀（若 `base` 非 `/`）。

- [ ] **Step 7: 写 `.env.example`、`.gitignore`**

`.gitignore` 必须含：`node_modules/`、`dist/`、`.env`、`.astro/`、`test-results/`、`playwright-report/`。
`.env.example` 只有一行：`PUBLIC_ADMIN_PASSWORD_KDF=pbkdf2$600000$<base64-salt>$<base64-hash>`。

- [ ] **Step 8: Commit**

```bash
git add package.json astro.config.mjs tsconfig.json site.config.ts .env.example .gitignore src/styles/global.css src/pages/index.astro
git commit -m "chore: scaffold Astro 7 project with config entry and design tokens"
```

---

## Task 2: 日期与时区纯逻辑

**Files:**
- Create: `src/lib/types.ts`, `src/lib/date.ts`, `src/lib/date.test.ts`

**Interfaces:**
- Produces (`types.ts`): `Priority = 0 | 1 | 2`；`TimeBlock = { start: string; end: string }`；`Task = { id: string; title: string; done: boolean; completedAt: string | null; order: number; priority: Priority; tags: string[]; note: string; timeBlock: TimeBlock | null; createdAt: string; updatedAt: string }`；`DayEntry = { date: string; tasks: Task[] }`。
- Produces (`date.ts`):
  - `todayInZone(timeZone: string, now?: Date): string` → `"YYYY-MM-DD"`
  - `toDateKey(d: Date, timeZone: string): string`
  - `addDays(dateKey: string, delta: number): string`
  - `addMonths(dateKey: string, delta: number): string`（月末夹取：`2026-01-31` 加 1 月得 `2026-02-28`）
  - `parseDateKey(dateKey: string): { y: number; m: number; d: number }`
  - `isValidDateKey(s: string): boolean`
  - `formatLong(dateKey: string): string` → `"2026年10月28日 周三"`
  - `formatMedium(dateKey: string): string` → `"10月28日 周三"`
  - `formatYearMonth(dateKey: string): string` → `"2026年10月"`
  - `monthRange(dateKey: string): string[]` → 该月所有日期 key（含空月）
  - `weekdayOf(dateKey: string): 0..6`（0=周日）
  - `startOfWeekGrid(dateKey: string, weekStartsOn: 0 | 1): string[]` → 月历网格的 42 个日期 key
  - `monthsBetween(fromKey: string, toKey: string): number`（**完整月数**的 floor）

- [ ] **Step 1: 写失败的测试 `src/lib/date.test.ts`**

必须覆盖（按 Review Focus 1 与 3）：

```ts
test('UTC 16:30 在北京是次日', () => {
  const now = new Date('2026-10-28T16:30:00Z');
  expect(todayInZone('Asia/Shanghai', now)).toBe('2026-10-29');
});
test('UTC 15:59 在北京仍是当日', () => {
  expect(todayInZone('Asia/Shanghai', new Date('2026-10-28T15:59:00Z'))).toBe('2026-10-28');
});
test('跨年 addDays', () => {
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
});
test('闰年 2 月', () => {
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  expect(monthRange('2028-02-10')).toHaveLength(29);
});
test('formatLong 输出中文星期', () => {
  expect(formatLong('2026-10-28')).toBe('2026年10月28日 周三');
});
test('monthRange 边界', () => {
  expect(monthRange('2026-10-15')[0]).toBe('2026-10-01');
  expect(monthRange('2026-10-15').at(-1)).toBe('2026-10-31');
});
test('startOfWeekGrid 返回 42 项且首项是周一', () => {
  const grid = startOfWeekGrid('2026-10-01', 1);
  expect(grid).toHaveLength(42);
  expect(weekdayOf(grid[0])).toBe(1);
});
test('monthsBetween 边界', () => {
  expect(monthsBetween('2026-04-28', '2026-10-28')).toBe(6);
  expect(monthsBetween('2026-04-29', '2026-10-28')).toBe(5);
});
test('addMonths 月末夹取', () => {
  expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  expect(addMonths('2026-10-28', -6)).toBe('2026-04-28');
});
test('isValidDateKey 拒绝非法输入', () => {
  expect(isValidDateKey('2026-02-30')).toBe(false);
  expect(isValidDateKey('2026-1-5')).toBe(false);
  expect(isValidDateKey('abc')).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- src/lib/date.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `src/lib/date.ts`**

全部计算走 `Intl.DateTimeFormat` 配合 `timeZone`，或对 `YYYY-MM-DD` 做纯字符串/UTC 正午运算，**绝不使用本地时区的 `getDate()`**。`toDateKey` 用 `formatToParts` 取 `year/month/day` 再补零。

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- src/lib/date.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/date.ts src/lib/date.test.ts
git commit -m "feat(date): add timezone-fixed date helpers"
```

---

## Task 3: 数据编解码（无 Node 依赖）与文件读取

**为什么拆两个文件：** 后台的 `publish.ts` 运行在**浏览器**里，却需要序列化与路径规则。因此把纯逻辑放进 `entry-codec.ts`（零 Node API），`data.ts` 才允许 import `node:fs`。浏览器端只许 import `entry-codec.ts`，**import 了 `data.ts` 会导致构建失败**。

**Files:**
- Create: `src/lib/entry-codec.ts`, `src/lib/entry-codec.test.ts`, `src/lib/data.ts`, `src/lib/data.test.ts`

**Interfaces:**
- Consumes: `types.ts`、`date.ts`（`isValidDateKey`）。
- Produces (`entry-codec.ts`，**禁止 import 任何 `node:*`**):
  - `validateEntry(raw: unknown, dateKey: string): { ok: true; entry: DayEntry } | { ok: false; errors: string[] }`
  - `serializeEntry(entry: DayEntry): string`（2 空格缩进 + 结尾换行）
  - `parseEntry(text: string, dateKey: string): { ok: true; entry: DayEntry } | { ok: false; errors: string[] }`
  - `entryPath(kind: "active" | "archive", dateKey: string, dataCfg: { activeDir: string; archiveDir: string }): string`
    - active: `<activeDir>/<dateKey>.json`
    - archive: `<archiveDir>/<YYYY>/<dateKey>.json`
- Produces (`data.ts`，唯一允许碰文件系统的模块):
  - `readDayFromDisk(activeDir: string, archiveDir: string, dateKey: string): DayEntry | null`
  - `loadAllEntries(activeDir: string, archiveDir: string): { entries: DayEntry[]; errors: { path: string; message: string }[] }`（`entries` 按 `date` 升序、去重）

- [ ] **Step 1: 写 `entry-codec.test.ts` 的失败测试**

按 Review Focus 2，必须包含：

```ts
test('文件名与内容 date 不符时报错并指名文件', () => {
  const r = validateEntry({ date: '2026-10-27', tasks: [] }, '2026-10-28');
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('unreachable');
  expect(r.errors.join()).toContain('2026-10-28');
});
test('缺 tasks 不抛异常，返回错误', () => {
  expect(validateEntry({ date: '2026-10-28' }, '2026-10-28').ok).toBe(false);
});
test('tasks 不是数组时报错', () => {
  expect(validateEntry({ date: '2026-10-28', tasks: {} }, '2026-10-28').ok).toBe(false);
});
test('priority 越界被拒绝而非静默修正', () => {
  const r = validateEntry({ date: '2026-10-28', tasks: [{ ...validTask, priority: 5 }] }, '2026-10-28');
  expect(r.ok).toBe(false);
});
test('serializeEntry 往返稳定', () => {
  const e: DayEntry = { date: '2026-10-28', tasks: [validTask] };
  const back = parseEntry(serializeEntry(e), '2026-10-28');
  expect(back.ok).toBe(true);
  if (back.ok) expect(back.entry).toEqual(e);
});
test('entryPath 归档路径按年份分桶', () => {
  expect(entryPath('archive', '2025-11-03', { activeDir: 'a', archiveDir: 'b' })).toBe('b/2025/2025-11-03.json');
});
```

- [ ] **Step 2: 运行确认失败** — `npm test -- src/lib/entry-codec.test.ts`

- [ ] **Step 3: 实现 `entry-codec.ts`**

校验规则：`date` 为合法 key 且与文件名一致；`tasks` 是数组；每个 task 的 `title` 非空、`priority` ∈ {0,1,2}、`done` 为布尔、`tags` 为字符串数组、`timeBlock` 为 null 或 `end > start`、`id` 非空。**任何越界值不静默修正，写进 `errors`。**

- [ ] **Step 4: 运行确认通过**

- [ ] **Step 5: 写 `data.test.ts` 的失败测试**

```ts
test('同一日期同时存在于活跃区与归档区时只出现一次', () => { /* 临时目录写两份同日期文件 */ });
test('JSON 语法错误时跳过该文件但收集错误', () => { /* 断言 errors 含该路径 */ });
test('缺少目录时不抛异常，返回空 entries', () => { /* activeDir 不存在 */ });
```

- [ ] **Step 6: 运行确认失败 → Step 7: 实现 `data.ts` → Step 8: 通过**

`data.ts` 必须 `import { parseEntry } from './entry-codec'`，不得重复实现校验。坏文件进入 `errors`，**不中断**。

- [ ] **Step 9: 加一条守卫测试**

```ts
test('entry-codec 不含 node 依赖', () => {
  const src = readFileSync('src/lib/entry-codec.ts', 'utf8');
  expect(src).not.toMatch(/from ['"]node:/);
});
```

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(data): add browser-safe entry codec and fs loader"
```

---

## Task 4: 校验规则与归档决策纯函数

**Files:**
- Create: `src/lib/validate.ts`, `src/lib/validate.test.ts`, `src/lib/archive.ts`, `src/lib/archive.test.ts`

**Interfaces:**
- Produces (`validate.ts`): `validateTask(task: Task): string[]`（返回人类可读中文错误，空数组表示通过）；`validateDay(entry: DayEntry): string[]`；`normalizeTask(task: Task): Task`（补全 `completedAt`、去重 tags、`order` 重新编号）。
- Produces (`archive.ts`): `shouldArchive(dateKey: string, todayKey: string, afterMonths: number): boolean`；`planArchiveMove(dateKeys: string[], todayKey: string, afterMonths: number): { move: string[] }`。

**边界语义（已裁决，勿改）：** `shouldArchive` 用**截止日比较**实现——`dateKey < addMonths(todayKey, -afterMonths)`。所以 `afterMonths=6`、`today=2026-10-28` 时，截止日为 `2026-04-28`，`2026-04-27` 搬、`2026-04-28` 不搬。不要用 `monthsBetween(...) > afterMonths`，那会让 4/27 与 4/28 同归一类而两条测试无法同时成立。

- [ ] **Step 1: 写失败的测试**

覆盖 spec 8.7 每条规则的中文文案，以及 Review Focus 3 的边界：

```ts
test('空标题', () => expect(validateTask({...base, title: '  '})).toContain('待办需要一个标题。'));
test('标题 200 字上限', () => expect(validateTask({...base, title: 'x'.repeat(201)})).toContain('标题最多 200 字，长内容请写进备注。'));
test('标签上限 10 个', () => { /* 11 个标签 → 命中文案 */ });
test('结束时间早于开始时间', () => { /* timeBlock {start:'10:00', end:'09:00'} → 命中文案 */ });
test('done 为 true 且缺 completedAt 时 normalizeTask 自动补全', () => {
  const t = normalizeTask({ ...base, done: true, completedAt: null });
  expect(t.completedAt).not.toBeNull();
});
test('刚好 6 个月当天搬不搬', () => {
  expect(shouldArchive('2026-04-28', '2026-10-28', 6)).toBe(false);  // 恰好 6 个月，仍活跃
  expect(shouldArchive('2026-04-27', '2026-10-28', 6)).toBe(true);
});
test('planArchiveMove 对同一 key 幂等', () => {
  const keys = ['2026-04-27', '2026-04-27'];
  expect(planArchiveMove(keys, '2026-10-28', 6).move).toEqual(['2026-04-27']);
});
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现两个模块**

`shouldArchive` 严格按上面的截止日比较实现。文案必须与 spec 8.7 表格**逐字一致**。

- [ ] **Step 4: 运行确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(validate): add task validation and archive boundary logic"
```

---

## Task 5: 统计聚合

**Files:**
- Create: `src/lib/stats.ts`, `src/lib/stats.test.ts`

**Interfaces:**
- Consumes: `DayEntry[]`、`date.ts`。
- Produces:
  - `daySummary(entry: DayEntry): { total: number; done: number; rate: number }`（`total === 0` 时 `rate` 为 `0`，**不得 NaN**）
  - `streak(entries: DayEntry[], todayKey: string): number`（连续打卡天数；今天无记录不算断）
  - `weeklyDone(entries: DayEntry[], todayKey: string, weeks: number): { weekStart: string; done: number; total: number }[]`
  - `rollingRate(entries: DayEntry[], todayKey: string, days: number): { date: string; rate: number }[]`
  - `tagStats(entries: DayEntry[]): { tag: string; total: number; done: number }[]`（按 total 降序）

- [ ] **Step 1: 写失败的测试**

按 Review Focus 5，必须含：

```ts
test('空数据不产生 NaN', () => {
  const s = daySummary({ date: '2026-10-28', tasks: [] });
  expect(s).toEqual({ total: 0, done: 0, rate: 0 });
  expect(Number.isNaN(s.rate)).toBe(false);
});
test('今天没记录不算断签', () => {
  const entries = [day('2026-10-26', 1, 1), day('2026-10-27', 1, 1)];
  expect(streak(entries, '2026-10-28')).toBe(2);
});
test('今天有记录且未完成则断签', () => {
  const entries = [day('2026-10-27', 1, 1), day('2026-10-28', 1, 0)];
  expect(streak(entries, '2026-10-28')).toBe(0);
});
test('weeklyDone 长度固定为请求周数且含空周', () => {
  expect(weeklyDone([], '2026-10-28', 12)).toHaveLength(12);
});
test('tagStats 按 total 降序', () => { /* 断言顺序 */ });
```

- [ ] **Step 2: 运行确认失败** — `npm test -- src/lib/stats.test.ts`

- [ ] **Step 3: 实现 `src/lib/stats.ts`**

所有除法前先判分母为 0。

- [ ] **Step 4: 运行确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(stats): add completion, streak and trend aggregation"
```

---

## Task 6: 密码生成与校验

**Files:**
- Create: `scripts/gen-password.mjs`, `src/lib/auth.ts`, `src/lib/auth.test.ts`

**Interfaces:**
- Produces (`scripts/gen-password.mjs`): 交互式读取密码 → 生成 `pbkdf2$600000$<b64salt>$<b64hash>` → 打印到终端并提示粘进 `.env`。
- Produces (`auth.ts`): `parseKdf(stored: string): { iterations: number; salt: Uint8Array; hash: Uint8Array } | null`；`verifyPassword(password: string, stored: string, subtle?: SubtleCrypto): Promise<boolean>`；`constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean`。

- [ ] **Step 1: 写失败的测试**

```ts
test('正确密码通过', async () => { /* 用固定 salt 生成后验证 */ });
test('错误密码不通过', async () => {});
test('格式非法的 stored 返回 false 而不抛异常', async () => {
  await expect(verifyPassword('x', 'not-a-kdf')).resolves.toBe(false);
});
test('constantTimeEqual 对不等长输入返回 false 且不提前返回', () => {
  expect(constantTimeEqual(new Uint8Array([1,2]), new Uint8Array([1,2,3]))).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**

`verifyPassword` 用 `subtle.deriveBits`（PBKDF2-SHA256，`iterations` 从 stored 读取，不写死 600000）。`constantTimeEqual` 先比长度再逐字节异或累积。

- [ ] **Step 4: 运行确认通过**

- [ ] **Step 5: 手动验证 gen-password**

Run: `npm run gen-password`
Expected: 交互式输入后输出 `pbkdf2$600000$...` 一行，且该值粘进 `.env` 后 `verifyPassword` 对原密码返回 true（写一个临时脚本验证，验证后删除）。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(auth): add PBKDF2 password generation and verification"
```

---

## Task 7: 前台布局、导航与明暗模式

**Files:**
- Create: `src/layouts/BaseLayout.astro`, `src/components/Rail.astro`, `src/components/ThemeToggle.astro`, `src/components/ProgressTicks.astro`, `src/components/DateStamp.astro`, `src/components/TaskRow.astro`, `src/components/EmptyState.astro`
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: `siteConfig`、`date.ts` 的格式化函数、`types.ts`。
- Produces: `BaseLayout` 接受 `{ title?: string; description?: string; activeNav?: "today" | "archive" | "calendar" | "tags" | "stats" }`；`ProgressTicks` 接受 `{ total: number; done: number }`；`DateStamp` 接受 `{ dateKey: string }`；`TaskRow` 接受 `{ task: Task; showTimeBlock: boolean; showTags: boolean; showPriority: boolean }`。

- [ ] **Step 1: 写 `BaseLayout.astro`**

必含：`<html lang="zh-CN">`、`<head>` 内的**内联主题脚本**（读 `localStorage["todo.theme"]`，为 `system` 时用 `matchMedia`，给 `documentElement` 加 `dark` 类）、canonical、`hreflang`、sitemap 所需的 `site` 拼接。**这是全站唯一的内联 JS，须 < 500 字节。**

- [ ] **Step 2: 写 `Rail.astro`（桌面左栏 / 窄屏顶栏）与 `ThemeToggle.astro`**

`Rail` 用 `activeNav` 高亮当前项；导航项来自配置里的 `frontend.pages` 开关。`ThemeToggle` 三态循环，用 `lucide` 的 `Sun`/`Moon`/`Monitor`。**按钮点击逻辑**：因站点其余部分零 JS，此处用一个最小内联 `<script>`（约 15 行）而非 React。

- [ ] **Step 3: 写 `DateStamp.astro`、`ProgressTicks.astro`、`TaskRow.astro`、`EmptyState.astro`**

`DateStamp`：朱红细边框、年月日三行错落、`transform: rotate(-2deg)`。
`ProgressTicks`：`total` 个方块，前 `done` 个填墨；`total === 0` 时渲染一行「今天还没有条目」。
`TaskRow`：`<li>` 语义化；`done` 时标题包 `<s>` 并附屏幕阅读器文本「已完成」；行内按 时间段 → 勾选字形 → 标题 → 标签 → 优先级 排列。
`EmptyState`：接受 `{ title: string; hint?: string }`。

- [ ] **Step 4: 用占位数据填充首页并验证**

首页临时硬编码 3 条假任务（下一步接真实数据后删除）。

Run: `npm run dev`，浏览器检查：
- 明亮/暗黑切换无闪烁、刷新后保持
- `prefers-reduced-motion` 下无过渡（用 DevTools 模拟）
- 1440px 与 375px 两档布局正常
- 键盘 Tab 能到达导航与切换按钮，焦点环可见

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ui): add base layout, rail nav, date stamp and theme toggle"
```

---

## Task 8: 今日页与单日页

**Files:**
- Modify: `src/pages/index.astro`
- Create: `src/pages/date/[date].astro`

**Interfaces:**
- Consumes: `loadAllEntries`、`todayInZone`、`addDays`、排序与分组逻辑。
- Produces: 页面级辅助函数 `orderTasks(tasks: Task[]): { scheduled: Task[]; unscheduled: Task[] }`，放在 `src/lib/order.ts` 并单测。

- [ ] **Step 1: 写 `src/lib/order.ts` 的失败测试**

```ts
test('有时间段的按开始时间升序在前', () => {
  const r = orderTasks([noTime('b', 0), withTime('a', '10:00', '11:00'), withTime('c', '09:00', '09:30')]);
  expect(r.scheduled.map(t => t.id)).toEqual(['c', 'a']);
});
test('同一时间段按 order 升序', () => {});
test('无时间段的按 order 升序', () => {
  expect(orderTasks([noTime('x', 2), noTime('y', 0)]).unscheduled.map(t => t.id)).toEqual(['y', 'x']);
});
```

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 → Step 4: 通过**

Run: `npm test -- src/lib/order.test.ts`

- [ ] **Step 5: 实现 `index.astro`**

用 `getStaticPaths` 之外的直读：`const today = todayInZone(siteConfig.site.timeZone)`，读该日 entry，渲染 `DateStamp` + `ProgressTicks` + 任务列表 + 已完成分组（原生 `<details>`）+ 前一天/后一天链接（无数据置灰 `aria-disabled`）。空数据走 `EmptyState`。

- [ ] **Step 6: 实现 `date/[date].astro`**

`getStaticPaths` 只对**存在数据的日期**生成页面（来自 `loadAllEntries`），并为今天之外的所有日期设 canonical 指向自身；同时给 `/date/<今天>` 设 canonical 指向 `/`。

- [ ] **Step 7: 验证**

Run: `npm run build`，检查 `dist/index.html` 与 `dist/date/*/index.html` 生成；`dist/index.html` 中无 `client:` 相关脚本（除主题脚本）。

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(pages): add today and per-day pages"
```

---

## Task 9: 归档页、月历页、标签页

**Files:**
- Create: `src/pages/archive.astro`, `src/pages/calendar/index.astro`, `src/pages/calendar/[month].astro`, `src/pages/tags/[tag].astro`, `src/lib/tags.ts`, `src/lib/tags.test.ts`

**Interfaces:**
- Produces (`tags.ts`): `collectTags(entries: DayEntry[], opts: { maxVisible: number; minCount: number }): { tag: string; count: number }[]`；`entriesByTag(entries: DayEntry[], tag: string): { date: string; tasks: Task[] }[]`。

- [ ] **Step 1: 写 `tags.test.ts` 的失败测试**

```ts
test('少于 minCount 的标签被过滤', () => {});
test('按 count 降序且截断到 maxVisible', () => {});
test('空数据返回空数组', () => { expect(collectTags([], { maxVisible: 30, minCount: 1 })).toEqual([]); });
```

- [ ] **Step 2: 实现并通过** — `npm test -- src/lib/tags.test.ts`

- [ ] **Step 3: 实现 `archive.astro`**

按年月分组连续表，行内只有 `日期 | 完成 N/M | ProgressTicks`，**不得输出任务标题**。无数据日期不生成行。顶部/侧边年份锚点。

- [ ] **Step 4: 实现月历**

`calendar/index.astro` 重定向或直接渲染最新有数据的月份；`[month].astro` 用 `getStaticPaths` 为**有数据的每个月份**生成，同时生成当前月（即使无数据）。格子内日期数字 + 完成度横条；有数据的日期链接到 `/date/<key>`。周起始读 `weekStartsOn`。

- [ ] **Step 5: 实现 `tags/[tag].astro`**

`getStaticPaths` 来自 `collectTags` 结果；页内按日倒序，每条挂日期小标签。标签为 0 条时不生成该页。

- [ ] **Step 6: 验证**

Run: `npm run build`；确认 `dist/archive/index.html`、`dist/calendar/*/index.html`、`dist/tags/*/index.html` 均生成，且 archive 页 HTML 中不包含任何任务标题字符串。

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(pages): add archive, calendar and tag pages"
```

---

## Task 10: 统计页（构建期内联 SVG）

**Files:**
- Create: `src/pages/stats.astro`, `src/components/charts/BarSquares.astro`, `src/components/charts/LineChart.astro`

**Interfaces:**
- Consumes: `stats.ts` 的 `weeklyDone`、`rollingRate`、`streak`、`daySummary`。
- Produces: `BarSquares` 接受 `{ data: { label: string; value: number }[]; max?: number }`；`LineChart` 接受 `{ points: { x: string; y: number }[]; height?: number }`。

- [ ] **Step 1: 写 `BarSquares.astro`**

输出内联 `<svg>`，柱子由竖排小方块拼成（每个方块代表 1 个单位），**无渐变、无阴影**。`max` 缺省取数据最大值，为 0 时画空状态。

- [ ] **Step 2: 写 `LineChart.astro`**

单条 1.5px `<path>`，无填充、无圆点装饰；坐标轴用 `<line>` + 少量 `<text>`；`points` 为空时渲染空状态而非空 `<svg>`。

- [ ] **Step 3: 写 `stats.astro`**

区块顺序：完成率大数字 → 连续打卡大数字 → 近 12 周柱状 → 90 天折线。数字用 `tabular-nums`。空数据时每块走空状态文案。

- [ ] **Step 4: 验证**

Run: `npm run build`，打开 `dist/stats/index.html` 确认：页面无 `<script>`（除主题脚本）、SVG 为静态内联、无 `NaN`、无 `Infinity` 字样。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(pages): add stats page with inline SVG charts"
```

---

## Task 11: 示例数据播种

**Files:**
- Create: `src/data/todos/2026-10-19.json` … `src/data/todos/2026-10-28.json`（共 10 天）、`src/data/archive/2025/2025-11-03.json`、`2025-11-04.json`

**Interfaces:**
- Consumes: `types.ts` 的 `DayEntry` 形状。
- Produces: 供后续所有页面的真实渲染数据。

- [ ] **Step 1: 生成 10 天活跃数据**

要求：中文任务标题、真实感；覆盖所有字段组合（有/无时间段、有/无标签、三种优先级、有/无备注）；每天 2–6 条；完成状态混合；有 1–2 天为完全完成的满贯日，有 1 天为 0 条（用于验证空状态）。

- [ ] **Step 2: 生成归档区数据**

`archive/2025/` 下 2 天数据，字段同样完整。

- [ ] **Step 3: 验证全部数据通过校验**

Run: `npm test`（若已有 data 校验测试）或临时脚本调用 `validateEntry` 逐文件检查
Expected: 全部 `ok: true`。

- [ ] **Step 4: 验证页面渲染真实数据**

Run: `npm run build` && `npm run preview`
逐页检查：今日页、某历史日、归档、日历、标签、统计均显示真实内容且无空白。

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(data): seed 10 days of sample entries"
```

---

## Task 12: 后台外壳与技术栈接线

**Files:**
- Create: `src/pages/admin.astro`, `src/admin/AdminApp.tsx`, `src/admin/components/ui/*`（shadcn 产物）、`components.json`
- Create: `src/lib/utils.ts`（`cn` 辅助）

**Interfaces:**
- Produces: `AdminApp` 是 `/admin` 的唯一岛屿，`client:only="react"`。
- Produces: `cn(...inputs: ClassValue[]): string`（`clsx` + `tailwind-merge`）。

- [ ] **Step 1: 配置 shadcn**

Run: `npx shadcn@4.23.0 init`（选 Astro、Tailwind v4 已有、CSS 变量模式），确认 `components.json` 与 `src/lib/utils.ts` 生成，且 `global.css` 未被覆写成另一套色值——**若被覆写，手工改回 spec 7.2 的令牌值。**

- [ ] **Step 2: 只添加需要的组件**

```bash
npx shadcn@4.23.0 add button input textarea checkbox select dialog tabs label sonner
```

Expected: 仅这些组件出现在 `src/admin/components/ui/`。

- [ ] **Step 3: 写 `admin.astro`**

`<AdminApp client:only="react" />`，并设 `<meta name="robots" content="noindex">`。**首页不得引用任何 admin 资源**。

- [ ] **Step 4: 写 `AdminApp.tsx` 骨架**

只渲染状态机当前的视图占位（`locked` / `disconnected` / `ready` / `dirty` / `publishing` 五个分支），用本地 `useState` 手动切换验证。

- [ ] **Step 5: 验证体积隔离**

Run: `npm run build`
Expected: `dist/index.html` 与其它前台页不含 React 运行时脚本；`dist/_astro/` 里 react 相关 chunk 只被 `admin` 页引用。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(admin): add admin island shell with shadcn components"
```

---

## Task 13: GitHub 客户端与原子提交

**Files:**
- Create: `src/lib/github.ts`, `src/lib/github.test.ts`

**Interfaces:**
- Produces:
  - `createGitHubClient(cfg: { token: string; owner: string; repo: string; branch: string; apiBase?: string; fetchImpl?: typeof fetch })`
  - `client.verify(): Promise<{ ok: boolean; expiresAt: string | null; message?: string }>`
  - `client.listDataPaths(): Promise<{ active: string[]; archive: string[] }>`
  - `client.getFile(path: string): Promise<{ content: string; sha: string } | null>`
  - `client.commitChanges(input: { writes: { path: string; content: string }[]; deletes: string[]; message: string; authorName: string; authorEmail: string }): Promise<{ commitSha: string; htmlUrl: string }>`

- [ ] **Step 1: 写失败的测试（注入 `fetchImpl`，不碰真实网络）**

按 Review Focus 4，必须含：

```ts
test('提交序列为 ref → commit → blob×N → tree → commit → patch，且只 patch 一次', async () => {
  const calls: string[] = [];
  await client.commitChanges({ writes: [w('a'), w('b'), w('c')], deletes: [], message: 'm', ... });
  expect(calls.filter(c => c.startsWith('PATCH'))).toHaveLength(1);
  expect(calls.at(-1)).toMatch(/^PATCH/);
});
test('写入 3 个文件只产生 1 次 commit', async () => {
  expect(calls.filter(c => c === 'POST /git/commits')).toHaveLength(1);
});
test('删除项以 sha:null 出现在 tree entries', async () => {});
test('非快进 422 时自动重试并带上新 head', async () => { /* 第一次 PATCH 返回 422，第二次 200 */ });
test('三次都失败则抛错且错误信息可读', async () => {});
test('401 时 verify 返回 ok:false 并带中文提示', async () => {});
test('base64 编码正确处理中文与换行', async () => { /* 内容含中文，断言发出去的 content 可被正确解码 */ });
```

- [ ] **Step 2: 运行确认失败** — `npm test -- src/lib/github.test.ts`

- [ ] **Step 3: 实现 `github.ts`**

关键实现要求：
- 用 `base_tree` 提交（非 `tree`），`entries` 中删除与归档搬迁的源路径用 `{ path, sha: null, mode: "100644", type: "blob" }`。
- 重试最多 3 次，每次重跑完整的 ref→commit→blob→tree→commit→patch 链。
- **绝不 force push**；`PATCH` 不带 `force: true`。
- `verify()` 读响应头 `github-authentication-token-expiration`，取不到则 `expiresAt: null`。
- 所有 API 错误转换成中文可读消息，附 HTTP 状态码。

- [ ] **Step 4: 运行确认通过**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(github): add atomic multi-file commit client"
```

---

## Task 14: 后台登录、连接与数据加载

**Files:**
- Create: `src/admin/state/machine.ts`, `src/admin/state/machine.test.ts`, `src/admin/views/LockedView.tsx`, `src/admin/views/ConnectView.tsx`
- Modify: `src/admin/AdminApp.tsx`

**Interfaces:**
- Consumes: `auth.ts` 的 `verifyPassword`、`github.ts` 的 `createGitHubClient`、`date.ts`。
- Produces (`machine.ts`): 纯 reducer —— `adminReducer(state: AdminState, action: AdminAction): AdminState`，其中
  ```ts
  type AdminState =
    | { status: 'locked'; error?: string }
    | { status: 'disconnected'; tokenExpiresAt: string | null; error?: string }
    | { status: 'ready'; days: Record<string, DayEntry>; selected: string; dirty: Set<string>; tokenExpiresAt: string | null; error?: string }
    | { status: 'publishing'; days: Record<string, DayEntry>; selected: string; dirty: Set<string>; tokenExpiresAt: string | null }
  ```
  `AdminAction` 覆盖 `UNLOCK_OK`、`UNLOCK_FAIL`、`TOKEN_OK`、`TOKEN_FAIL`、`CLEAR_TOKEN`、`SELECT_DAY`、`PATCH_DAY`、`PUBLISH_START`、`PUBLISH_OK`、`PUBLISH_FAIL`。

  **`dirty` 状态不是独立 variant，而是 `ready` 的一个派生量**（`dirty.size > 0`）。`TOKEN_FAIL` 与 `PUBLISH_FAIL` 都停留在 `ready`，只额外带 `error`，因此 `days` 与 `dirty` 天然保留——这正是 Review Focus 4 要求的「失败后改动不丢」，用类型结构保证，而不是靠 reducer 记得别清空。

- [ ] **Step 1: 写 `machine.test.ts` 的失败测试**

```ts
test('locked 输对密码进入 disconnected 且不含 day 数据', () => {
  const s = adminReducer({ status: 'locked' }, { type: 'UNLOCK_OK' });
  expect(s.status).toBe('disconnected');
  expect('days' in s).toBe(false);   // Review Focus: 无 token 不见数据
});
test('token 失效时改动保留', () => {
  const before: AdminState = { status: 'ready', days: sampleDays(), selected: '2026-10-28', dirty: new Set(['2026-10-28']), tokenExpiresAt: null };
  const after = adminReducer(before, { type: 'TOKEN_FAIL', message: '令牌已失效或被撤销，请重新输入' });
  expect(after.status).toBe('ready');
  if (after.status !== 'ready') throw new Error('unreachable');
  expect(after.dirty.has('2026-10-28')).toBe(true);
  expect(after.error).toContain('令牌已失效');
});
test('PUBLISH_FAIL 回到 ready 且 days 与 dirty 原样保留', () => {
  const before: AdminState = { status: 'publishing', days: sampleDays(), selected: '2026-10-28', dirty: new Set(['2026-10-28']), tokenExpiresAt: null };
  const after = adminReducer(before, { type: 'PUBLISH_FAIL', message: '网络中断，改动还在，可以重试' });
  expect(after.status).toBe('ready');
  if (after.status !== 'ready') throw new Error('unreachable');
  expect(after.days['2026-10-28']).toBeDefined();
  expect(after.dirty.size).toBe(1);
});
test('CLEAR_TOKEN 清空数据回 disconnected', () => {
  const s = adminReducer(readyState(), { type: 'CLEAR_TOKEN' });
  expect(s.status).toBe('disconnected');
  expect('days' in s).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现 `machine.ts`**

`dirty` 用 `Set<string>` 记录被改动的日期。`TOKEN_FAIL` 与 `PUBLISH_FAIL` 都返回 `status: 'ready'` 并附 `error`，**不得清空 `days` 或 `dirty`**。`CLEAR_TOKEN` 丢弃 `days` 回 `disconnected`。

- [ ] **Step 4: 实现 `LockedView` 与 `ConnectView`**

`LockedView`：密码框 + 提交；调 `verifyPassword(password, import.meta.env.PUBLIC_ADMIN_PASSWORD_KDF)`；成功写 `sessionStorage["todo.unlock"]`（含 `expiresAt`）。
`ConnectView`：说明文字（fine-grained PAT、仅 `Contents: Read and write`）+ 输入框 + 「验证」；成功存 `localStorage["todo.gh.token"]`，并触发 `listDataPaths` + 读当天。

- [ ] **Step 5: 验证**

Run: `npm run dev`，访问 `/admin`：
- 错密码 → 提示且停留 `locked`
- 对密码 → `disconnected`，**页面无任何任务数据**
- 填假 token → 显示中文错误，`dirty` 不变

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(admin): add unlock, connect and data loading flow"
```

---

## Task 15: 后台编辑面板

**Files:**
- Create: `src/admin/views/EditorView.tsx`, `src/admin/components/DayList.tsx`, `src/admin/components/TaskEditorDialog.tsx`, `src/admin/components/StatusBar.tsx`
- Modify: `src/admin/AdminApp.tsx`

**Interfaces:**
- Consumes: `machine.ts`、`validate.ts` 的 `validateTask`/`normalizeTask`、`order.ts`。
- Produces: 五个操作 —— `addTask(dateKey)`、`updateTask(dateKey, task)`、`deleteTask(dateKey, id)`、`moveTask(dateKey, id, dir: "up" | "down")`、`toggleDone(dateKey, id)`；全部通过 `PATCH_DAY` 落到 reducer。

- [ ] **Step 1: 写 `StatusBar.tsx`**

显示：连接状态（`owner/repo@branch`）、令牌过期日、未保存改动数、`保存并发布` 按钮（无改动或校验未过时 `disabled`）。

- [ ] **Step 2: 写 `DayList.tsx`**

左栏只列日期（**不显示完成数**），点击触发 `SELECT_DAY`；被修改过的日期加标记点。

- [ ] **Step 3: 写 `TaskEditorDialog.tsx`**

字段：标题、备注、时间段起止、优先级、标签（逗号分隔输入）、完成。新增与编辑共用。提交前跑 `validateTask`，错误以中文显示在字段下方。

- [ ] **Step 4: 写 `EditorView.tsx`**

右栏任务列表，每行 `↑ ↓ ✎ 🗑` 四个按钮（`lucide` 图标 + `aria-label` 中文）。**上移/下移实现为数组内交换后重排 `order`**，不引拖拽库。移动端折两行、操作收进 `⋯` 菜单。

- [ ] **Step 5: 验证**

Run: `npm run dev`，在 `/admin` 里：
- 新增 1 条、勾掉 1 条、删 1 条 → 状态栏显示「3 处未保存改动」
- 上移/下移改变顺序且刷新后顺序保持
- 键盘可完成全部操作（Tab 到按钮、Enter 触发）
- 375px 下布局不溢出

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(admin): add day list, task editor and status bar"
```

---

## Task 16: 保存并发布

**Files:**
- Create: `src/admin/publish.ts`, `src/admin/publish.test.ts`
- Modify: `src/admin/AdminApp.tsx`

**Interfaces:**
- Consumes: `github.ts` 的 `commitChanges`、`validate.ts`、`archive.ts` 的 `shouldArchive`/`planArchiveMove`、**`entry-codec.ts`** 的 `serializeEntry`/`entryPath`（**不得 import `data.ts`，那会把 `node:fs` 打进浏览器包**）、`siteConfig.admin.github`。
- Produces: `buildPublishPayload(input: { days: Record<string, DayEntry>; dirty: Set<string>; todayKey: string; dataCfg; afterMonths: number }): { writes: { path: string; content: string }[]; deletes: string[]; summary: string }` —— **纯函数，可单测**。

- [ ] **Step 1: 写 `publish.test.ts` 的失败测试**

按 Review Focus 3 与 4：

```ts
test('只把 dirty 的日期写入 writes', () => {
  const p = buildPublishPayload({ days: {...}, dirty: new Set(['2026-10-28']), ... });
  expect(p.writes.map(w => w.path)).toEqual(['src/data/todos/2026-10-28.json']);
});
test('超出 6 个月的日期同时出现在 writes(新路径) 与 deletes(旧路径)', () => {
  const p = buildPublishPayload({ days: { '2026-03-01': entry }, dirty: new Set(['2026-03-01']), todayKey: '2026-10-28', ... });
  expect(p.deletes).toContain('src/data/todos/2026-03-01.json');
  expect(p.writes.map(w => w.path)).toContain('src/data/archive/2026/2026-03-01.json');
});
test('summary 形如 "3 天 / 12 项改动"', () => {
  expect(p.summary).toMatch(/^\d+ 天 \/ \d+ 项改动$/);
});
test('空 dirty 时 writes 与 deletes 均为空', () => {});
test('publish 链路不引入 node 内置模块', () => {
  const src = readFileSync('src/admin/publish.ts', 'utf8');
  expect(src).not.toMatch(/from ['"]node:/);
});
```

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 → Step 4: 通过**

- [ ] **Step 5: 在 `AdminApp.tsx` 接线**

`保存并发布` → `PUBLISH_START` → 校验通过则 `buildPublishPayload` → `commitChanges` → 成功 `PUBLISH_OK` 并 `toast`（含 commit 链接）；`PUBLISH_FAIL` 保留改动并红条提示。提交信息按 `cfg.commitMessage` 模板生成。

- [ ] **Step 6: 验证**

Run: `npm run dev`，用 Playwright 手工脚本或真实 PAT（小号测试仓库）验证：
- 改 2 天后保存 → GitHub 上只出现 1 个 commit
- 断网后保存 → 提示且改动在
- 提交成功后 `dirty` 清空

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(admin): wire publish flow with archive migration"
```

---

## Task 17: 归档 CLI

**Files:**
- Create: `scripts/archive.mjs`

**Interfaces:**
- Consumes: `archive.ts` 的 `planArchiveMove`、**`entry-codec.ts`** 的 `entryPath`、`site.config.ts` 的 `data` 配置。

- [ ] **Step 1: 写脚本**

只读本地文件、只移动本地文件，**不发起任何网络请求**。输出形如 `已搬迁 37 个文件 → archive/2025/`。`--dry-run` 只打印不移动。

- [ ] **Step 2: 验证**

Run: `npm run archive -- --dry-run`
Expected: 列出 2026-04-28 之前的文件，且文件系统未变化（用文件时间戳或 `git status` 确认）。

Run: `npm run archive`
Expected: 文件被移动到 `src/data/archive/YYYY/`，页面构建后数据仍完整（`npm run build` 通过且归档页仍显示那些日期）。

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(scripts): add offline archive migration CLI"
```

---

## Task 18: 构建产物护栏测试

**Files:**
- Create: `tests/build-guard.test.ts`

**Interfaces:**
- Consumes: `dist/` 产物。

- [ ] **Step 1: 写测试**

```ts
test('必需页面均生成', () => { /* index, archive, stats, admin, calendar, tags */ });
test('前台页面除主题脚本外无其他脚本', () => {
  // 解析 dist/index.html 的所有 <script>，断言总数 <= 2 且内联脚本总长 < 2000
});
test('首页 HTML 不含历史任务标题', () => {
  // 取一条 archived 数据的 title，断言 dist/index.html 中不存在
});
test('admin 页含 noindex', () => {});
test('前台页面不含 react 运行时引用', () => {
  // dist/index.html 不含 /_astro/react 或 client.*.js
});
test('canonical 与 base 前缀正确', () => {});
```

- [ ] **Step 2: 运行**

Run: `npm run build && npm test -- tests/build-guard.test.ts`
Expected: 全部 PASS。若「首页不含历史任务标题」失败，说明性能护栏被破坏，必须修实现而非改测试。

- [ ] **Step 3: Commit**

```bash
git commit -m "test: add build output guardrails"
```

---

## Task 19: 端到端测试

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/admin.spec.ts`, `tests/e2e/public.spec.ts`

**Interfaces:**
- Consumes: `dist/`（用 `astro preview` 或 `vite preview` 起服务）。

- [ ] **Step 1: 写 `playwright.config.ts`**

`webServer` 用 `npm run preview`，`baseURL` 指向本地端口；`projects` 含 `desktop-chromium` 与 `mobile-375`。

- [ ] **Step 2: 写 `public.spec.ts`**

断言：今日页渲染出日期、进度刻度、任务列表；归档页可点进某天；日历页当前月高亮；标签页可访问；统计页无 `NaN`；暗黑模式切换后 `html.dark` 存在且刷新保持。

- [ ] **Step 3: 写 `admin.spec.ts`（GitHub API 全 `page.route` 拦截）**

按 spec 10.3 的 9 条逐条实现，特别是：
- 断言 `PATCH /git/refs` **只出现一次**
- `SELECT_DAY` 切换只新增 1 次 blob 请求，重复点同一日期不再请求
- 422 后自动重试成功、改动不丢
- 401 后按钮禁用、改动保留

- [ ] **Step 4: 运行**

Run: `npm run build && npx playwright test`
Expected: 全部 PASS。

- [ ] **Step 5: 截图留档**

对 `/`、`/archive`、`/calendar`、`/tags/*`、`/stats`、`/admin` 各出明亮+暗黑、1440px+375px 共 4 张，存入 `docs/superpowers/screenshots/`。

- [ ] **Step 6: Commit**

```bash
git commit -m "test: add e2e coverage for public pages and admin flow"
```

---

## Task 20: README 与四平台部署配置

**Files:**
- Create: `README.md`, `.github/workflows/deploy.yml`
- Modify: `site.config.ts`（仅 `site.url`、`site.basePath` 注释）

**Interfaces:**
- Produces: 可复制的四平台配置片段。

- [ ] **Step 1: 写 README 的「首次配置」段**

`npm install` → `npm run gen-password` → 填 `.env` → `npm run dev`。

- [ ] **Step 2: 写「创建 PAT」段**

fine-grained PAT、仅 `Contents: Read and write`、只选该仓库、建议 90 天过期。附一句安全边界说明（密码是遮挡，token 才是门）。

- [ ] **Step 3: 写「部署」段**

四平台表格（spec 9.1 原文），并把 `basePath` 用**加粗单行**强调：GitHub Pages 项目站必须填 `/<仓库名>`，其余填 `/`。

- [ ] **Step 4: 写 `.github/workflows/deploy.yml`**

用 `withastro/action`，`permissions` 含 `pages: write`、`id-token: write`；构建前 `touch public/.nojekyll`（或直接提交该文件）。

- [ ] **Step 5: 验证**

Run: `npm run build`，确认 `site.url`/`basePath` 修改后 canonical 与资源路径随之变化（改一处、构建、看 HTML）。

- [ ] **Step 6: Commit**

```bash
git commit -m "docs: add setup, PAT and four-platform deploy guide"
```

---

## 完成标准

- `npm test` 全绿（纯逻辑 + 产物护栏）
- `npx playwright test` 全绿
- `npm run build` 无警告，除 `/admin` 外页面无 React 运行时
- 五个平台（本地 + 四平台配置）均可部署，仅 `basePath` 需按平台改
- `/admin` 能完成「新增 / 修改 / 删除 / 勾选 / 排序 / 保存并发布」全链路，且一次发布只产生一个 commit
- 无任何秘密进入 git 跟踪文件
