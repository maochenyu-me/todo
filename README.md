# 待办簿

每天写清楚要做什么，然后一条条划掉。

一本**纯静态**的日记式待办簿：白天在公开页面上看今天的事，晚上进后台把完成情况改掉、发布，站点在一两分钟内自动更新。前台没有登录、没有框架运行时、没有第三方脚本；唯一的 JavaScript 是一个密码保护的后台编辑器。

- **前台零 JS**：六个公开页面都是构建期渲染好的 HTML（每页内联脚本约 1.2 KB，只用来在首帧前定明暗）。
- **数据就是文件**：一天一个 JSON，提交进 Git 仓库。没有数据库、没有服务端、没有定时任务。
- **一次发布 = 一个 commit**：后台改动先留在内存里，点「保存并发布」时用 Git Data API 组装 blob → tree → commit，最后**只移动一次分支指针**。中途任何一步失败，仓库一个字都没变。
- **数据只从仓库读**：后台不读构建产物，所以不会出现「网页上是旧的、仓库里是新的」这种双真相。

---

## 环境要求

- **Node ≥ 22.23.4**（Astro 7 的下限，见 `package.json` 的 `engines`）
- 一个 GitHub 仓库（用来存数据、跑部署）

## 首次配置

```bash
npm install
npm run gen-password     # 交互式输入口令，输出一行派生值
```

把输出的**那一整行**粘进项目根目录的 `.env`：

```dotenv
PUBLIC_ADMIN_PASSWORD_KDF=pbkdf2\$600000\$<base64-salt>\$<base64-hash>
```

没有 `.env` 就从 `.env.example` 复制一份。

> ### ⚠️ 值里的 `$` 必须写成 `\$`
>
> `.env` 会被 dotenv 做变量展开：`$600000`、`$<salt>`、`$<hash>` 都会被当成变量名展开成空串，
> 整串于是塌成一个 `pbkdf2`，表现成**「口令永远不对」**——而且看不出原因。
>
> `npm run gen-password` 已经替你转义好了，**原样粘贴整行**就行。反斜杠是文本格式的转义，
> 加载时会被还原，浏览器里拿到的仍是正常的 `$`。
>
> 忘了转义的话，后台会直接告诉你「口令配置的值不完整」并显示当前读到的值，而不是骗你说口令错了。

然后起开发服务器：

```bash
npm run dev          # http://localhost:4321
```

打开 `/admin`，输刚才那个口令，粘贴一条 GitHub 令牌（见下一节），就能开始编辑。

### PowerShell 用户注意

PowerShell 5.1 的 `>>` 默认按 UTF-16 写文件，`npm run gen-password >> .env` 会把 `.env` 写成乱码。
**手动复制粘贴那一行**，别用重定向。

---

## 创建 GitHub 令牌

后台需要一条 **fine-grained personal access token**（细粒度令牌）：

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. **Repository access**：只选这一个仓库（**不要**选 All repositories）
3. **Permissions** → **Repository permissions** → **Contents: Read and write**（其余全部留空）
4. **Expiration**：建议 **90 天**（到期后重新生成一条，在后台「清除令牌」再连一次）

令牌只保存在**你自己的浏览器**的 `localStorage` 里，不会进仓库、不会进站点源码、不会出现在地址栏或错误提示里。换一台设备要重新粘贴一次。

### 安全边界（请先读完这一句）

> **口令只是界面遮挡，令牌才是门。**
>
> 后台的代码跑在你自己的浏览器里，任何人都能改 JS 跳过口令校验——这一点设计上是承认的。
> 真正的保护是「没有令牌就没有数据」：数据只能通过令牌从你自己的仓库读出来。
> 所以口令请当它是一块遮羞布（防同事路过顺手点两下），真正的门是那条只对一个仓库有
> 读写权限、90 天过期的令牌。

---

## 日常使用

1. 打开 `/admin`，输口令 → 粘令牌 → 连上仓库
2. 左栏选日期，右栏增删改、勾选、上下移动
3. 顶部条会显示「N 天有未保存改动」
4. 点「保存并发布」→ 成功后出现提交链接，约 1–2 分钟后线上更新

发布时会自动处理归档：**超过 6 个月**的日期会被写进 `src/data/archive/YYYY/` 并从活跃区删掉，
这件事和你的编辑在**同一个 commit** 里完成，不会出现「两边都有」或「两边都没有」的中间状态。

---

## 部署

同一份代码可以部署到四个平台，**只有 `basePath` 一处需要按平台改**。

| | `basePath` | 构建命令 / 产物 | 口令变量注入 | 额外动作 |
|---|---|---|---|---|
| **GitHub Pages** | `"/<仓库名>"` | `npm run build` → `dist` | Actions Secrets | 需 `.nojekyll`；用 `withastro/action` |
| **Cloudflare Pages** | `"/"` | `npm run build` → `dist` | Pages 环境变量 | 设 `NODE_VERSION=22` |
| **Vercel** | `"/"` | 自动识别 Astro → `dist` | Vercel 环境变量 | 无 |
| **EdgeOne** | `"/"` | `npm run build` → `dist` | 项目环境变量 | 无 |

> ### ⚠️ GitHub Pages 项目站必须把 `basePath` 改成 `/<仓库名>`
>
> 这是**唯一「忘了改就白屏」的坑**。`https://<用户名>.github.io/<仓库名>/` 是子路径部署，
> 而其余三个平台都是根域部署。
>
> 改 `site.config.ts` 里这一行（`site.url` 同时改成你的站点地址）：
>
> ```ts
> site: { url: "https://<用户名>.github.io", basePath: "/<仓库名>" }
> ```
>
> 项目站子路径平台猜不出来，只能人肉填。

### GitHub Pages

仓库里已带 `.github/workflows/deploy.yml`（`withastro/action` + `actions/deploy-pages`）。要做的只有三件：

1. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**
2. 仓库 **Settings → Secrets and variables → Actions** 新建 secret：名字 `PUBLIC_ADMIN_PASSWORD_KDF`，值是 `npm run gen-password` 输出的**那一整行等号右边的部分**（含 `\$` 转义）
3. 按上面的警告改 `basePath`，push 到 `main`

### Cloudflare Pages

- Framework preset：**Astro**
- Build command：`npm run build`
- Build output directory：`dist`
- 环境变量：`PUBLIC_ADMIN_PASSWORD_KDF`（同上）、`NODE_VERSION=22`

### Vercel

- 直接导入仓库，框架自动识别为 Astro（Build `npm run build`，Output `dist`）
- 环境变量：`PUBLIC_ADMIN_PASSWORD_KDF`
- 无需 `vercel.json`

### EdgeOne Pages

- 构建命令 `npm run build`，输出目录 `dist`
- 项目环境变量：`PUBLIC_ADMIN_PASSWORD_KDF`
- 无需额外配置文件

> 本项目**不需要** `vercel.json`、`wrangler.toml` 之类的平台文件——四份配置都是上面这些可复制的片段，
> 少一个文件就少一处会和代码分叉的地方。

---

## 数据文件与归档

```
src/data/
  todos/            活跃区：YYYY-MM-DD.json（最近 6 个月）
  archive/YYYY/     归档区：YYYY/YYYY-MM-DD.json（更早的）
```

一天一个文件，字段固定（`date` + `tasks[]`，任务含标题/完成/时间段/优先级/标签/备注/时间戳）。
写盘时字段顺序固定、两空格缩进、结尾换行，所以 git diff 永远只显示真正变了的那几行。

手动把活跃区里超过 6 个月的日期搬进归档区：

```bash
node scripts/archive.mjs --dry-run   # 只列出要搬哪些，不动文件
node scripts/archive.mjs             # 真搬
```

> ### ⚠️ Windows PowerShell 5.1 会吃掉 `npm run` 的第一个 `--`
>
> 所以 `npm run archive -- --dry-run` 里的 `--dry-run` **根本到不了脚本**，dry-run 会变成
> **真实搬迁**（这个坑真踩过一次，靠 `git status` 当场发现才恢复）。
>
> 两种可靠写法：
>
> ```bash
> node scripts/archive.mjs --dry-run        # 直连脚本，最稳
> npm run archive -- -- --dry-run           # 经 npm 时必须多补一个 --
> ```
>
> 同理，别在任何 npm 脚本后面只写一个 `--` 传参。

归档脚本只读本地文件、只移动本地文件，**不发任何网络请求**。目标文件已存在时它会拒绝覆盖并退出码 1
（覆盖归档等于丢数据）。

---

## 测试

```bash
npm test           # 单测 + 构建产物护栏（Vitest）
npx playwright test   # 端到端（Playwright，先构建再 preview）
npm run check      # 类型检查（astro check）
```

- `npm test` 里的**构建产物护栏**读的是 `dist/`，所以改完前台先 `npm run build` 再跑。
- `npx playwright test` 首次需要装浏览器：`npx playwright install chromium`。
  它自己会先 `astro build` 再起 `astro preview`（见 `scripts/e2e-server.mjs`），
  并且**把 GitHub API 全部拦截**——一次真实网络请求都不发，也不会碰到你的真仓库。
- 端到端用的测试口令是 `test-pass-12345`，由 `playwright.config.ts` 在构建时注入，
  不依赖本机 `.env`。

---

## 性能

公开页的约定没变：**零外链 JS、内联脚本 ≤2 段、无字体、无图片、无第三方**。
在此基础上做了四件事，前三件已落地，第四件留了可复现的探针：

| 手段 | 做了什么 | 效果 |
|---|---|---|
| 跨文档视图过渡 | `global.css` 里 `@view-transition { navigation: auto }`，顶栏命名 `topbar` 原地不动 | 整页跳转带 150ms 交叉淡入，**零脚本**；Chrome/Edge 126+、Safari 18.2+，其余浏览器自动退化 |
| 预取相邻日 | `<link rel="prefetch">`，目标由 `lib/day-nav.ts` 与底部翻阅**同一份判定**算出 | 命中时翻页少一次文档往返；不会预取 404（护栏钉着「预取集合 === 翻阅栏链接集合」） |
| CSS 内联 | `build.inlineStylesheets: 'always'` | 4G + 4×CPU 实测：请求 2→1，**LCP 560→404 ms** |
| 剥 HTML 注释 | `scripts/strip-html-comments.mjs`（`npm run build` 第二段），保留 `<!--astro:*-->` 水合标记 | 全站 HTML −8%；admin 岛屿水合由 E2E 守着 |

自己复现数字：

```bash
npm run build
npx astro preview --host 127.0.0.1 --port 4399
node scripts/perf-probe.mjs load   # 首屏：请求数 / 字节 / LCP
node scripts/perf-probe.mjs nav    # 翻页：预取命中 vs 被挡住（需要相邻日有数据）
```

**为什么不引 swup / ClientRouter**：那类 JS 路由器要往公开页塞 15–25 KB 脚本并接管导航，
与「零 JS」的硬护栏正面冲突；而本机能给出的「无刷新感」上限（转场 + 预取）已经拿到了大半，
剩下的收益是毫秒级，代价是整站多一个会坏的地方。

---

## 故障速查

| 现象 | 原因 | 怎么修 |
|---|---|---|
| 后台说「口令永远不对」 | `.env` 里的 `$` 没转义，值塌成了 `pbkdf2` | 重新 `npm run gen-password`，**整行原样**粘贴 |
| 后台说「还没配置管理员口令」 | 没有 `.env`，或变量名写错 | 从 `.env.example` 复制，变量名必须是 `PUBLIC_ADMIN_PASSWORD_KDF` |
| 部署后整站白屏、资源 404 | GitHub Pages 项目站忘了改 `basePath` | 改成 `/<仓库名>`，`site.url` 一起改 |
| 改了数据但线上没变 | 只改了本地文件，没点「保存并发布」 | 后台发布一次，或直接 push |
| 后台连不上仓库 | 令牌权限不足 / 没选中该仓库 / 已过期 | 重新生成 fine-grained PAT，只勾该仓库的 Contents 读写 |
| 发布报 422 | 提交期间分支被别处更新了 | 后台会自动重跑整条链（最多 3 次）；反复失败就刷新重连 |

---

## 目录结构

```
src/
  pages/            六个公开页面 + /admin（唯一的客户端岛屿）
  components/       前台 Astro 组件（印章、刻度、月历、图表……全部构建期渲染）
  admin/            后台 React 岛屿：状态机、视图、GitHub 客户端接线
  lib/              无框架依赖的纯逻辑（日期、数据、统计、校验、GitHub、口令）
  data/             数据文件（唯一真相）
  layouts/          页面外壳（canonical / 明暗 / 导航）
site.config.ts      唯一配置入口：站点地址、basePath、时区、归档月数、后台仓库
scripts/            gen-password / archive / e2e-server
tests/              构建产物护栏（Vitest）与端到端（Playwright）
```

改站点标题、作者、时区、归档月数、目标仓库，都只改 `site.config.ts` 一处。
