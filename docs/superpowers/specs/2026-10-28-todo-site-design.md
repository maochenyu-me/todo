# 待办簿（TODO）· 设计规格

- 日期：2026-10-28
- 状态：待审阅
- 项目根：`E:\github_maochenyu_me\TODO`

## 1. 目标与意图

做一个**日记式待办簿**：自己每天记录要做什么、划掉做完了什么；站点**完全公开只读**，访客看到的是一个干净的工作日志。修改不靠打开编辑器，而是进网页后台，点鼠标增删改，一次「保存并发布」把改动作为单个 commit 推到 GitHub，平台自动重新构建上线。

成功标准：

1. 打开首页 1 秒内看到今天的任务与完成进度，无需登录、无加载态闪烁。
2. 后台能在不打开编辑器的情况下，完成「新增 / 修改 / 删除 / 勾选完成 / 调整顺序」五类操作。
3. 点一次「保存并发布」只产生**一个** commit，无论改了多少天的数据。
4. 同一份代码可直接部署到 GitHub Pages、Cloudflare Pages、Vercel、EdgeOne，只有 `basePath` 一处需要按平台改。
5. 站点外观不依赖任何客户端 JS，除 `/admin` 外页面不加载 React。
6. 部署后出现「我改了数据但站点没变」这类静默故障的概率接近零——靠 E2E 断言提交序列与产物体积护栏保证。

## 2. 关键取舍与理由

### 2.1 凭据：密码在构建产物里，Token 只在浏览器

纯静态站点没有服务端，任何写进 `.env` 的值都会被内联进 JS bundle，**任何人可读**。因此：

- **后台密码**：`.env` 里存的是 **PBKDF2-SHA256 / 60 万轮 / 16 字节随机盐** 的派生值（不是明文）。60 万轮让每次猜测成本极高，10 位以上密码实际无解。
- **GitHub Token**：**不进代码、不进 `.env`、不进构建产物**。首次在面板里输入后存 `localStorage`，只向 `api.github.com` 发送。

安全边界必须说清楚：**密码门是 UI 遮挡，防的是路人，不是攻击者。** 真正的安全边界是 Token 只存在于你自己的浏览器——即使有人破解密码、进入后台面板，他拿到的是一个空面板，没有 Token 就动不了仓库。

### 2.2 数据流：构建时烘焙

前台数据在构建时读入并烘焙进 HTML。提交后由平台 push 触发自动重建，延迟约 1–2 分钟。

代价（明确接受）：从提交到线上可见有 1–2 分钟延迟。收益：SEO 正常、首屏极快、无需运行时跨域请求、公开仓库与私有仓库行为一致。

### 2.3 提交：Git Data API 原子提交

改 N 个文件只产生 1 个 commit。用 `base_tree` 只描述差异，归档搬迁 = 源路径 `sha: null` + 目标路径新 blob，同一 commit 内原子完成。逐文件 Contents API 会产生 N 个 commit 且中途失败会留下半截状态，不采用。

### 2.4 前台零 JS

除明暗模式切换（约 400 字节内联脚本）与 `/admin` 的 React 岛，前台不加载客户端 JS。统计图表因此改为**构建期内联 SVG**，不引图表库。

**前台不做「点着玩」的勾选**：公开页面是「看今天做到了什么」的窗口，不是操作台。勾选发生在 `/admin`。这避免了「点了以为真改了」的误解。

## 3. 数据模型

### 3.1 单日文件

路径：`src/data/todos/YYYY-MM-DD.json`

```json
{
  "date": "2026-10-28",
  "tasks": [
    {
      "id": "k3f9x2",
      "title": "写完归档脚本",
      "done": false,
      "completedAt": null,
      "order": 0,
      "priority": 1,
      "tags": ["开发"],
      "note": "先跑通再优化",
      "timeBlock": { "start": "09:00", "end": "10:30" },
      "createdAt": "2026-10-28T08:12:00+08:00",
      "updatedAt": "2026-10-28T08:12:00+08:00"
    }
  ]
}
```

字段约定：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | string | 6 位短随机串，**同一文件内**唯一即可 |
| `title` | string | 非空，≤ 200 字 |
| `done` | boolean | — |
| `completedAt` | ISO string \| null | `done: true` 时必须有值（面板自愈补全） |
| `order` | number | 手动排序序号，同文件内从 0 递增 |
| `priority` | 0 \| 1 \| 2 | `0=高 / 1=中 / 2=低`，数字便于排序 |
| `tags` | string[] | ≤ 10 个，每个 ≤ 20 字，去重 |
| `note` | string | ≤ 2000 字，可为空串 |
| `timeBlock` | `{start,end}` \| null | `HH:mm` 24 小时制，`end > start` |
| `createdAt` / `updatedAt` | ISO string | 带 `+08:00` 偏移 |

文件不存在 = 那天无记录，不生成空白页。文件名日期必须与内容 `date` 一致，不一致则构建期报错。

### 3.2 归档结构

```
src/data/todos/            活跃区：滚动最近 6 个月的每日文件
src/data/archive/2025/     归档区：按年分文件夹
```

三条硬规则：

1. **物理位置只影响整理，不影响读取。** `loadAllEntries()` 同时扫描 `todos/` 与 `archive/**/`，按 `date` 合并去重。即使该搬未搬，页面也不缺数据、不 404。
2. **搬迁只在有写权限处发生**：面板「保存并发布」时（与其他改动同一 commit），或手动跑 `npm run archive`（**纯本地，不碰网络**）。构建期是只读的，永不搬文件。
3. **面板的数据一律从 GitHub 仓库读，不读构建产物。** 仓库是唯一事实来源：`GET /git/trees/{branch}?recursive=1` 一次列出全部数据文件路径（活跃区与归档区都在内），再按需取 blob。这样后台永远看到的是最新数据，从根上消除「拿陈旧快照覆盖别人改动」的风险。代价是密码通过后仍需 Token 才能看到数据——Token 本来就必须有，因此状态机反而更简单。

边界：`archiveAfterMonths: 6`，相对今天滚动推移，写入 `site.config.ts`。文件落地按 `archive/YYYY/` 年份分桶。

### 3.3 性能护栏（写进实现计划，不是愿望）

- 首页只读 1 个文件；日历只读当月；统计读构建期聚合结果。
- 除 `/admin` 外不加载 React、不向客户端发送任务数据。
- `/archive` 用构建期算好的「每日完成数摘要」，不内联任务标题。
- 单页渲染任务数上限 200（兜底）。

## 4. 配置文件 `site.config.ts`

唯一配置入口，**不含任何秘密**（它会被前台构建读取，也可能出现在浏览器）。所有文案、颜色、开关、路径、分页大小均由此提供；页面里不出现裸字符串日期格式、裸数字、裸色值。

```ts
export const siteConfig = {
  site: {
    title: "待办簿",
    tagline: "每天写清楚要做什么，然后一条条划掉。",
    author: "maochenyu",
    url: "https://example.github.io",
    basePath: "/",              // GH Pages 项目站填 "/<repo>"
    lang: "zh-CN",
    timeZone: "Asia/Shanghai",  // 全站"今天"的唯一依据
  },
  data: {
    activeDir: "src/data/todos",
    archiveDir: "src/data/archive",
    archiveAfterMonths: 6,
  },
  theme: {
    defaultMode: "system",      // "light" | "dark" | "system"
    accent: { light: "#BE3A2B", dark: "#E4675A" },  // 注入为 --seal
    radius: "0.5rem",
    enableToggle: true,
  },
  frontend: {
    weekStartsOn: 1,
    dateFormat: { today: "long", list: "medium", archive: "year-month" },
    maxTasksPerPage: 200,
    showTimeBlock: true,
    showTags: true,
    showPriority: true,
    pages: { today: true, day: true, archive: true, calendar: true, tags: true, stats: true },
    stats: { range: "last-12-months", showStreak: true, showCompletionRate: true, showTrend: true },
    tagRules: { maxVisible: 30, minCount: 1 },
  },
  admin: {
    path: "/admin",
    sessionMinutes: 120,
    requirePasswordOnRefresh: false,
    github: {
      owner: "maochenyu",
      repo: "TODO",
      branch: "main",
      dataPathPrefix: "",
      commitMessage: "chore(todo): {date} — {summary}",
      authorName: "todo-admin",
      authorEmail: "todo-admin@users.noreply.github.com",
      apiBase: "https://api.github.com",
    },
  },
  deploy: {
    platform: "auto",           // "github-pages" | "cloudflare" | "vercel" | "edgeone" | "auto"
    buildCommand: "npm run build",
    outputDir: "dist",
  },
} as const;
```

### 4.1 密码派生值

`.env`（不进 git）与 `.env.example`（进 git）：

```
PUBLIC_ADMIN_PASSWORD_KDF=pbkdf2$600000$<base64-salt>$<base64-hash>
```

由 `npm run gen-password` 交互式生成。`PUBLIC_` 前缀意味着它必然进 bundle——这是既定取舍，因此设计成「泄露了也换不了任何权限」的形态。校验用 WebCrypto，比对用定长比较避免时序差。

## 5. 目录结构

```
TODO/
├─ .env.example
├─ astro.config.mjs
├─ site.config.ts            ← 唯一配置入口
├─ package.json
├─ README.md
├─ scripts/
│  ├─ gen-password.mjs
│  └─ archive.mjs            ← 滚动归档 CLI（不碰网络）
└─ src/
   ├─ data/todos/            ← 活跃数据
   ├─ data/archive/          ← 归档数据
   ├─ lib/                   ← 纯逻辑，无框架依赖，可单测
   │  ├─ data.ts             ← 合并读取、校验、序列化
   │  ├─ date.ts             ← 固定时区日期运算
   │  ├─ stats.ts            ← 完成率 / 连续打卡 / 趋势聚合
   │  ├─ archive.ts          ← 搬迁决策
   │  ├─ validate.ts         ← 提交前校验规则
   │  ├─ github.ts           ← Git Data API 客户端（原子提交）
   │  └─ auth.ts             ← PBKDF2 校验
   ├─ components/            ← 前台 .astro 组件（零客户端 JS）
   ├─ layouts/BaseLayout.astro
   ├─ styles/global.css      ← Tailwind v4 + 设计令牌
   ├─ pages/
   │  ├─ index.astro         ← 今日
   │  ├─ date/[date].astro
   │  ├─ archive.astro
   │  ├─ calendar/index.astro + [month].astro
   │  ├─ tags/[tag].astro
   │  ├─ stats.astro
   │  └─ admin.astro         ← 仅此页加载 React
   └─ admin/                 ← React 岛源码
```

## 6. 技术栈

版本均已实测锁定（在本机跑通构建，非推测）：

| 层 | 选择 | 版本 |
|---|---|---|
| 框架 | **Astro** | `7.4.2` |
| React 岛 | `@astrojs/react` + React 19 | `7.1.1` / `19.3.1` |
| 样式 | **Tailwind CSS v4**（`@tailwindcss/vite`） | `4.3.3` |
| 后台组件 | **shadcn/ui**（Radix 原语） | CLI `shadcn@4.23.0` |
| 图标 | 前台 `@lucide/astro`，后台 `lucide-react` | `1.62.0` |
| 测试 | Vitest / Playwright | `5.0.5` / `1.64.1` |
| 类型 | TypeScript（用 5.9.x，不用 7.x） | `5.9.3` |

| 层 | 理由 |
|---|---|
| Astro 7 静态优先 | 页面默认零 JS；后台作为单独岛按需加载，React 体积不捎给前台访客 |
| Tailwind v4 | 与 shadcn 共用 CSS 变量主题；`@custom-variant dark` 实现类切换 |
| shadcn/ui | 代码分发、可完全掌控；主题即 CSS 变量，天然与前台共用一套皮肤 |
| lucide | 前后台同一图标集，视觉统一；前台包输出内联 SVG，零运行时 |
| 图表无库 | 构建期手写内联 SVG，避免为几张图引入客户端 JS |
| 三层测试 | 从快到慢，覆盖「保存即发布」链路 |

**Astro 7 的三处行为必须写进实现细节**（均已核实）：
1. **Rust 编译器**取代 Go 编译器，**未闭合标签直接报错**，不再静默修正非法 HTML 嵌套。模板必须写全闭合标签。
2. `compressHTML` 默认值从 `true` 改为 `'jsx'`，**行内元素之间的空格会被吞掉**。中文排版里 `<span>` 相邻时需显式 `{" "}`。
3. 需要 **Node ≥ 22.23.4**，Vite 8。

**TypeScript 用 5.9.x 而非 7.x**：`typescript@7` 是新一代原生编译器，与现有 `astro check` / 编辑器链路尚未全面对齐，本期不冒险。

**前台不用组件库**：shadcn 是 React 代码，前台零 JS 场景用不上；它真正的价值是把主题定义为 CSS 变量，前后台共享这套变量即可保持外观一致。

**前台不用组件库**：shadcn 是 React 代码，前台零 JS 场景用不上；它真正的价值是把主题定义为 CSS 变量，前后台共享这套变量即可保持外观一致。

## 7. 视觉设计

### 7.1 设计依据

站点的主体是「簿」——按天记录的册子，有格线、有页码、有日期。视觉语汇取自**办公文具与档案**：簿纸、格线、检索标签、印章、勾选。结构装置（横线、标签、分栏）承担信息，不作装饰。

主动避开的通用套路：奶油底 + 高对比衬线 + 土橘色；近黑底 + 荧光绿；通栏发丝线报纸排版；内容一律切成同半径圆角卡片 + 同一柔和灰阴影；每段标题上方一排大写小字标签；`A · B · C` 中点串。

### 7.2 色彩

底色为**冷调簿纸**（非暖奶油），文字为**蓝黑墨水**（非纯黑），唯一强调色为**印章朱红**（非陶土橙），仅用于日期印章与高优先级这类极小面积。

明亮：
`--background #EFF1EC` / `--card #FCFCFA` / `--foreground #1B2430` / `--muted-foreground #5C6773` / `--border #D5D9D0` / `--primary #23407A` / `--seal #BE3A2B` / `--done #2F6B4F`

暗黑：
`--background #12171C` / `--card #171E24` / `--foreground #E6E9E4` / `--muted-foreground #92A0AC` / `--border #26313A` / `--primary #7FA0E8` / `--seal #E4675A` / `--done #6FAF88`

变量名对齐 shadcn 命名（`--background` / `--foreground` / `--primary`…），后台 Radix 组件零额外工作继承同一皮肤。

### 7.3 字体

- 拉丁与数字：**IBM Plex Sans**（400/500/600）。人文主义无衬线，在日期大字上有印刷品气质。
- 中文：`PingFang SC, HarmonyOS Sans SC, Microsoft YaHei, Noto Sans SC` **系统栈**，不加载中文 webfont（子集动辄数百 KB，为此牺牲首屏不值）。
- 数字统一 `font-variant-numeric: tabular-nums`。**不用等宽字体做小标签**。
- 字号：日期 `clamp(2rem, 5vw, 3.25rem)` / 600 / `-0.02em`；正文 `1rem` / `1.65`；小字 `0.8125rem`。中文行宽约 34 字。

### 7.4 布局

桌面 ≥1024px：**左检索栏（常驻，sticky）+ 右正文**；窄屏收为顶栏。内容左对齐，不居中、不两端齐。

**全站唯一记忆点：倾斜 2° 的日期印章块**——朱红细边框、年月日三行错落。其余一切安静。

进度**不用圆环、不用渐变条**，用一排**小方块刻度**：任务数即格数，已完成填墨。

**格线只出现在任务列表内部**（作为「写的横线」），不做通栏装饰。

### 7.5 页面

**今日 `/`** — 印章日期 + 刻度进度 + 任务行。排序：有 `timeBlock` 按开始时间升序在前，无 `timeBlock` 按 `order` 在后；已完成收进底部「已完成 N」分组，用原生 `<details>` 折叠，零 JS。行内固定顺序：时间段 → 勾选框字形 → 标题 → 标签 → 优先级。底部「前一天 / 后一天」，无数据置灰。

**任一天 `/date/[date]`** — 同布局。`/` 渲染今天，`/date/<今天>` 的 canonical 指回 `/`，避免重复内容。

**归档 `/archive`** — 连续表，非卡片网格。按年月分组，左侧年份锚点。每行 `日期 | 完成 N/M | 细刻度`，不内联任务标题。悬停浮出当日标签。无记录日期以灰色占位、不链接。

**日历 `/calendar`** — 七列月历。格内日期数字下压一条按完成度填充的横条（密度表达，不用红绿）。有记录日期可点。月份切换用链接：构建期为有数据的每个月生成 `/calendar/YYYY-MM`，`/calendar` 默认最新月。周起始读 `weekStartsOn`。

**标签 `/tags/[tag]`** — 该标签下历史任务按日倒序，左侧挂日期小标签。顶部标签索引最多 `maxVisible` 个；少于 `minCount` 条不建页。

**统计 `/stats`** — 零 JS，构建期内联 SVG。近 12 周每周完成数用**竖排小方块柱状图**（与首页刻度同语汇）；连续打卡天数与总完成率为两个大数字 + 一行说明（无渐变、无光环）；90 天完成率折线为 1.5px 墨线，无区域填充、无阴影、无装饰圆点。

**后台 `/admin`** — 唯一 React 岛，shadcn/ui 组件。与前台共用 CSS 变量，是同一本簿子的编辑台而非另一套皮。移动端编辑用底部抽屉。

### 7.6 明暗模式

三态（跟随系统 / 明亮 / 暗黑），存 `localStorage`；`<head>` 内联脚本在首帧前给 `<html>` 打 `class` 避免闪白；Tailwind v4 用 `@custom-variant dark (&:where(.dark, .dark *))`。

### 7.7 无障碍与响应式底线

键盘焦点环用 `--primary` 可见；`prefers-reduced-motion` 下关闭全部过渡；明暗两套配色均过 WCAG AA（正文对比度 ≥ 4.5:1）；任务行用语义化 `<ul>/<li>`，完成状态用 `<s>` + 屏幕阅读器文案；窄屏任务行折两行（时间段独占一行，标签换行不截断）。

## 8. 后台面板

### 8.1 状态机

```
locked ──密码正确──> disconnected ──token 有效──> ready ──改动──> dirty
                         ↑                        │                │
                         └──── 清除 token ─────────┘                │
                                                                    │ 保存并发布
                                                                    ↓
                                                       publishing ──成功──> ready
                                                            └──失败──> dirty（改动全部保留）
```

- `locked`：仅密码框。
- `disconnected`：顶部条提示「未连接 GitHub」，此状态**不展示待办数据**（因为数据只能从仓库读）。只有一个「连接 GitHub」按钮。
- `ready`：已拉到仓库数据，可浏览与编辑。
- `dirty`：顶部条显示「N 处未保存改动」，高亮「保存并发布」。
- `publishing`：按钮进进度态，输入锁死防连点。

这个顺序（先密码、后 Token、才见数据）是刻意的：它让「没有 Token 就没有数据」成为结构事实，而不是一句口头承诺。

### 8.2 密码门

`npm run gen-password` 交互式生成派生值写入 `.env`，并打印明文供存入密码管理器。校验用 WebCrypto，定长比较。通过后写 `sessionStorage: { unlockedAt, expiresAt }`，有效期 `sessionMinutes`。刷新未过期则直接进 `disconnected`（对应 `requirePasswordOnRefresh: false`）；关闭标签页自动清空。

### 8.3 Token 管理

只存 `localStorage["todo.gh.token"]`，只向 `api.github.com` 发送，不经第三方、不写日志、不进构建产物。

首次连接：Dialog 说明需 **fine-grained PAT**，权限仅 `Contents: Read and write`（且只选该仓库）→ 粘贴后「验证」调 `GET /repos/{owner}/{repo}`，并读响应头 `github-authentication-token-expiration` 显示过期日 → 通过后顶部条显示「已连接 owner/repo · branch · 令牌 YYYY-MM-DD 过期」。

失效（401/403）：顶部条转红「令牌已失效或被撤销，请重新输入」，禁用保存按钮，**改动不丢**，重输后可原样重试。「清除令牌」随时可用。

### 8.4 面板布局

```
┌──────────────────────────────────────────────────────────────┐
│ 待办簿 · 后台        ● 已连接 TODO@main      3 处未保存 [保存并发布]│
├────────────┬─────────────────────────────────────────────────┤
│ 最近 90 天  │  2026-10-28 周三                    完成 3 / 7  │
│ ▸ 10-28 ●  │  ┌──────────────────────────────────────────┐  │
│ ▸ 10-27    │  │ 09:00–10:30 ☑ 写完归档脚本        ↑ ↓ ✎ 🗑│  │
│ ▸ 10-26    │  │ 10:30–11:00 ☐ 回复邮件            ↑ ↓ ✎ 🗑│  │
│ …          │  └──────────────────────────────────────────┘  │
│ [选择其他日期]│  [+ 新增待办]                                   │
└────────────┴─────────────────────────────────────────────────┘
```

**左栏只列日期，不显示完成数。** 完成数需要读文件内容，90 天就是 90 次 blob 请求——为了一行「3/7」不值得。所以：打开面板只发 **1 次 Tree API**（全部数据文件路径）+ **1 次 blob**（当前选中那天）；切到别的日期再取那一个。点过的日期在本次会话内缓存，不重复请求。

右栏选中哪天，才需要哪天内容；提交时也只上传真正改动过的那些天。这样 API 调用量与你实际改动的天数成正比，而不是与历史长度成正比。

**排序用手动上移 / 下移按钮，不引拖拽库**：拖拽要多一个依赖、键盘与触屏都难做对；上下移可聚焦、可键盘操作、零依赖，行的顺序即 `order` 字段。移动端每行折两行，操作收进 `⋯` 菜单。

编辑走 `Dialog` 表单（标题、备注、时间段起止、优先级、标签、完成），新增与修改共用同一表单组件。

### 8.5 原子提交序列

改动 N 天数据、删 M 条、触发 K 个归档搬迁 → **仍只有 1 个 commit**。

```
① GET   /git/ref/heads/{branch}              → headCommitSha
② GET   /git/commits/{headCommitSha}         → baseTreeSha
③ POST  /git/blobs          × N              → 每个新/改文件 blobSha（base64 UTF-8）
④ POST  /git/trees { base_tree, entries[] }  → newTreeSha
⑤ POST  /git/commits { message, tree, parents:[head] } → newCommitSha
⑥ PATCH /git/refs/heads/{branch} { sha }     → 完成
```

`entries[]` 三类条目：新增/修改 `{path, mode:"100644", type:"blob", sha}`；删除与归档搬迁的**源路径** `{path, sha: null}`。搬迁在 git 眼里即同 commit 内的 delete + add，原子无中间态。用 `base_tree`（非 `tree`）只描述差异，仓库再大请求体也只有改动文件。

提交信息按模板：`chore(todo): 2026-10-28 — 3 天 / 12 项改动`。

### 8.6 冲突与重试

`PATCH /git/refs` 非快进会被拒（422）。处理：

1. 自动重跑 ①–⑥，把面板改动重新应用到新 head 之上，最多 3 次。
2. 仍失败 → 停，顶部条红色提示，**改动原样保留**，文案：「远程仓库在你操作期间有新提交，请刷新页面确认后重试」。
3. **绝不 force push。** 该按钮不写进代码。

### 8.7 提交前校验（硬闸）

任一不通过则「保存并发布」禁用，顶部汇总「N 项待修正」。

| 规则 | 文案 |
|---|---|
| 标题非空 | 待办需要一个标题。 |
| 标题 ≤ 200 字 | 标题最多 200 字，长内容请写进备注。 |
| 备注 ≤ 2000 字 | 备注最多 2000 字。 |
| 标签 ≤ 10 个、每个 ≤ 20 字 | 最多 10 个标签，每个不超过 20 字。 |
| `timeBlock.end > timeBlock.start` | 结束时间要晚于开始时间。 |
| 同日任务 id 不重复 | 出现重复标识，请删除后重新添加这一条。 |
| `done: true` 必有 `completedAt` | 不报错，面板自动补全时间戳（自愈优先于让用户理解内部约束） |

### 8.8 意外处理

- 断网 / 超时：`publishing` → `dirty`，提示「网络中断，改动还在，可以重试」，**不重载页面、不清空面板**。
- 有未保存改动时关标签页：原生 `beforeunload` 拦一次（兜底，不引入自动存草稿）。
- 提交成功：`Toast`「已提交 · 部署通常 1–2 分钟完成」，附 commit 的 `html_url` 链接。

## 9. 部署

### 9.1 四平台差异

| | `basePath` | 构建命令 / 产物 | 密码变量注入 | 额外动作 |
|---|---|---|---|---|
| GitHub Pages | `"/TODO"` | `npm run build` → `dist` | Actions Secrets | 需 `.nojekyll`；用 `withastro/action` |
| Cloudflare Pages | `"/"` | `npm run build` → `dist` | Pages 环境变量 | 设 `NODE_VERSION=22` |
| Vercel | `"/"` | 自动识别 Astro → `dist` | Vercel 环境变量 | 无 |
| EdgeOne | `"/"` | `npm run build` → `dist` | 项目环境变量 | 无 |

`platform: "auto"` 构建时读 `GITHUB_ACTIONS` / `CF_PAGES` / `VERCEL` / `EDGEONE` 自动推断。**只有 GH Pages 需手改 `basePath`**（项目站子路径平台猜不出），这是唯一「忘了改就白屏」的坑，README 中单行强调。

四份配置以可复制片段写入 `README.md`，不生成 `vercel.json` / `wrangler.toml` 等本项目不需要的文件。

### 9.2 链路

`/admin` 保存并发布 → Git Data API 单 commit → GitHub 分支更新 → 平台 push 触发构建（约 1–2 分钟）→ 线上更新。无需额外服务、webhook 或定时任务。

## 10. 测试

### 10.1 纯逻辑单测（Vitest）

`src/lib/` 为无框架依赖纯函数，直接可测：

- `date.ts`：固定时区算「今天」（构造 UTC 16:30 应得次日）、跨月跨年、`archiveAfterMonths` 边界（正好第 6 个月搬不搬）
- `data.ts`：活跃区与归档区合并去重、字段校验、坏数据不炸（缺 `tasks`、文件名与 `date` 不符）
- `stats.ts`：完成率、连续打卡（含「今天没记录不算断」边界）
- `archive.ts`：搬迁决策纯函数（日期列表 + 今天 → 该搬哪些）
- `validate.ts`：8.7 表格逐条

### 10.2 构建冒烟（`npm run build` 即测试）

产物断言：`dist/` 存在 `index.html` / `archive/index.html` / `stats/index.html` / `admin/index.html`；除 `/admin` 外每页 `<script>` 总量 < 2KB；首页 HTML 不含历史任务标题（防性能护栏被悄悄破坏）；`sitemap` 与 `canonical` 正确。

### 10.3 端到端（Playwright，GitHub API 全 `page.route` 拦截）

1. 错密码 → 停在 `locked` 并提示
2. 对密码 → 进 `disconnected`，且**断言此时页面上没有任何待办数据**
3. 假 token → 进入 `ready`：先发 1 次 Tree API，再发 1 次 blob 取当天，顶部条出现分支名
4. 新增一条、勾掉一条、删一条 → 显示「3 处未保存改动」
5. 断言调用序列 `tree → blob → ref → commit → blob×N → tree → commit → patch`，且**只发一次 `PATCH /git/refs`**（确认真只有一个 commit）
6. 切换日期只新增 1 次 blob 请求，重复切换同一日期不再发请求（缓存生效）
7. `PATCH` 返回 422 → 自动重试、第二次成功、改动不丢
8. `401` → 按钮禁用、改动保留、顶部条转红
9. 刷新 → 未过期则免密进入 `disconnected`（仍需 Token，因为数据来自仓库）

截图对比：明暗两套 × 桌面 / 375px 两档，另截 `prefers-reduced-motion` 一张。

### 10.4 本地验收

- 播种约 10 天真实感中文示例数据（按今天 2026-10-28 回溯，含备注 / 标签 / 时间段 / 优先级 / 完成混合），`archive/2025/` 放几天。
- `npm run dev` 起本地服务，逐页截图供审阅。
- 示例数据保留（兼作文档，首次跑 `npm run archive` 即可见效果）。
- **全程不 `git init`、不 commit、不 push**，等确认后再建仓库。

## 11. README 三段

1. **首次配置**：`npm install` → `npm run gen-password` → 填 `.env` → `npm run dev`
2. **创建 PAT**：步骤 + 仅需 `Contents: Read and write` + 建议 90 天过期
3. **部署**：四平台表格 + `basePath` 单点警告

## 12. 明确不做

- 前台登录 / 私密任务标记（前台完全公开）
- 前台「点着玩」勾选
- 拖拽排序
- 自动存草稿、历史回滚面板
- 服务端鉴权、Serverless 函数
- 多人协作 / 并发编辑
- 图表库
- 中文 webfont
