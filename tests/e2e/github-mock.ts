/**
 * E2E 的 GitHub API 假实现（`page.route` 拦截，**一次真实网络请求都不发**）。
 *
 * ## 为什么假 API 要"有状态"
 *
 * 断言里有一半是关于**调用序列**的：只发一次 `PATCH /git/refs`、`SELECT_DAY` 只多一次
 * blob、422 后重跑整条链。半静态的 mock（每次返回固定 JSON）测不出这些东西——它连
 * "第二次请求发生了"都看不见。所以这里维护一份最小可用的 git 状态（head commit、
 * 文件内容），按真实客户端的请求序列推进，把每次请求按序记进 `calls` 供断言。
 *
 * 状态机刻意只模拟到 `github.ts` 真正依赖的那几步：`GET /git/ref/heads/<branch>` →
 * `GET /git/commits/<sha>` → `POST /git/blobs` → `POST /git/trees` →
 * `POST /git/commits` → `PATCH /git/refs/heads/<branch>`。
 *
 * ## URL 与状态码全部对齐 `src/lib/github.ts`
 *
 * 路径、方法、请求体字段名都不是按 GitHub 文档猜的，是照着 `github.ts` 的 `send()`
 * 调用点抄的。改了 `github.ts` 的端点，这些 mock 必须跟着改——它们之间没有编译期约束，
 * 唯一的保护是"mock 对不上时用例会红"。
 */

import type { Page, Route } from '@playwright/test';

/** 一次被拦截的请求。`kind` 已归一成断言里好写的短名。 */
export type CallRecord = {
  /**
   * 归一后的端点。读写分开是必要的：`github.ts` 的发布链里 `GET /git/commits/<sha>`
   * （读 base tree）与 `POST /git/commits`（建 commit）是同一个路径前缀，
   * 合并成一个 kind 的话「一次发布只有一个 commit」这类断言就失去意义了。
   */
  kind:
    | 'verify' // GET  /repos/{owner}/{repo}
    | 'list' // GET  /git/trees/{branch}?recursive=1
    | 'contents' // GET  /contents/{path}
    | 'refRead' // GET  /git/ref/heads/{branch}
    | 'commitRead' // GET  /git/commits/{sha}
    | 'blob' // POST /git/blobs
    | 'treeCreate' // POST /git/trees
    | 'commitCreate' // POST /git/commits
    | 'refPatch' // PATCH /git/refs/heads/{branch}
    | 'unknown'; // 不认识的端点（mock 缺陷，会让用例明确失败）
  method: string;
  /** 归一化后的路径（去掉 `/repos/<owner>/<repo>` 前缀）。 */
  path: string;
  /** 请求体（只有写请求有）。 */
  body: unknown;
};

/** 假仓库的状态。 */
export type FakeRepo = {
  owner: string;
  repo: string;
  branch: string;
  headSha: string;
  /** 仓库相对路径 → 文件文本内容。 */
  files: Map<string, string>;
  /** 按发生顺序记录的请求。 */
  calls: CallRecord[];
  /** 下一次 `PATCH /git/refs` 的强制状态码（用一次就清空）。 */
  nextPatchStatus: number | null;
  /** 之后每一次 `PATCH /git/refs` 都返回这个状态码（`null` = 正常）。 */
  patchStatus: number | null;
  /** 之后每一次 `PUT/POST` 都返回这个状态码（模拟令牌失效等）。 */
  writeStatus: number | null;
  /** 令牌验证（`GET /repos/{owner}/{repo}`）的状态码。 */
  verifyStatus: number;
  /** 响应头里的令牌过期时间。 */
  tokenExpiration: string | null;
  /** 已上传的 blob：sha → 文本内容。`PATCH` 成功时用它落地成新文件。 */
  blobs: Map<string, string>;
  /** 最近一次 `POST /git/trees` 的条目；`PATCH` 成功时按它更新 `files`。 */
  pendingTree: { path: string; sha: string | null }[] | null;
};

/** 只数某类请求。 */
export function count(calls: readonly CallRecord[], kind: CallRecord['kind']): number {
  return calls.filter((call) => call.kind === kind).length;
}

/** 请求序列（只保留 kind），用于断言 `tree → blob → ref → …` 的次序。 */
export function sequence(calls: readonly CallRecord[]): string[] {
  return calls.map((call) => call.kind);
}

/** UTF-8 → base64（浏览器侧与产物里的编码都是 UTF-8）。 */
function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/** base64 → UTF-8。 */
function fromBase64(text: string): string {
  return Buffer.from(text, 'base64').toString('utf8');
}

/** 一条合法的数据文件内容（字段齐备，能过 `parseEntry`）。 */
export function entryJson(dateKey: string, titles: string[]): string {
  const tasks = titles.map((title, index) => ({
    id: `e2e${String(index).padStart(3, '0')}`,
    title,
    done: false,
    completedAt: null,
    order: index,
    priority: 1,
    tags: ['端到端'],
    note: '',
    timeBlock: null,
    createdAt: `${dateKey}T08:00:00+08:00`,
    updatedAt: `${dateKey}T08:00:00+08:00`,
  }));
  return `${JSON.stringify({ date: dateKey, tasks }, null, 2)}\n`;
}

/** 新建一份假仓库状态。 */
export function createFakeRepo(options: {
  owner: string;
  repo: string;
  branch: string;
  files: Map<string, string>;
}): FakeRepo {
  return {
    owner: options.owner,
    repo: options.repo,
    branch: options.branch,
    headSha: 'head0000000000000000000000000000000000000',
    files: options.files,
    calls: [],
    nextPatchStatus: null,
    patchStatus: null,
    writeStatus: null,
    verifyStatus: 200,
    tokenExpiration: '2027-01-01T00:00:00Z',
    blobs: new Map(),
    pendingTree: null,
  };
}

/** 把请求路径归一成短名。`repoPrefix` 形如 `/repos/owner/repo`。 */
function classify(fullPath: string, repoPrefix: string): CallRecord['kind'] {
  const rest = fullPath.startsWith(repoPrefix) ? fullPath.slice(repoPrefix.length) : fullPath;
  if (rest === '' || rest === '/') return 'verify';
  // 注意顺序：`/git/trees/{branch}`（GET 列目录）排在 `/git/trees`（POST 建树）之前判断，
  // 但两者路径前缀相同，只能靠方法区分。
  if (rest.startsWith('/git/trees/')) return 'list';
  if (rest === '/git/trees') return 'treeCreate';
  if (rest === '/git/blobs') return 'blob';
  if (rest === '/git/commits') return 'commitCreate';
  if (rest.startsWith('/git/commits/')) return 'commitRead';
  if (rest.startsWith('/git/ref/heads/')) return 'refRead';
  if (rest.startsWith('/git/refs/heads/')) return 'refPatch';
  if (rest.startsWith('/contents/')) return 'contents';
  // 兜底：不认识就明确标成 unknown，用例会以 500 失败——绝不悄悄归到某个已实现的分支，
  // 否则"多打了一个请求"会被伪装成正常调用。
  return 'unknown';
}

/**
 * 装上拦截器。
 *
 * 用 `**\/api.github.com/**` 兜住一切 GitHub 请求：**任何没被这里处理的 GitHub 请求
 * 都会以 500 + 明确消息失败**，而不是漏到真实网络。宁可红得刺眼，也不能让测试
 * 悄悄对着真仓库发请求。
 */
export async function installFakeGitHub(page: Page, repo: FakeRepo): Promise<FakeRepo> {
  const repoPrefix = `/repos/${repo.owner}/${repo.repo}`;

  await page.route('**/api.github.com/**', async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const fullPath = url.pathname;
    const kind = classify(fullPath, repoPrefix);

    let body: unknown = null;
    const raw = request.postData();
    if (raw !== null && raw !== '') {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = raw;
      }
    }
    repo.calls.push({ kind, method, path: fullPath.slice(repoPrefix.length) || '/', body });

    const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers,
        body: JSON.stringify(data),
      });

    // 「写操作全挂」开关：模拟令牌在发布途中失效。
    if (repo.writeStatus !== null && method !== 'GET') {
      return json({ message: 'Bad credentials' }, repo.writeStatus);
    }

    try {
      // ① 令牌验证：GET /repos/{owner}/{repo}
      if (kind === 'verify') {
        if (repo.verifyStatus !== 200) return json({ message: 'Bad credentials' }, repo.verifyStatus);
        return json(
          { full_name: `${repo.owner}/${repo.repo}`, private: false },
          200,
          repo.tokenExpiration === null
            ? {}
            : { 'github-authentication-token-expiration': repo.tokenExpiration },
        );
      }

      // ② 列数据文件：GET /git/trees/<branch>?recursive=1
      if (kind === 'list') {
        const tree = [...repo.files.keys()].map((path) => ({
          path,
          mode: '100644',
          type: 'blob',
          sha: `blob${path.length.toString(16).padStart(4, '0')}`,
        }));
        return json({ sha: `tree-of-${repo.branch}`, tree, truncated: false });
      }

      // ③ 读单个文件：GET /contents/<path>?ref=<branch>
      if (kind === 'contents') {
        const path = decodeURIComponent(fullPath.slice(`${repoPrefix}/contents/`.length));
        const content = repo.files.get(path);
        if (content === undefined) return json({ message: 'Not Found' }, 404);
        return json({ encoding: 'base64', content: toBase64(content), sha: `sha-${path.length}` });
      }

      // ④ 读分支 head：GET /git/ref/heads/<branch>
      if (kind === 'refRead') {
        return json({ ref: `refs/heads/${repo.branch}`, object: { sha: repo.headSha } });
      }

      // ⑤ 读 commit 的 tree：GET /git/commits/<sha>
      if (kind === 'commitRead') {
        return json({ sha: repo.headSha, tree: { sha: `tree-of-${repo.headSha}` } });
      }

      // ⑥ 上传 blob：POST /git/blobs
      if (kind === 'blob') {
        const payload = body as { content?: string; encoding?: string };
        if (payload?.encoding !== 'base64' || typeof payload.content !== 'string') {
          return json({ message: '需要 base64 编码的 content' }, 422);
        }
        const text = fromBase64(payload.content);
        // 用序号做 sha：内容一样的两次上传在这里是不同 sha，更贴近"每次都新建对象"
        // （真实 GitHub 会去重，但我们不依赖去重语义）。
        const sha = `blob-${repo.blobs.size + 1}`;
        repo.blobs.set(sha, text);
        return json({ sha }, 201);
      }

      // ⑦ 建树：POST /git/trees（记下条目，`PATCH` 成功时才真正落到 `files`）
      if (kind === 'treeCreate') {
        const payload = body as { base_tree?: string; tree?: { path: string; sha: string | null }[] };
        repo.pendingTree = payload?.tree ?? [];
        return json({ sha: `tree-${repo.calls.length}` }, 201);
      }

      // ⑧ 建 commit：POST /git/commits
      if (kind === 'commitCreate') {
        const sha = `commit${repo.calls.length.toString().padStart(4, '0')}`;
        return json(
          {
            sha,
            html_url: `https://github.com/${repo.owner}/${repo.repo}/commit/${sha}`,
          },
          201,
        );
      }

      // ⑨ 移动分支：PATCH /git/refs/heads/<branch>
      // 这是**唯一**真正改动仓库的一步——只有它成功，tree 条目才落到 files 上。
      // 与 `github.ts` 的语义一致：422 时仓库一个字都没变。
      if (kind === 'refPatch') {
        const forced = repo.nextPatchStatus;
        if (forced !== null) {
          repo.nextPatchStatus = null;
          return json({ message: 'Update is not a fast forward' }, forced);
        }
        if (repo.patchStatus !== null) {
          return json({ message: 'Update is not a fast forward' }, repo.patchStatus);
        }
        const sha = (body as { sha?: string })?.sha ?? repo.headSha;
        repo.headSha = sha;
        for (const entry of repo.pendingTree ?? []) {
          if (entry.sha === null) repo.files.delete(entry.path);
          else {
            const content = repo.blobs.get(entry.sha);
            if (content !== undefined) repo.files.set(entry.path, content);
          }
        }
        repo.pendingTree = null;
        return json({ ref: `refs/heads/${repo.branch}`, object: { sha } });
      }

      // 任何没覆盖到的 GitHub 请求：明确失败，绝不漏到真实网络。
      return json({ message: `E2E mock 未实现：${method} ${fullPath}` }, 500);
    } catch (error) {
      return json({ message: `E2E mock 内部错误：${String(error)}` }, 500);
    }
  });

  return repo;
}
