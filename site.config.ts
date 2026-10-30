/**
 * 唯一配置入口。
 *
 * 注意：本文件会被前台构建读取，也可能出现在浏览器里，
 * **不得写入任何秘密**（密码派生值放 `.env` 的 `PUBLIC_ADMIN_PASSWORD_KDF`，GitHub token 永不落盘）。
 */
export const siteConfig = {
  site: {
    title: "待办簿",
    tagline: "每天写清楚要做什么，然后一条条划掉。",
    author: "maochenyu",
    /**
     * 站点地址（canonical / sitemap / RSS 的基址）。
     *
     * 部署前改成你的真实地址。带不带尾斜杠都行——读取方一律用 `new URL()` 解析。
     */
    url: "https://maochenyu-me.github.io",
    /**
     * 部署在子路径下时的前缀，**只有这一处需要按平台改**：
     * - GitHub Pages **项目站**（`https://<user>.github.io/<repo>/`）→ `"/<repo>"`
     * - GitHub Pages 用户站、Cloudflare Pages、Vercel、EdgeOne → `"/"`
     *
     * 忘了改是唯一「部署后整站白屏」的坑：HTML 里的 `_astro/*` 与站内链接都会指向
     * 根路径，而资源实际在子路径下。README 的部署段有同一句话的加粗版。
     */
    basePath: "/todo", // GH Pages 项目站：https://maochenyu-me.github.io/todo/
    lang: "zh-CN",
    timeZone: "Asia/Shanghai", // 全站"今天"的唯一依据
  },
  data: {
    activeDir: "src/data/todos",
    archiveDir: "src/data/archive",
    archiveAfterMonths: 6,
  },
  theme: {
    defaultMode: "system", // "light" | "dark" | "system"
    accent: { light: "#BE3A2B", dark: "#E4675A" }, // 注入为 --seal
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
      owner: "maochenyu-me",
      repo: "todo",
      branch: "main",
      dataPathPrefix: "",
      commitMessage: "chore(todo): {date} — {summary}",
      authorName: "todo-admin",
      authorEmail: "todo-admin@users.noreply.github.com",
      apiBase: "https://api.github.com",
    },
  },
  deploy: {
    platform: "auto", // "github-pages" | "cloudflare" | "vercel" | "edgeone" | "auto"
    buildCommand: "npm run build",
    outputDir: "dist",
  },
} as const;

export default siteConfig;

/** 构建时能确定的具体部署平台。 */
export type DeployPlatform = "github-pages" | "cloudflare" | "vercel" | "edgeone";

/** `deploy.platform` 允许的取值：显式平台，或交给构建时推断的 `"auto"`。 */
export type DeployPlatformSetting = DeployPlatform | "auto";

/** 推断平台所依据的构建环境变量（仅这四个）。 */
export interface DeployEnv {
  GITHUB_ACTIONS?: string | undefined;
  CF_PAGES?: string | undefined;
  VERCEL?: string | undefined;
  EDGEONE?: string | undefined;
}

function readDeployEnv(): DeployEnv {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const env = proc?.env ?? {};
  return {
    GITHUB_ACTIONS: env.GITHUB_ACTIONS,
    CF_PAGES: env.CF_PAGES,
    VERCEL: env.VERCEL,
    EDGEONE: env.EDGEONE,
  };
}

/**
 * 按构建环境变量推断部署平台。
 *
 * 优先级：`GITHUB_ACTIONS` → `CF_PAGES` → `VERCEL` → `EDGEONE`；
 * 都没有时回落到 `deploy.platform` 声明值，声明仍是 `"auto"` 则默认 `"github-pages"`。
 *
 * 纯函数（环境变量可注入），便于后续任务与单测使用。
 */
export function resolvePlatform(
  env: DeployEnv = readDeployEnv(),
  declared: DeployPlatformSetting = siteConfig.deploy.platform,
): DeployPlatform {
  if (env.GITHUB_ACTIONS) return "github-pages";
  if (env.CF_PAGES) return "cloudflare";
  if (env.VERCEL) return "vercel";
  if (env.EDGEONE) return "edgeone";
  return declared === "auto" ? "github-pages" : declared;
}
