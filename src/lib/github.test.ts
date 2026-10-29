import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { createGitHubClient, GitHubError } from './github';

/**
 * 本文件**绝不触碰真实网络**：所有请求都落到下面的假 `fetch` 上，
 * 它同时记录每一次调用（方法 + 路径 + body），让"提交序列"与"原子性"可断言。
 *
 * 命名口径与 GitHub REST 文档一致：路径记录为去掉 `/repos/{owner}/{repo}` 前缀后的尾巴，
 * 例如 `GET /git/ref/heads/main`、`PATCH /git/refs/heads/main`。
 */

const TOKEN = 'ghp_thisIsASecretTokenValue';
const OWNER = 'octo';
const REPO = 'demo';
const BRANCH = 'main';
const API_BASE = 'https://api.github.com';
const REPO_PREFIX = `/repos/${OWNER}/${REPO}`;

const CHINESE = '第一行：今天要写完 GitHub 客户端\n第二行：中文与标点，符号 ✅\n';

type Call = {
  method: string;
  /** 去掉仓库前缀的路径尾巴；verify 的路径是空串。 */
  path: string;
  search: string;
  body: any;
  headers: Record<string, string>;
};

type FakeOptions = {
  /** 每次 `GET ref` 依次读到的 head sha；用完后重复最后一个（模拟远端前进）。 */
  heads?: string[];
  /** head sha → 它的 tree sha；缺省为 `tree-of-<head>`。 */
  headTrees?: Record<string, string>;
  /** 每次 `PATCH ref` 的状态码；缺省 200，用完后一直 200。 */
  patchStatuses?: number[];
  /** `GET ref` 的状态码；缺省 200（模拟分支不存在 / 令牌失效）。 */
  refStatus?: number;
  /** 每次 `POST blob` 的状态码；缺省 201，用完后一直 201。 */
  blobStatuses?: number[];
  /** `GET /repos/{owner}/{repo}` 的状态码；缺省 200。 */
  verifyStatus?: number;
  /** 令牌过期响应头；不传则整个响应头缺席。 */
  verifyExpiration?: string;
  /** `GET contents` 能读到的文件：仓库路径 → 内容与 sha。 */
  files?: Record<string, { content: string; sha: string }>;
  /** `GET tree?recursive=1` 返回的条目。 */
  treeEntries?: Array<{ path: string; type: string; sha?: string }>;
  truncated?: boolean;
};

function flattenHeaders(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (raw instanceof Headers) return Object.fromEntries(raw.entries());
  if (Array.isArray(raw)) return Object.fromEntries(raw as Array<[string, string]>);
  return { ...(raw as Record<string, string>) };
}

/**
 * 造一个"假 GitHub"：行为像真的（报文形状一致），但零网络、可脚本化失败。
 */
function fakeGitHub(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const heads = options.heads ?? ['head0'];
  let refReads = 0;
  let blobCount = 0;
  let treeCount = 0;
  let commitCount = 0;
  let patchCount = 0;

  const reply = (status: number, data: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  const fetchImpl = async (input: unknown, init: any = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = String(init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const path = url.pathname.startsWith(REPO_PREFIX)
      ? url.pathname.slice(REPO_PREFIX.length)
      : url.pathname;
    calls.push({ method, path, search: url.search, body, headers: flattenHeaders(init?.headers) });

    // GET /repos/{owner}/{repo} —— verify
    if (method === 'GET' && path === '') {
      const status = options.verifyStatus ?? 200;
      if (status !== 200) return reply(status, { message: 'Bad credentials' });
      const headers: Record<string, string> = options.verifyExpiration
        ? { 'github-authentication-token-expiration': options.verifyExpiration }
        : {};
      return reply(200, { full_name: `${OWNER}/${REPO}` }, headers);
    }

    // GET /git/ref/heads/{branch}
    if (method === 'GET' && path === `/git/ref/heads/${BRANCH}`) {
      refReads += 1;
      if (options.refStatus && options.refStatus !== 200) {
        return reply(options.refStatus, { message: 'Not Found' });
      }
      const sha = heads[Math.min(refReads - 1, heads.length - 1)] as string;
      return reply(200, { ref: `refs/heads/${BRANCH}`, object: { sha } });
    }

    // GET /git/commits/{sha}
    if (method === 'GET' && path.startsWith('/git/commits/')) {
      const sha = path.slice('/git/commits/'.length);
      const treeSha = options.headTrees?.[sha] ?? `tree-of-${sha}`;
      return reply(200, { sha, tree: { sha: treeSha } });
    }

    // POST /git/blobs
    if (method === 'POST' && path === '/git/blobs') {
      blobCount += 1;
      const status = options.blobStatuses?.[blobCount - 1] ?? 201;
      if (status !== 201) return reply(status, { message: 'Server Error' });
      return reply(201, { sha: `blob${blobCount}` });
    }

    // POST /git/trees
    if (method === 'POST' && path === '/git/trees') {
      treeCount += 1;
      return reply(201, { sha: `tree${treeCount}` });
    }

    // POST /git/commits
    if (method === 'POST' && path === '/git/commits') {
      commitCount += 1;
      const sha = `commit${commitCount}`;
      return reply(201, { sha, html_url: `https://github.com/${OWNER}/${REPO}/commit/${sha}` });
    }

    // PATCH /git/refs/heads/{branch}
    if (method === 'PATCH' && path === `/git/refs/heads/${BRANCH}`) {
      patchCount += 1;
      const status = options.patchStatuses?.[patchCount - 1] ?? 200;
      if (status !== 200) return reply(status, { message: 'Update is not a fast forward' });
      return reply(200, { ref: `refs/heads/${BRANCH}`, object: { sha: body?.sha } });
    }

    // GET /git/trees/{branch}?recursive=1
    if (method === 'GET' && path.startsWith('/git/trees/')) {
      return reply(200, {
        sha: 'treeRoot',
        truncated: options.truncated ?? false,
        tree: options.treeEntries ?? [],
      });
    }

    // GET /contents/{path}
    if (method === 'GET' && path.startsWith('/contents/')) {
      const repoPath = decodeURIComponent(path.slice('/contents/'.length));
      const file = options.files?.[repoPath];
      if (!file) return reply(404, { message: 'Not Found' });
      return reply(200, { sha: file.sha, encoding: 'base64', content: file.content });
    }

    throw new Error(`假 GitHub 收到未预期的请求：${method} ${path}`);
  };

  const client = createGitHubClient({
    token: TOKEN,
    owner: OWNER,
    repo: REPO,
    branch: BRANCH,
    apiBase: API_BASE,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

  return { client, calls };
}

/** 造一个写入项。`n` 只用来生成合法的日期文件名。 */
function write(n: number, content = `{"date":"2026-10-0${n}"}\n`) {
  return { path: `src/data/todos/2026-10-${String(n).padStart(2, '0')}.json`, content };
}

const COMMIT_INPUT = {
  message: 'chore(todo): 2026-10-01 — 更新 1 项',
  authorName: 'todo-admin',
  authorEmail: 'todo-admin@users.noreply.github.com',
};

/** 独立解码器：不复用被测模块的代码，避免"自己验证自己"。 */
function decodeBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** 独立编码器（用 Node 的 Buffer，仅测试里可用）：模拟 GitHub 返回的换行折行 base64。 */
function encodeWrapped(content: string): string {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  return `${(b64.match(/.{1,60}/g) ?? []).join('\n')}\n`;
}

function apiCalls(calls: Call[]): string[] {
  return calls.map((c) => `${c.method} ${c.path}`);
}

/** 从一次 rejects 里取出错误对象，供逐项断言。 */
async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('期望抛错，但实际成功了');
}

describe('createGitHubClient：配置校验', () => {
  test('空令牌当场抛中文错误，且一个请求都不发', () => {
    let fetched = 0;
    const fetchImpl = (async () => {
      fetched += 1;
      throw new Error('不该被调用');
    }) as unknown as typeof fetch;
    expect(() =>
      createGitHubClient({ token: '  ', owner: OWNER, repo: REPO, branch: BRANCH, fetchImpl }),
    ).toThrow(/令牌/);
    expect(fetched).toBe(0);
  });

  test('缺 owner / repo / branch 抛中文错误', () => {
    expect(() =>
      createGitHubClient({ token: TOKEN, owner: '', repo: REPO, branch: BRANCH }),
    ).toThrow(GitHubError);
  });
});

describe('verify：令牌与仓库连通性', () => {
  test('200 时读响应头 github-authentication-token-expiration 作为 expiresAt', async () => {
    const { client } = fakeGitHub({ verifyExpiration: '2026-11-30 12:00:00 UTC' });
    const result = await client.verify();
    expect(result).toEqual({ ok: true, expiresAt: '2026-11-30 12:00:00 UTC' });
  });

  test('200 但没有过期响应头时 expiresAt 为 null', async () => {
    const { client } = fakeGitHub();
    const result = await client.verify();
    expect(result.ok).toBe(true);
    expect(result.expiresAt).toBeNull();
  });

  test('401 返回 ok:false（不抛错），消息是中文且不泄露令牌', async () => {
    const { client } = fakeGitHub({ verifyStatus: 401 });
    const result = await client.verify();
    expect(result.ok).toBe(false);
    expect(result.expiresAt).toBeNull();
    expect(result.message).toMatch(/令牌/);
    expect(result.message).toContain('401');
    expect(result.message).not.toContain(TOKEN);
  });

  test('403 返回 ok:false（权限不足 / 限流）', async () => {
    const { client } = fakeGitHub({ verifyStatus: 403 });
    const result = await client.verify();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('403');
  });

  test('404 也按"无权访问"处理并返回 ok:false（细粒度令牌常见表现）', async () => {
    const { client } = fakeGitHub({ verifyStatus: 404 });
    const result = await client.verify();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('404');
  });

  test('500 抛 GitHubError，带状态码与中文消息，且不泄露令牌', async () => {
    const { client } = fakeGitHub({ verifyStatus: 500 });
    const error = await caught(client.verify());
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(500);
    expect((error as GitHubError).message).toMatch(/HTTP 500/);
    expect((error as GitHubError).message).toMatch(/[\u4e00-\u9fa5]/);
    expect((error as GitHubError).message).not.toContain(TOKEN);
  });

  test('网络本身失败时抛中文 GitHubError 而不是裸 TypeError', async () => {
    const client = createGitHubClient({
      token: TOKEN,
      owner: OWNER,
      repo: REPO,
      branch: BRANCH,
      apiBase: API_BASE,
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    const error = await caught(client.verify());
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).message).toMatch(/无法连接/);
  });

  test('令牌走 Authorization 头，不进 URL', async () => {
    const { client, calls } = fakeGitHub();
    await client.verify();
    expect(calls[0]?.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.search).toBe('');
  });
});

describe('listDataPaths：区分活跃区与归档区', () => {
  test('只认 src/data/todos 与 src/data/archive 下的日期文件，其余一律忽略', async () => {
    const { client, calls } = fakeGitHub({
      treeEntries: [
        { path: 'src/data/todos/2026-10-02.json', type: 'blob' },
        { path: 'src/data/todos/2026-10-01.json', type: 'blob' },
        { path: 'src/data/archive/2025/2025-03-09.json', type: 'blob' },
        { path: 'src/data/archive/2025/2025-01-01.json', type: 'blob' },
        // 无关项：README、非日期文件、别的目录、同名的目录条目
        { path: 'README.md', type: 'blob' },
        { path: 'src/data/todos/notes.txt', type: 'blob' },
        { path: 'src/data/archive/2025/2025-03-09.md', type: 'blob' },
        { path: 'src/data/other/2026-10-03.json', type: 'blob' },
        { path: 'src/data/todos', type: 'tree' },
        { path: 'src/data/todos/2026-10-04.json.bak', type: 'blob' },
      ],
    });

    const result = await client.listDataPaths();

    expect(result.active).toEqual([
      'src/data/todos/2026-10-01.json',
      'src/data/todos/2026-10-02.json',
    ]);
    expect(result.archive).toEqual([
      'src/data/archive/2025/2025-01-01.json',
      'src/data/archive/2025/2025-03-09.json',
    ]);

    expect(calls).toHaveLength(1);
    expect(apiCalls(calls)[0]).toBe(`GET /git/trees/${BRANCH}`);
    expect(calls[0]?.search).toBe('?recursive=1');
  });

  test('空仓库返回两个空数组', async () => {
    const { client } = fakeGitHub({ treeEntries: [] });
    await expect(client.listDataPaths()).resolves.toEqual({ active: [], archive: [] });
  });

  test('目录树被截断时抛错，而不是返回半份列表', async () => {
    const { client } = fakeGitHub({ truncated: true });
    const error = await caught(client.listDataPaths());
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).message).toMatch(/截断/);
  });
});

describe('getFile：读取单个数据文件', () => {
  test('404 返回 null（文件不存在不是错误）', async () => {
    const { client } = fakeGitHub({ files: {} });
    await expect(client.getFile('src/data/todos/2026-10-01.json')).resolves.toBeNull();
  });

  test('200 时解码出 UTF-8 内容与 sha（GitHub 的 base64 带折行）', async () => {
    const { client } = fakeGitHub({
      files: {
        'src/data/todos/2026-10-01.json': { content: encodeWrapped(CHINESE), sha: 'sha-1' },
      },
    });
    const file = await client.getFile('src/data/todos/2026-10-01.json');
    expect(file).toEqual({ content: CHINESE, sha: 'sha-1' });
  });

  test('读文件时带上 ref=分支', async () => {
    const { client, calls } = fakeGitHub({
      files: { 'src/data/todos/2026-10-01.json': { content: encodeWrapped('{}\n'), sha: 's' } },
    });
    await client.getFile('src/data/todos/2026-10-01.json');
    expect(apiCalls(calls)[0]).toBe('GET /contents/src/data/todos/2026-10-01.json');
    expect(calls[0]?.search).toBe(`?ref=${BRANCH}`);
  });

  test('拒绝越界路径', async () => {
    const { client } = fakeGitHub();
    const error = await caught(client.getFile('../secrets.json'));
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).message).toMatch(/路径/);
  });
});

describe('commitChanges：原子提交的调用序列', () => {
  test('序列为 ref → commit → blob×N → tree → commit → patch，且只 patch 一次、patch 在最后', async () => {
    const { client, calls } = fakeGitHub();
    await client.commitChanges({ writes: [write(1), write(2), write(3)], deletes: [], ...COMMIT_INPUT });

    expect(apiCalls(calls)).toEqual([
      'GET /git/ref/heads/main',
      'GET /git/commits/head0',
      'POST /git/blobs',
      'POST /git/blobs',
      'POST /git/blobs',
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/main',
    ]);
  });

  test('写 3 个文件只产生 1 次提交（不是每个文件一次）', async () => {
    const { client, calls } = fakeGitHub();
    await client.commitChanges({ writes: [write(1), write(2), write(3)], deletes: [], ...COMMIT_INPUT });

    expect(calls.filter((c) => c.method === 'POST' && c.path === '/git/commits')).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/git/trees')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  test('写入项以 mode/type/sha 出现在 tree entries，且 tree 用 base_tree 描述差分', async () => {
    const { client, calls } = fakeGitHub();
    await client.commitChanges({ writes: [write(1)], deletes: [], ...COMMIT_INPUT });

    const treeBody = calls.find((c) => c.path === '/git/trees')?.body;
    expect(treeBody.base_tree).toBe('tree-of-head0');
    expect(treeBody.tree).toEqual([
      { path: 'src/data/todos/2026-10-01.json', mode: '100644', type: 'blob', sha: 'blob1' },
    ]);
  });

  test('删除项以 sha:null 出现在 tree entries（不删文件内容，只描述差分）', async () => {
    const { client, calls } = fakeGitHub();
    await client.commitChanges({
      writes: [write(1)],
      deletes: ['src/data/todos/2026-10-02.json', 'src/data/archive/2025/2025-03-09.json'],
      ...COMMIT_INPUT,
    });

    const treeBody = calls.find((c) => c.path === '/git/trees')?.body;
    expect(treeBody.tree).toEqual([
      { path: 'src/data/todos/2026-10-01.json', mode: '100644', type: 'blob', sha: 'blob1' },
      { path: 'src/data/todos/2026-10-02.json', mode: '100644', type: 'blob', sha: null },
      { path: 'src/data/archive/2025/2025-03-09.json', mode: '100644', type: 'blob', sha: null },
    ]);
  });

  test('commit 带消息、父提交 head 与作者信息，返回 commitSha 与 htmlUrl', async () => {
    const { client, calls } = fakeGitHub();
    const result = await client.commitChanges({ writes: [write(1)], deletes: [], ...COMMIT_INPUT });

    const commitBody = calls.find((c) => c.path === '/git/commits')?.body;
    expect(commitBody.message).toBe(COMMIT_INPUT.message);
    expect(commitBody.tree).toBe('tree1');
    expect(commitBody.parents).toEqual(['head0']);
    expect(commitBody.author).toEqual({
      name: COMMIT_INPUT.authorName,
      email: COMMIT_INPUT.authorEmail,
    });

    expect(result).toEqual({
      commitSha: 'commit1',
      htmlUrl: `https://github.com/${OWNER}/${REPO}/commit/commit1`,
    });
  });

  test('PATCH 请求体里没有 force 字段（绝不 force push）', async () => {
    const { client, calls } = fakeGitHub();
    await client.commitChanges({ writes: [write(1)], deletes: [], ...COMMIT_INPUT });

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ sha: 'commit1' });
    expect(patch?.body).not.toHaveProperty('force');
  });

  test('空改动集直接抛中文错误，且一个请求都不发（不产生空提交）', async () => {
    const { client, calls } = fakeGitHub();
    const error = await caught(
      client.commitChanges({ writes: [], deletes: [], ...COMMIT_INPUT }),
    );
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).message).toMatch(/没有需要提交的改动/);
    expect(calls).toHaveLength(0);
  });

  test('提交信息或作者为空时直接抛错，不发任何请求', async () => {
    const { client, calls } = fakeGitHub();
    const error = await caught(
      client.commitChanges({ writes: [write(1)], deletes: [], ...COMMIT_INPUT, message: '   ' }),
    );
    expect(error).toBeInstanceOf(GitHubError);
    expect(calls).toHaveLength(0);
  });

  test('拒绝越界路径（绝不写到数据目录之外）', async () => {
    const { client, calls } = fakeGitHub();
    const error = await caught(
      client.commitChanges({
        writes: [{ path: '../../.github/workflows/deploy.yml', content: 'x' }],
        deletes: [],
        ...COMMIT_INPUT,
      }),
    );
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).message).toMatch(/路径/);
    expect(calls).toHaveLength(0);
  });

  test('同一路径既写又删（或写入两次）时直接报错，不发任何请求', async () => {
    const { client, calls } = fakeGitHub();
    const both = await caught(
      client.commitChanges({
        writes: [write(1)],
        deletes: [write(1).path],
        ...COMMIT_INPUT,
      }),
    );
    expect(both).toBeInstanceOf(GitHubError);
    expect((both as GitHubError).message).toMatch(/既写入又删除/);

    const twice = await caught(
      client.commitChanges({ writes: [write(1), write(1)], deletes: [], ...COMMIT_INPUT }),
    );
    expect(twice).toBeInstanceOf(GitHubError);
    expect((twice as GitHubError).message).toMatch(/两次/);

    expect(calls).toHaveLength(0);
  });

  test('删除列表内部重复也直接报错，不发任何请求', async () => {
    // 漏掉这一步时，两条一样的 tree 条目会被 GitHub 以 422 拒绝，
    // 而 422 的文案是"分支已被更新，请刷新后重试"——会把人骗进无限重试。
    const { client, calls } = fakeGitHub();
    const twice = await caught(
      client.commitChanges({ writes: [], deletes: [write(1).path, write(1).path], ...COMMIT_INPUT }),
    );
    expect(twice).toBeInstanceOf(GitHubError);
    expect((twice as GitHubError).message).toMatch(/删除了两次/);
    expect(calls).toHaveLength(0);
  });

  test('目录路径不能被当成文件写入或删除', async () => {
    // 只校验"在仓库里"时，`src/data/todos` 这种目录路径也是合法的；
    // 把它当写入目标，一次提交就会把整个 todos/ 子树替换成一个 blob。
    const { client, calls } = fakeGitHub();
    for (const dir of ['src/data/todos', 'src/data/archive', 'src/data']) {
      const asWrite = await caught(
        client.commitChanges({ writes: [{ path: dir, content: 'x' }], deletes: [], ...COMMIT_INPUT }),
      );
      expect(asWrite).toBeInstanceOf(GitHubError);
      expect((asWrite as GitHubError).message).toMatch(/只允许改动每日数据文件/);

      const asDelete = await caught(
        client.commitChanges({ writes: [], deletes: [dir], ...COMMIT_INPUT }),
      );
      expect(asDelete).toBeInstanceOf(GitHubError);
      expect((asDelete as GitHubError).message).toMatch(/只允许改动每日数据文件/);
    }
    expect(calls).toHaveLength(0);
  });

  test('数据目录之外的文件路径也被拒绝', async () => {
    const { client, calls } = fakeGitHub();
    for (const path of ['README.md', 'src/pages/index.astro', 'package.json']) {
      const res = await caught(
        client.commitChanges({ writes: [{ path, content: 'x' }], deletes: [], ...COMMIT_INPUT }),
      );
      expect(res).toBeInstanceOf(GitHubError);
    }
    expect(calls).toHaveLength(0);
  });

  test('归档搬迁（写归档路径 + 删活跃路径）是合法的', async () => {
    const { client, calls } = fakeGitHub();
    await client.commitChanges({
      writes: [{ path: 'src/data/archive/2026/2026-03-01.json', content: '{}' }],
      deletes: ['src/data/todos/2026-03-01.json'],
      ...COMMIT_INPUT,
    });
    // 合法搬迁必须真的发出去，没有被路径校验误杀。
    expect(calls.some((c) => c.path === '/git/trees')).toBe(true);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  test('形如数据文件但日期不可能存在的路径被拒绝', async () => {
    const { client, calls } = fakeGitHub();
    for (const path of ['src/data/todos/2026-13-01.json', 'src/data/todos/2026-02-31.json']) {
      const res = await caught(
        client.commitChanges({ writes: [{ path, content: 'x' }], deletes: [], ...COMMIT_INPUT }),
      );
      expect(res).toBeInstanceOf(GitHubError);
      expect((res as GitHubError).message).toMatch(/不是真实存在的日期/);
    }
    expect(calls).toHaveLength(0);
  });

  test('归档路径的年份目录必须与日期年份一致', async () => {
    const { client, calls } = fakeGitHub();
    const res = await caught(
      client.commitChanges({
        writes: [{ path: 'src/data/archive/2025/2026-03-01.json', content: '{}' }],
        deletes: [],
        ...COMMIT_INPUT,
      }),
    );
    expect(res).toBeInstanceOf(GitHubError);
    expect((res as GitHubError).message).toMatch(/归档目录 2025 与日期年份 2026 不一致/);
    expect(calls).toHaveLength(0);
  });

  test('删除列表不是数组时也报 GitHubError', async () => {
    const { client, calls } = fakeGitHub();
    const bad = await caught(
      client.commitChanges({
        writes: [],
        deletes: 'nope',
        ...COMMIT_INPUT,
      } as unknown as Parameters<typeof client.commitChanges>[0]),
    );
    expect(bad).toBeInstanceOf(GitHubError);
    expect(calls).toHaveLength(0);
  });

  test('写入/删除列表不是数组时报 GitHubError 而不是 TypeError', async () => {
    const { client, calls } = fakeGitHub();
    const bad = await caught(
      client.commitChanges({
        writes: 'nope',
        deletes: [],
        ...COMMIT_INPUT,
      } as unknown as Parameters<typeof client.commitChanges>[0]),
    );
    expect(bad).toBeInstanceOf(GitHubError);
    expect(calls).toHaveLength(0);
  });
});

describe('commitChanges：base64 编码', () => {
  test('中文与换行经 base64 往返完全一致', async () => {
    const { client, calls } = fakeGitHub();
    await client.commitChanges({ writes: [write(1, CHINESE)], deletes: [], ...COMMIT_INPUT });

    const blob = calls.find((c) => c.path === '/git/blobs')?.body;
    expect(blob.encoding).toBe('base64');
    expect(typeof blob.content).toBe('string');
    expect(blob.content).not.toContain('第一行'); // 发出去的是 base64，不是原文
    expect(decodeBase64(blob.content)).toBe(CHINESE);
  });

  test('大文件（20 万汉字）也能编码且不爆栈', async () => {
    const big = `${'待'.repeat(200_000)}\n`;
    const { client, calls } = fakeGitHub();
    await client.commitChanges({ writes: [write(1, big)], deletes: [], ...COMMIT_INPUT });

    const blob = calls.find((c) => c.path === '/git/blobs')?.body;
    expect(decodeBase64(blob.content)).toBe(big);
  });
});

describe('commitChanges：失败与重试', () => {
  test('非快进 422 时重跑整条链（带上新 head），第二次成功', async () => {
    const { client, calls } = fakeGitHub({
      heads: ['head0', 'head1'],
      patchStatuses: [422, 200],
    });

    const result = await client.commitChanges({ writes: [write(1)], deletes: [], ...COMMIT_INPUT });

    // 整条链跑了两遍：ref、commit、blob、tree、commit 各两次
    expect(calls.filter((c) => c.path === '/git/ref/heads/main')).toHaveLength(2);
    expect(calls.filter((c) => c.path === '/git/commits/head0')).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/git/commits/head1')).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/git/blobs')).toHaveLength(2);
    expect(calls.filter((c) => c.path === '/git/trees')).toHaveLength(2);
    expect(calls.filter((c) => c.path === '/git/commits')).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);

    // 第二次用的是新 base，父提交也是新 head
    const treeBodies = calls.filter((c) => c.path === '/git/trees').map((c) => c.body);
    expect(treeBodies.map((b) => b.base_tree)).toEqual(['tree-of-head0', 'tree-of-head1']);
    const commitBodies = calls.filter((c) => c.path === '/git/commits').map((c) => c.body);
    expect(commitBodies.map((b) => b.parents)).toEqual([['head0'], ['head1']]);

    expect(result.commitSha).toBe('commit2');
  });

  test('连吃三次 422 后抛可读的中文错误，且只尝试 3 次', async () => {
    const { client, calls } = fakeGitHub({
      heads: ['head0', 'head1', 'head2'],
      patchStatuses: [422, 422, 422],
    });

    const error = await caught(
      client.commitChanges({ writes: [write(1)], deletes: [], ...COMMIT_INPUT }),
    );

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(422);
    expect((error as GitHubError).message).toMatch(/[\u4e00-\u9fa5]/);
    expect((error as GitHubError).message).toContain('422');
    expect((error as GitHubError).message).toContain('3');

    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(3);
    expect(calls.filter((c) => c.path === '/git/ref/heads/main')).toHaveLength(3);
  });

  test('blob 上传 500 时整次发布中止：一次 PATCH 都没有（不留半截提交）', async () => {
    const { client, calls } = fakeGitHub({ blobStatuses: [201, 500] });

    const error = await caught(
      client.commitChanges({ writes: [write(1), write(2)], deletes: [], ...COMMIT_INPUT }),
    );

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(500);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    expect(calls.filter((c) => c.path === '/git/trees')).toHaveLength(0);
    expect(calls.filter((c) => c.path === '/git/commits')).toHaveLength(0);
    // token 只能出现在 Authorization 头里，绝不能漏进错误文案
    expect((error as GitHubError).message).not.toContain(TOKEN);
  });

  test('PATCH 失败时错误文案里也不含 token', async () => {
    const { client } = fakeGitHub({ heads: ['h0', 'h1', 'h2'], patchStatuses: [422, 422, 422] });
    const error = await caught(
      client.commitChanges({ writes: [write(1)], deletes: [], ...COMMIT_INPUT }),
    );
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).message).not.toContain(TOKEN);
  });

  test('blob 上传 401 时报文可读且不泄露令牌', async () => {
    const { client } = fakeGitHub({ blobStatuses: [401] });
    const error = await caught(
      client.commitChanges({ writes: [write(1)], deletes: [], ...COMMIT_INPUT }),
    );
    expect((error as GitHubError).status).toBe(401);
    expect((error as GitHubError).message).toMatch(/令牌/);
    expect((error as GitHubError).message).not.toContain(TOKEN);
  });

  test('读分支 404 时立即中止，不做任何写入', async () => {
    const { client, calls } = fakeGitHub({ refStatus: 404 });

    const error = await caught(
      client.commitChanges({ writes: [write(1)], deletes: [], ...COMMIT_INPUT }),
    );

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(404);
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
    expect(calls.filter((c) => c.path === '/git/trees')).toHaveLength(0);
  });
});

/**
 * 守卫：`github.ts` 会打进后台岛屿的浏览器 bundle。
 * 与 `auth.ts` / `entry-codec.ts` 的同款守卫保持一致。
 */
describe('守卫：github 不含 node 依赖与不能用浏览器跑的东西', () => {
  const src = readFileSync('src/lib/github.ts', 'utf8');

  test('不含 node: 导入，也不引用 Buffer', () => {
    expect(src).not.toMatch(/from ['"]node:/);
    expect(src).not.toMatch(/require\(['"]node:/);
    expect(src).not.toMatch(/\bBuffer\b/);
  });

  test('不用 String.fromCharCode(...bytes) 这种会爆栈的一次性展开', () => {
    expect(src).not.toMatch(/fromCharCode\([^)]*\.\.\./);
  });

  test('源码里没有 force: true', () => {
    expect(src).not.toMatch(/force\s*:\s*true/);
  });

  test('不含 React / DOM 依赖', () => {
    expect(src).not.toMatch(/from ['"]react/);
    expect(src).not.toMatch(/document\./);
    expect(src).not.toMatch(/localStorage/);
  });
});
