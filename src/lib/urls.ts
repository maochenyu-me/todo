/**
 * 站内链接拼装。
 *
 * GitHub Pages 项目站部署在子路径（`/<repo>`）下，所有站内链接都必须带上
 * Astro 构建时注入的 `import.meta.env.BASE_URL`，**不得在组件里硬编码 `href="/archive"`**。
 * 本文件无框架依赖，纯函数可单测。
 */

/** Astro 的 base：`"/"`（根）或 `"/repo/"`（带首尾斜杠）。 */
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
