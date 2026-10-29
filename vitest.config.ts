import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest 不读 Astro 注入的 tsconfig paths，`@/*` 别名要在这里单独给一份。
 *
 * 背景：组件层（shadcn 惯例，`src/admin/components/ui/*`）对 `@/lib/utils`
 * 等**值导入**是刻意的——单测一旦从组件文件引纯函数（如 TaskEditorDialog 的
 * `composeDraft`），整棵 ui 树都会跟着加载，别名必须能解析。
 * 可测的纯逻辑文件（machine / operations / view-state）仍保持相对导入，
 * 对 `@/` 只有会被转译擦除的 `import type`。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
