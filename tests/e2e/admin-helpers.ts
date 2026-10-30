/**
 * E2E 用例的小工具：解锁、连接、等后台进入某个视图。
 *
 * ## 为什么所有等待都是"轮询状态"而不是 sleep
 *
 * 解锁要跑 600000 轮 PBKDF2（快机器几百毫秒，慢机器数秒），连接要读一整个活跃区的
 * 数据文件（并发 6）。任何固定 sleep 都只是在赌机器速度：短了随机红，长了拖慢全量。
 * 这里一律用 Playwright 的自动重试断言去等 `data-view` 这个**状态标记**——它是
 * `AdminApp` 专门给自动化读当前状态用的（`data-testid="admin-view"`），不参与样式。
 *
 * ## 为什么输入框用 `#id` 而不是 `getByLabel`
 *
 * `getByLabel('口令')` 在 `/admin` 上会命中**两个**元素：`<label for="admin-password">口令</label>`
 * 与「输入管理员口令」标题里的同一串字（accessible name 的模糊匹配）。同理「访问令牌」
 * 会命中标签与说明文字。用 id 定位是这里唯一稳定的选择——这些 id 是控件的公开契约
 * （`LockedView`/`ConnectView` 里给 `htmlFor` 用的就是它们）。
 */

import { expect, type Page } from '@playwright/test';

/** 后台当前的派生视图（`locked` / `disconnected` / `ready` / `dirty` / `publishing`）。 */
export type AdminView = 'locked' | 'disconnected' | 'ready' | 'dirty' | 'publishing';

/** E2E 用的测试口令，对应 `playwright.config.ts` 里注入的 KDF。 */
export const TEST_PASSWORD = 'test-pass-12345';

/** 口令输入框（`LockedView`）。 */
export const PASSWORD_INPUT = '#admin-password';
/** 令牌输入框（`ConnectView`）。 */
export const TOKEN_INPUT = '#admin-github-token';
/** 编辑对话框里的标题字段（`TaskEditorDialog`）。 */
export const TITLE_INPUT = '#task-title';

/** 等后台进入指定视图。**这是全文件唯一的"等状态"原语**，其它等待都由它派生。 */
export async function waitForView(page: Page, view: AdminView): Promise<void> {
  await expect(page.getByTestId('admin-view')).toHaveAttribute('data-view', view, {
    // 解锁要跑 600000 轮 PBKDF2；慢机器上给足余量。
    timeout: 20_000,
  });
}

/**
 * 打开 `/admin`。
 *
 * 不做任何 storage 清理——Playwright 为每个用例新建 browser context，storage 本来就是空的。
 * （早先在这里用 `addInitScript` 清 storage，结果它**每次导航**都执行，刷新用例里
 * 刚写进 sessionStorage 的解锁会话立刻被抹掉，于是刷新后回到了 locked。要清理只能在
 * 首次导航之后用 `page.evaluate`，而这里根本不需要清。）
 */
export async function openAdmin(page: Page): Promise<void> {
  await page.goto('/todo/admin/');
}

/** 输口令并解锁，等到 `disconnected`。 */
export async function unlock(page: Page, password = TEST_PASSWORD): Promise<void> {
  await page.locator(PASSWORD_INPUT).fill(password);
  await page.getByRole('button', { name: '解锁' }).click();
}

/** 输令牌并连接。 */
export async function connect(page: Page, token = 'github_pat_E2E_FAKE_TOKEN'): Promise<void> {
  await page.locator(TOKEN_INPUT).fill(token);
  await page.getByRole('button', { name: '验证并连接' }).click();
}

/** 一条任务的复选框（按标题找）。`aria-label` 形如「完成「标题」」。 */
export function checkboxOf(page: Page, title: string) {
  return page.getByRole('checkbox', { name: new RegExp(`^(完成|标记)「${title}」`) });
}

/** 任务的四个操作（`EditorView` 的文案）。 */
export type TaskAction = '上移' | '下移' | '编辑' | '删除';

/**
 * 点一条任务上的某个操作——**桌面与窄屏两套入口都要能点到**。
 *
 * `EditorView` 对同一操作渲染了两个入口：桌面是行内图标按钮（`hidden sm:flex`），
 * 窄屏是 `⋯` 菜单里的文字按钮。两者的 `aria-label` 完全一样，所以窄屏下直接用
 * `getByRole('button', { name: '删除「X」' })` 会命中那个 `display:none` 的图标按钮，
 * 点击就一直等它可见直到超时。
 *
 * 这里先看桌面入口可不可见，不可见就展开该行的 `⋯`（同一时刻只展开一行），
 * 再用 `filter({ visible: true })` 点到真正露出来的那一个。
 */
export async function clickTaskAction(
  page: Page,
  title: string,
  action: TaskAction,
): Promise<void> {
  const named = page.getByRole('button', { name: new RegExp(`^${action}「${title}」$`) });
  const desktop = named.filter({ visible: true });
  if ((await desktop.count()) === 0) {
    await page.getByRole('button', { name: `${title} 的更多操作` }).click();
  }
  await named.filter({ visible: true }).first().click();
}
