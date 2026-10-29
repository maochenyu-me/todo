/**
 * 已连接的 GitHub 客户端放在哪里。
 *
 * reducer 是**纯函数**（不碰网络），所以 client 不能进 `AdminState`；而它又必须
 * 被两个互不相识的组件共享：`ConnectView` 验证令牌后创建它，`AdminApp` 的
 * 「保存并发布」要用它提交。这里用一个模块级单例当**会话内的交接点**：
 *
 * - 只存引用，不存令牌本体——令牌已在 client 内部，且只进 localStorage；
 * - `ConnectView` 在验证通过后 `setActiveClient(client)`，与自动重连
 *   （`requirePasswordOnRefresh: false` 时读 localStorage 的同一条路径）是
 *   **同一个来源**，刷新后发布用的 client 就是重连用的那个；
 * - 「清除令牌 / 断开连接」必须一并 `setActiveClient(null)`，否则残留的 client
 *   还带着旧令牌可发请求；
 * - `activeClient()` 在未连接时抛错而不是返回 null：发布按钮只在 `ready` 之后
 *   可达，走到那里还拿不到 client 本身就是接线 bug，宁可炸给开发者看。
 */

import type { GitHubClient } from '@/lib/github';

let current: GitHubClient | null = null;

/** 记下（或清掉）本次连接的客户端。`null` 表示断开。 */
export function setActiveClient(client: GitHubClient | null): void {
  current = client;
}

/** 取当前连接的客户端；未连接时抛错（发布按钮在未连接状态不可达）。 */
export function activeClient(): GitHubClient {
  if (current === null) {
    throw new Error('尚未连接 GitHub 仓库，无法发布；请先在连接页完成连接');
  }
  return current;
}
