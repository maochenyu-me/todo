import { fileURLToPath } from 'node:url';

import { defaultExclude, defineConfig } from 'vitest/config';

/**
 * Vitest 不读 Astro 注入的 tsconfig paths，`@/*` 别名要在这里单独给一份。
 *
 * 背景：组件层（shadcn 惯例，`src/admin/components/ui/*`）对 `@/lib/utils`
 * 等**值导入**是刻意的——单测一旦从组件文件引纯函数（如 TaskEditorDialog 的
 * `composeDraft`），整棵 ui 树都会跟着加载，别名必须能解析。
 * 可测的纯逻辑文件（machine / operations / view-state）仍保持相对导入，
 * 对 `@/` 只有会被转译擦除的 `import type`。
 *
 * `tests/e2e/**` 是 Playwright 的领地（要起 preview 服务、要 dist 产物），
 * 单测跑它们只会白炸，所以显式排除。
 */
export default defineConfig({
  test: {
    // Vitest 5 的 `exclude` 在 `test` 下；给了它就**整体替换**默认排除表
    // （node_modules、dist 都在里头），所以必须先把 `defaultExclude` 展开进来。
    exclude: [...defaultExclude, 'tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
