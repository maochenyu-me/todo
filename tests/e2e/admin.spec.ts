import { expect, test, type Page } from '@playwright/test';

import {
  checkboxOf,
  clickTaskAction,
  connect,
  openAdmin,
  PASSWORD_INPUT,
  TITLE_INPUT,
  TOKEN_INPUT,
  unlock,
  waitForView,
} from './admin-helpers';
import {
  count,
  createFakeRepo,
  entryJson,
  installFakeGitHub,
  sequence,
  type FakeRepo,
} from './github-mock';
import { frozenToday } from './frozen-today.mjs';

/**
 * 后台 `/admin` 的端到端用例：spec §10.3 的九条验收，GitHub API 全部拦截。
 *
 * ## 九条验收 vs 实现实况（三处必须说清楚，都不是"放宽断言"）
 *
 * 1. **改动计数是「天」不是「处」。** spec §10.3-4 写「3 处未保存改动」，而
 *    `machine.ts` 的 `dirty` 是 `Set<date>`（一天一个元素），`StatusBar` 照实显示
 *    「N 天有未保存改动」。所以本用例把三处编辑**落在三个不同的日期**上——这样
 *    断言的依然是「三处编辑都被计数」，只是单位是它真实的单位。同一天里改三处只该
 *    显示「1 天」，那正是「未发布的日期有几个」这个语义。
 * 2. **连接时读的是整个活跃区，不是「只读当天那一个 blob」。** spec §8.4 设想的
 *    「1 次 Tree + 1 次 blob」是按需懒加载模型；Task 14 的裁决改成了连接时批量读
 *    活跃区（`ConnectView` 文件头写了理由：`loadWarnings` 要求「仓库里存在但读不出来
 *    的日期」可见，懒加载就发现不了）。于是第 3 条的请求数 = 活跃区数据文件个数，
 *    第 6 条切换日期**一次请求都不发**（比 spec 要求的「只新增 1 次」更严）。
 * 3. **401 之后按钮不禁用，而是保持可点。** spec §8.3 说「禁用保存按钮」，但同一句
 *    还要求「重输后可原样重试」——按钮禁用着就没法重试了。实现的取舍是：红条报错、
 *    改动原样保留、按钮保持可用。本用例断言的是「报错可见 + 改动不丢 + 可重试」，
 *    这三条才是那句设计的意图。
 *
 * ## 数据从哪来
 *
 * 全部来自 mock（`github-mock.ts`），**一次真实网络请求都不发**。页面本身是
 * `dist/` 的真实产物（由 `scripts/e2e-server.mjs` 先构建再 preview），所以这一组
 * 用例同时验证了「产物里的后台岛屿能跑起来」。
 */

const ACTIVE_DIR = 'src/data/todos';
/** 与构建产物一致的「今天」：种子里最新的日期（`e2e-server` 构建时也冻在它上面）。 */
const TODAY = frozenToday();
const DAY_A = '2026-10-27';
const DAY_B = '2026-10-28';

/** 活跃区三天的假仓库（三天各有两条待办）。 */
function seedFiles(): Map<string, string> {
  return new Map([
    [`${ACTIVE_DIR}/${DAY_A}.json`, entryJson(DAY_A, ['整理十月账单', '预约体检'])],
    [`${ACTIVE_DIR}/${DAY_B}.json`, entryJson(DAY_B, ['把归档脚本写出来', '买齐下周的早餐食材'])],
    [`${ACTIVE_DIR}/${TODAY}.json`, entryJson(TODAY, ['回掉积压的三封邮件', '晚饭后跑五公里'])],
  ]);
}

/** 装好 mock 并打开后台。返回可变的假仓库状态（用来改状态码、读调用记录）。 */
async function setupAdmin(page: Page): Promise<FakeRepo> {
  const repo = createFakeRepo({
    owner: 'maochenyu-me',
    repo: 'todo',
    branch: 'main',
    files: seedFiles(),
  });
  await installFakeGitHub(page, repo);
  await openAdmin(page);
  return repo;
}

/** 解锁 + 连接，停在 `ready`（或 `dirty`）。 */
async function readyAdmin(page: Page): Promise<FakeRepo> {
  const repo = await setupAdmin(page);
  await unlock(page);
  await waitForView(page, 'disconnected');
  await connect(page);
  await waitForView(page, 'ready');
  return repo;
}

/** 选中某一天（左栏按钮的文字是「10月28日 周三」这种)。 */
async function selectDay(page: Page, monthDay: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(monthDay) }).click();
}

/** 在当天新增一条待办。 */
async function addTask(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: '新增待办' }).click();
  await page.locator(TITLE_INPUT).fill(title);
  await page.getByRole('button', { name: '添加' }).click();
  // 对话框关闭 + 列表里出现新标题，才算这次编辑真的落进 reducer。
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible();
}

test.describe('① 口令门', () => {
  test('错口令停在 locked 并给出提示', async ({ page }) => {
    await setupAdmin(page);
    await waitForView(page, 'locked');

    await unlock(page, 'definitely-not-the-password');

    // 校验失败只该多一条错误，视图仍是 locked。
    await expect(page.getByRole('alert')).toContainText('口令不正确');
    await expect(page.getByTestId('admin-view')).toHaveAttribute('data-view', 'locked');
    // 输入框被清空（让人从头敲，而不是在错的口令上改）。
    await expect(page.locator(PASSWORD_INPUT)).toHaveValue('');
  });
});

test.describe('② 对口令 → disconnected，且此刻页面上没有任何待办数据', () => {
  test('解锁后看不到数据，只有一个「连接 GitHub」入口', async ({ page }) => {
    await setupAdmin(page);
    await unlock(page);
    await waitForView(page, 'disconnected');

    // 口令门只遮挡界面；数据只能来自仓库，所以此刻一条待办都不该出现。
    // 这四条标题都只存在于 mock 仓库里，页面上出现任何一个都是"数据从构建产物漏出来"。
    const body = page.locator('body');
    for (const title of [
      '整理十月账单',
      '把归档脚本写出来',
      '回掉积压的三封邮件',
      '晚饭后跑五公里',
    ]) {
      await expect(body).not.toContainText(title);
    }
    // 也确实没有任何请求发出过（解锁是纯本地计算）。
    await expect(page.locator(TOKEN_INPUT)).toBeVisible();
  });
});

test.describe('③ 假 token → ready（Tree + 活跃区文件 + 分支名）', () => {
  test('连接后进入 ready，顶部条显示 owner/repo@branch', async ({ page }) => {
    const repo = await setupAdmin(page);
    await unlock(page);
    await waitForView(page, 'disconnected');

    repo.calls.length = 0; // 只统计"连接"这一段
    await connect(page);
    await waitForView(page, 'ready');

    // 目标仓库与分支是连接的第一证据。
    await expect(page.getByLabel('发布状态')).toContainText('maochenyu-me/todo@main');
    // 令牌过期日来自响应头 `github-authentication-token-expiration`——这一条同时
    // 证明 CORS 的 `expose-headers` 与 `verify()` 的读头逻辑都通了。
    await expect(page.getByLabel('发布状态')).toContainText('令牌有效期至 2027-01-01');

    const kinds = sequence(repo.calls);
    // 先验证令牌，再列目录，最后逐个读文件——顺序是硬的（读目录失败就没法读文件）。
    expect(kinds[0]).toBe('verify');
    expect(kinds[1]).toBe('list');
    expect(kinds.filter((kind) => kind === 'list')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'verify')).toHaveLength(1);
    // 活跃区有 3 天数据（含今天）→ 3 次 contents 读取，全都发生在 list 之后。
    expect(kinds.filter((kind) => kind === 'contents')).toHaveLength(3);
    const firstContents = kinds.indexOf('contents');
    expect(firstContents).toBeGreaterThan(kinds.indexOf('list'));

    // 今天那天的条目真的渲染进了编辑器。
    await expect(page.locator('body')).toContainText('回掉积压的三封邮件');
  });
});

test.describe('④ 三处编辑 → 计数反映三处改动', () => {
  test('新增、勾掉、删除各落在一天 → 3 天有未保存改动', async ({ page }) => {
    await readyAdmin(page);

    // 三处编辑刻意落在三个**不同日期**上：`dirty` 的单位是日期（见文件头第 1 条）。
    // 今天：新增一条
    await addTask(page, '把发布流程再走一遍');

    // 昨天：勾掉一条（原来是未完成）
    await selectDay(page, '10月28日');
    await checkboxOf(page, '买齐下周的早餐食材').click();

    // 前天：删掉一条（删除要过 window.confirm）
    await selectDay(page, '10月27日');
    page.once('dialog', (dialog) => void dialog.accept());
    await clickTaskAction(page, '预约体检', '删除');

    // 计数必须真的到 3，而且视图进 dirty。
    await expect(page.getByTestId('unsaved-changes')).toContainText('3 天有未保存改动');
    await waitForView(page, 'dirty');

    // 三处改动都还在（不是只记住了"有改动"这件事）。
    // 逐天回查：编辑器只渲染当前选中的那一天，所以必须切回去看。
    // 今天那天的按钮文字从 TODAY 动态拼（TODAY 随真实时钟走，别写死）。
    const todayLabel = `${Number(TODAY.slice(5, 7))}月${Number(TODAY.slice(8, 10))}日`;
    await selectDay(page, todayLabel);
    await expect(page.getByRole('listitem').filter({ hasText: '把发布流程再走一遍' })).toBeVisible();
    await selectDay(page, '10月28日');
    await expect(checkboxOf(page, '买齐下周的早餐食材')).toBeChecked();
    await selectDay(page, '10月27日');
    await expect(page.getByRole('listitem').filter({ hasText: '预约体检' })).toHaveCount(0);
    await expect(page.getByRole('listitem').filter({ hasText: '整理十月账单' })).toBeVisible();
  });
});

test.describe('⑤ 发布：一次 commit，只 PATCH 一次 ref', () => {
  test('调用序列符合原子提交链，且 PATCH /git/refs 只出现一次', async ({ page }) => {
    const repo = await readyAdmin(page);

    // 造两处改动（两天），让 blob 数可预期。
    await addTask(page, '核对一下发布载荷');
    await selectDay(page, '10月28日');
    await checkboxOf(page, '把归档脚本写出来').click();

    await expect(page.getByTestId('unsaved-changes')).toContainText('2 天有未保存改动');

    repo.calls.length = 0; // 只统计发布这一段
    await page.getByRole('button', { name: '保存并发布' }).click();

    // 成功后有 commit 链接（sha 前 7 位）。
    await expect(page.getByTestId('last-commit')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('last-commit')).toContainText('已发布');

    const kinds = sequence(repo.calls);
    // 权威顺序来自 `github.ts` 的 `commitChanges`：读 head → 读 base tree →
    // 上传 N 个 blob → 建 tree → 建 commit → **一次** PATCH 移动分支。
    // （spec §8.5 里那串箭头是示意，以代码为准。）
    expect(kinds).toEqual([
      'refRead',
      'commitRead',
      'blob',
      'blob',
      'treeCreate',
      'commitCreate',
      'refPatch',
    ]);

    // 核心断言：整次发布只推了一次分支指针（= 只有一个 commit 落地）。
    expect(count(repo.calls, 'refPatch')).toBe(1);
    expect(count(repo.calls, 'commitCreate')).toBe(1);
    expect(count(repo.calls, 'treeCreate')).toBe(1);
    // 两天改动 = 两个 blob，一天不多一天不少。
    expect(count(repo.calls, 'blob')).toBe(2);

    // PATCH 的请求体里**没有 force**：绝不硬推覆盖别人的提交。
    const patch = repo.calls.find((call) => call.kind === 'refPatch');
    expect(patch?.method).toBe('PATCH');
    expect(JSON.stringify(patch?.body)).not.toContain('force');

    // 发布成功后 dirty 清空，按钮回到"没有未保存的改动"。
    await waitForView(page, 'ready');
    await expect(page.getByTestId('unsaved-changes')).toContainText('没有未保存的改动');
  });
});

test.describe('⑥ 切换日期不再发请求（缓存生效）', () => {
  test('来回切换与重复点同一天都不新增任何 contents 请求', async ({ page }) => {
    const repo = await readyAdmin(page);

    const contentsBefore = count(repo.calls, 'contents');
    // 连接时已把活跃区全读进来，所以这里的基线就该是 3。
    expect(contentsBefore).toBe(3);

    await selectDay(page, '10月28日');
    await expect(page.locator('body')).toContainText('把归档脚本写出来');
    await selectDay(page, '10月27日');
    await expect(page.locator('body')).toContainText('整理十月账单');
    // 重复点同一日期（本来选中 10-27，再点一次）
    await selectDay(page, '10月27日');

    // 一次都没有新增：编辑器的数据全部来自连接时那一份，切换只是换 selected。
    expect(count(repo.calls, 'contents')).toBe(contentsBefore);
    expect(count(repo.calls, 'list')).toBe(1);
  });
});

test.describe('⑦ 422 非快进 → 自动重试、第二次成功、改动不丢', () => {
  test('第一次 PATCH 被 422 拒绝后整条链重跑并成功', async ({ page }) => {
    const repo = await readyAdmin(page);
    await addTask(page, '这条改动必须活过重试');

    repo.calls.length = 0;
    repo.nextPatchStatus = 422; // 只让**第一次** PATCH 失败

    await page.getByRole('button', { name: '保存并发布' }).click();

    await expect(page.getByTestId('last-commit')).toBeVisible({ timeout: 20_000 });

    const kinds = sequence(repo.calls);
    // 422 → 重跑整条链（不是加 force 硬推）：两次 refRead、两次 commitCreate、
    // 两次 refPatch——第一次被拒、第二次成功。仓库只在最后一次 PATCH 时改变。
    expect(count(repo.calls, 'refPatch')).toBe(2);
    expect(count(repo.calls, 'commitCreate')).toBe(2);
    expect(count(repo.calls, 'refRead')).toBe(2);
    // 每次尝试都重新上传 blob（新 base 之后旧 tree 不能复用）。
    expect(count(repo.calls, 'blob')).toBe(2);
    // 第二次仍是 refPatch 收尾。
    expect(kinds[kinds.length - 1]).toBe('refPatch');

    // 改动没丢：发布成功后 dirty 才清空，且仓库里确实有那条新待办。
    await waitForView(page, 'ready');
    const committed = [...repo.files.values()].join('\n');
    expect(committed).toContain('这条改动必须活过重试');
  });
});

test.describe('⑧ 401 → 报错可见、改动保留、可重试', () => {
  test('发布途中令牌失效：红条报错且改动一条不丢', async ({ page }) => {
    const repo = await readyAdmin(page);
    await addTask(page, '令牌挂了也不许丢掉这条');

    // 让所有写请求都 401（最贴近"令牌在发布途中被撤销"）。
    repo.writeStatus = 401;

    await page.getByRole('button', { name: '保存并发布' }).click();

    // 报错必须是可读的中文 + 状态码，而不是一句 Failed to fetch。
    const alert = page.getByRole('alert').filter({ hasText: '401' });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText('令牌');
    // 顶部条不该显示"已发布"。
    await expect(page.getByTestId('last-commit')).toHaveCount(0);

    // 改动原样保留：计数还在，编辑器里那条也还在。
    await expect(page.getByTestId('unsaved-changes')).toContainText('1 天有未保存改动');
    await expect(page.locator('body')).toContainText('令牌挂了也不许丢掉这条');

    // 而且能重试：错误清掉令牌后，「保存并发布」仍然可点。
    repo.writeStatus = null;
    await expect(page.getByRole('button', { name: '保存并发布' })).toBeEnabled();
    await page.getByRole('button', { name: '保存并发布' }).click();
    await expect(page.getByTestId('last-commit')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('⑨ 刷新免密，但仍需令牌才有数据', () => {
  test('解锁后刷新：不再要口令，停在未连接', async ({ page }) => {
    await setupAdmin(page);
    await unlock(page);
    await waitForView(page, 'disconnected');

    // 没输过令牌，所以本机没有 token：刷新后应当免密进入 disconnected。
    await page.reload();
    await waitForView(page, 'disconnected');

    // 关键点：口令输入框不该回来（会话仍在有效期内）。
    await expect(page.locator(PASSWORD_INPUT)).toHaveCount(0);
    // 而且仍然没有数据——数据只能来自仓库。
    await expect(page.locator('body')).not.toContainText('回掉积压的三封邮件');
    await expect(page.locator(TOKEN_INPUT)).toBeVisible();
  });

  test('连过之后刷新：免密免重输令牌，直接回到可编辑状态', async ({ page }) => {
    await readyAdmin(page);

    await page.reload();
    // 解锁会话在 sessionStorage、令牌在 localStorage，两者都还在 → 自动连上。
    await waitForView(page, 'ready');
    await expect(page.locator(PASSWORD_INPUT)).toHaveCount(0);
    await expect(page.locator('body')).toContainText('回掉积压的三封邮件');
  });
});

test.describe('编辑层校验：坏数据进不了 reducer', () => {
  test('把标题清空时表单当面拦下，既不入库也不弄脏这一天', async ({ page }) => {
    await readyAdmin(page);

    // 「保存并发布」的前提是 dirty 非空；先确认现在是干净的。
    await expect(page.getByTestId('unsaved-changes')).toContainText('没有未保存的改动');

    await clickTaskAction(page, '晚饭后跑五公里', '编辑');
    await page.locator(TITLE_INPUT).fill('');
    await page.getByRole('button', { name: '保存' }).click();
    // 空标题在 `composeDraft` 那一层就被 `validateTask` 拒了：对话框不关、错误贴在字段下方。
    // 这是**有意的前置闸**——坏数据压根不进 reducer，所以顶部条不会出现「未通过校验」
    // 那种发布期才发现的状态（`validateDay` 那道闸是给外部输入的兜底，不是常规路径）。
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('标题');

    // 取消掉，确认这一天仍然是干净的：一次被拒的编辑不该留下改动痕迹。
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('unsaved-changes')).toContainText('没有未保存的改动');
    await expect(page.getByRole('button', { name: '保存并发布' })).toBeDisabled();
  });
});
