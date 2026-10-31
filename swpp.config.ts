import { defineConfig } from 'swpp-backends'

const SITE = 'https://maochenyu-me.github.io/todo/'

/** matchCacheRule：正数 = TTL 缓存（毫秒），负数 = 永久缓存，false = 不缓存 */
function matchCacheRule(url: URL): number | false {
  const path = url.pathname
  // 后台是私人工具，绝不缓存（HTML 与其专属 JS 全部排除）
  if (path.startsWith('/todo/admin')) return false
  if (path.startsWith('/todo/_astro/')) return false
  // SW 与更新清单必须保持最新，交给网络
  if (path === '/todo/sw.js' || path === '/todo/sw-dom.js') return false
  if (path.startsWith('/todo/swpp/')) return false
  // HTML：10 分钟 TTL，发布后最多 10 分钟全量可见
  if (path === '/todo' || path === '/todo/' || path.endsWith('.html')) return 10 * 60 * 1000
  // 其余静态资源（favicon、manifest、图标等）内容不变则永久
  return -1
}

const both = { runOnNode: matchCacheRule, runOnBrowser: matchCacheRule }

defineConfig({
  compilationEnv: {
    /** dist 是子路径 /todo/ 的映射，必须带尾斜杠让相对 basePublic 正确解析 */
    DOMAIN_HOST: new URL(SITE),
  },
  crossEnv: {
    CACHE_NAME: 'todo-paper-cache',
  },
  crossDep: {
    matchCacheRule: both,
  },
})
