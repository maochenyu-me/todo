/**
 * 站内链接拼装。
 *
 * GitHub Pages 项目站部署在子路径（`/<repo>`）下，所有站内链接都必须带上
 * Astro 构建时注入的 `import.meta.env.BASE_URL`，**不得在组件里硬编码 `href="/archive"`**。
 * 本文件无框架依赖，纯函数可单测。
 *
 * 注意 `BASE_URL` 的形态**不可依赖**：Astro 7 实测给的是不带尾斜杠的 `/repo`
 * （旧版本给 `/repo/`）。所以任何"直接拼接"的写法（`${BASE_URL}favicon.svg`）都会
 * 在子路径部署下拼出 `/repofavicon.svg` —— 一个只有 DevTools 才看得见的 404。
 * 拼站内路径一律走 `withBase()`，它两头都处理。
 */

/** Astro 的 base：`"/"`（根）或 `"/repo"` / `"/repo/"`（两种形态都见过）。 */
function currentBase(): string {
  const env = import.meta.env as { BASE_URL?: string } | undefined;
  return env?.BASE_URL ?? '/';
}

/**
 * 给站内路径加上 base 前缀。
 *
 * `withBase('/archive')`：base 为 `/` 时得 `/archive`，为 `/repo/` 时得 `/repo/archive`；
 * `withBase('/')` 会保留结尾斜杠（`/` 或 `/repo/`）。
 */
export function withBase(path: string, base: string = currentBase()): string {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (suffix === '/') return `${prefix}/`;
  return `${prefix}${suffix}`;
}
