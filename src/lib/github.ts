/**
 * GitHub 客户端：后台发布面板与仓库之间的**唯一通道**（纯浏览器可用）。
 *
 * 铁律（改之前请先读完，这里每一行都在保护你真实的仓库）：
 *
 * 1. 本文件**不得 import 任何 `node:*` 模块**，也不得 import React / 任何 DOM API
 *    （`fetch` 除外）——`github.test.ts` 里有守卫测试。它会被打进后台岛屿的 bundle。
 * 2. **绝不力推。** `PATCH /git/refs/...` 的 body 里没有 `force` 字段；
 *    非快进（422）只会触发"重跑整条链"，永远不会被覆盖。
 * 3. **一次逻辑改动 = 一个 tree + 一个 commit。** 中途任何一步失败，仓库一个字都没变。
 * 4. token 只是参数：不进 URL、不进日志、不进异常消息（异常消息里只有方法与路径）。
 * 5. 内容用 base64 传，编码走分块循环（`auth.ts` 的 `bytesToBase64`），
 *    **不要**把整个字节数组一次性展开喂给 `String.fromCharCode`：20 万汉字就够爆栈。
 *
 * 设计上的一个重要取舍：写入不逐文件调 `PUT /contents/...`，那条路每写一个文件就是
 * 一次提交，写第 3 个文件时失败会留下"前 2 个已提交"的半截状态。这里改用 Git Data API
 * 拼一个 tree（`base_tree` 只描述差分）+ 一个 commit，最后**一次** PATCH 移动分支指针：
 * 分支指针不动，所有 blob/tree/commit 都只是仓库里的孤立对象，读代码的人看到的分支
 * 始终是改动前或改动后的完整状态。
 */

import { base64ToBytes, bytesToBase64 } from './auth';
import { siteConfig } from '../../site.config.ts';

/** 数据文件所在目录（仓库相对路径），唯一真相是 `site.config.ts`。 */
const ACTIVE_DIR = siteConfig.data.activeDir.replace(/\/+$/, '');
const ARCHIVE_DIR = siteConfig.data.archiveDir.replace(/\/+$/, '');

const DEFAULT_API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
/** GitHub 用它告知令牌到期时间；细粒度 PAT 未必给，所以可能缺席。 */
const EXPIRATION_HEADER = 'github-authentication-token-expiration';
/** 非快进冲突重试上限（含首次尝试）。 */
const MAX_ATTEMPTS = 3;
/** 普通文件在 git tree 里的固定模式与类型。 */
const FILE_MODE = '100644';
const FILE_TYPE = 'blob';

/**
 * 这些状态码都表示"令牌进不去这个仓库"，`verify()` 会翻译成 `ok: false` 而不是抛错。
 *
 * 为什么 404 也算：细粒度 PAT 权限不足或未选中该仓库时，GitHub 返回的就是 404
 * （它不告诉你仓库是否存在）。对用户来说这与 401 是同一件事——"这个令牌访问不了这个仓库"。
 */
const AUTH_FAILURE_STATUSES: readonly number[] = [401, 403, 404];

/** 提交/读取时用的错误类型：面板靠 `instanceof` 区分"可展示的中文错误"与真 bug。 */
export class GitHubError extends Error {
  /** HTTP 状态码；纯网络故障或本地校验失败时为 `null`。 */
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export type GitHubConfig = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
};

export type VerifyResult = { ok: boolean; expiresAt: string | null; message?: string };

/** 仓库相对路径，例如 `src/data/todos/2026-10-01.json`。 */
export type DataPaths = { active: string[]; archive: string[] };

export type FileContent = { content: string; sha: string };

export type CommitInput = {
  writes: { path: string; content: string }[];
  deletes: string[];
  message: string;
  authorName: string;
  authorEmail: string;
};

export type CommitResult = { commitSha: string; htmlUrl: string };

export type GitHubClient = {
  verify(): Promise<VerifyResult>;
  listDataPaths(): Promise<DataPaths>;
  getFile(path: string): Promise<FileContent | null>;
  commitChanges(input: CommitInput): Promise<CommitResult>;
};

/** git tree 条目：`sha` 为 `null` 表示删除该路径。 */
type TreeEntry = {
  path: string;
  mode: string;
  type: string;
  sha: string | null;
};

type RawReply = { status: number; headers: Headers; data: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

/** 逐段编码路径，保留 `/` 作为分隔符。 */
function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/');
}

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  return String(error);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 活跃区：`<activeDir>/YYYY-MM-DD.json`；归档区：`<archiveDir>/YYYY/YYYY-MM-DD.json`。 */
const ACTIVE_PATH_RE = new RegExp(`^${escapeRegExp(ACTIVE_DIR)}/\\d{4}-\\d{2}-\\d{2}\\.json$`);
const ARCHIVE_PATH_RE = new RegExp(
  `^${escapeRegExp(ARCHIVE_DIR)}/\\d{4}/\\d{4}-\\d{2}-\\d{2}\\.json$`,
);

/**
 * 仓库路径安全校验：拒绝绝对路径、反斜杠、空段、`.` 与 `..`。
 *
 * 后台算出来的路径理论上总是 `entryPath()` 的产物，但这里是"能改坏真实仓库"的最后一道闸：
 * 一个 `../` 就能把提交写到数据目录之外，宁可在发请求前就炸掉。
 */
function assertRepoPath(path: unknown): string {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new GitHubError('仓库路径不能为空');
  }
  const segments = path.split('/');
  const illegal =
    path.startsWith('/') ||
    path.includes('\\') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  if (illegal) {
    throw new GitHubError(`仓库路径不合法：${path}（必须以仓库根目录为基准，不能含 . 或 ..）`);
  }
  return path;
}

/** UTF-8 文本 → base64（分块编码，见文件头第 5 条）。 */
function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** base64 → UTF-8 文本。GitHub 的 base64 每 60 字符插一个换行，先抹掉空白。 */
function base64ToUtf8(text: string): string {
  const bytes = base64ToBytes(text.replace(/\s+/g, ''));
  if (bytes === null) throw new GitHubError('GitHub 返回的文件内容不是合法的 base64，无法解码');
  return new TextDecoder('utf-8').decode(bytes);
}

/** 按状态码给出中文处置建议——错误消息必须能指导用户下一步做什么。 */
function hintForStatus(status: number): string {
  switch (status) {
    case 401:
      return '。令牌无效或已过期，请重新生成后再连接';
    case 403:
      return '。令牌权限不足（需要 Contents: Read and write），或已触发 GitHub 限流';
    case 404:
      return '。仓库或分支不存在，或令牌无权访问该仓库';
    case 409:
      return '。仓库是空的，没有可以追加提交的历史';
    case 422:
      return '。请求被 GitHub 拒绝（分支已被更新，或提交内容与现状完全相同）';
    default:
      return status >= 500 ? '。GitHub 服务暂时不可用，请稍后重试' : '';
  }
}

/** 取 GitHub 返回体里的 `message` 作为补充说明；绝不包含凭据。 */
function serverDetail(data: unknown): string {
  if (isRecord(data)) {
    const message = data.message;
    if (typeof message === 'string' && message.trim() !== '') return message.trim().slice(0, 200);
  }
  return '';
}

function httpError(what: string, reply: RawReply): GitHubError {
  const detail = serverDetail(reply.data);
  const suffix = detail === '' ? '' : `：${detail}`;
  return new GitHubError(
    `${what}失败（HTTP ${reply.status}）${suffix}${hintForStatus(reply.status)}`,
    reply.status,
  );
}

/**
 * 创建 GitHub 客户端。
 *
 * `fetchImpl` 只为测试注入而存在（默认取全局 `fetch`）；**测试绝不允许打真实网络**。
 * 配置不完整时同步抛错——比等到第一次点击"发布"才失败好得多。
 */
export function createGitHubClient(cfg: GitHubConfig): GitHubClient {
  const token = typeof cfg.token === 'string' ? cfg.token.trim() : '';
  if (token === '') throw new GitHubError('缺少 GitHub 令牌，无法连接仓库');

  const owner = typeof cfg.owner === 'string' ? cfg.owner.trim() : '';
  const repo = typeof cfg.repo === 'string' ? cfg.repo.trim() : '';
  const branch = typeof cfg.branch === 'string' ? cfg.branch.trim() : '';
  if (owner === '' || repo === '' || branch === '') {
    throw new GitHubError('GitHub 连接配置不完整：owner / repo / branch 都必须填写');
  }

  const apiBase = (cfg.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const repoUrl = `/repos/${encodeSegment(owner)}/${encodeSegment(repo)}`;
  /**
   * 分支名**不编码**：`feature/x` 这类名字里的 `/` 是 ref 的路径分隔符，
   * 编码成 `%2F` 反而会让 GitHub 404。
   */
  const refUrl = `/git/ref/heads/${branch}`;
  const refsUrl = `/git/refs/heads/${branch}`;
  const commitsUrl = `${repoUrl}/git/commits`;

  /** `api.github.com` → `github.com`；GitHub Enterprise 则去掉 `/api/v3`。 */
  const webBase =
    apiBase === DEFAULT_API_BASE ? 'https://github.com' : apiBase.replace(/\/api\/v3$/, '');

  function resolveFetch(): typeof fetch {
    const impl = cfg.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof impl !== 'function') {
      throw new GitHubError('当前环境没有可用的 fetch，无法访问 GitHub');
    }
    return impl;
  }

  /**
   * 发一个请求并解析 JSON。
   *
   * 只有"根本没连上"才在这里抛错（网络故障、fetch 缺失）；HTTP 非 2xx 一律交给调用方
   * 用 `ensureOk` / 状态码判断——`verify()` 需要把 401/403 变成 `ok: false` 而不是异常。
   *
   * 注意：错误消息里只有方法与路径，**没有 headers**，令牌不会随着异常跑到界面上。
   */
  async function send(method: string, path: string, body?: unknown): Promise<RawReply> {
    const doFetch = resolveFetch();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await doFetch(`${apiBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new GitHubError(`无法连接 GitHub（${method} ${path}）：${reasonOf(error)}`, null);
    }

    let data: unknown = null;
    try {
      const text = await response.text();
      data = text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      // 响应不是 JSON（网关错误页之类）：保持 data 为 null，由状态码给出结论。
      data = null;
    }
    return { status: response.status, headers: response.headers, data };
  }

  function ensureOk(reply: RawReply, what: string): void {
    if (reply.status >= 200 && reply.status < 300) return;
    throw httpError(what, reply);
  }

  /** 读分支当前 head 的 commit sha。 */
  async function readBranchHead(): Promise<string> {
    const reply = await send('GET', `${repoUrl}${refUrl}`);
    ensureOk(reply, '读取分支');
    // 文档：ref 名有歧义时返回数组；取 ref 完全相等的那一条。
    const wanted = `refs/heads/${branch}`;
    const picked = Array.isArray(reply.data)
      ? reply.data.find((item) => isRecord(item) && item.ref === wanted)
      : reply.data;
    const sha = isRecord(picked) && isRecord(picked.object) ? picked.object.sha : undefined;
    if (typeof sha !== 'string' || sha === '') {
      throw new GitHubError('GitHub 返回的分支信息里没有 commit sha，无法继续提交');
    }
    return sha;
  }

  /** 读某个 commit 的 tree sha —— 这就是下一次提交的 `base_tree`。 */
  async function readCommitTree(commitSha: string): Promise<string> {
    const reply = await send('GET', `${commitsUrl}/${encodeSegment(commitSha)}`);
    ensureOk(reply, '读取提交');
    const tree = isRecord(reply.data) ? reply.data.tree : undefined;
    const sha = isRecord(tree) ? tree.sha : undefined;
    if (typeof sha !== 'string' || sha === '') {
      throw new GitHubError('GitHub 返回的提交信息里没有 tree sha，无法继续提交');
    }
    return sha;
  }

  /** 上传一份文件内容，得到一个 blob sha。 */
  async function createBlob(content: string): Promise<string> {
    const reply = await send('POST', `${repoUrl}/git/blobs`, {
      content: utf8ToBase64(content),
      encoding: 'base64',
    });
    ensureOk(reply, '上传文件内容');
    const sha = isRecord(reply.data) ? reply.data.sha : undefined;
    if (typeof sha !== 'string' || sha === '') {
      throw new GitHubError('GitHub 没有返回新 blob 的 sha，无法继续提交');
    }
    return sha;
  }

  /** 用一个 tree 描述整批改动（写入 + 删除），挂在 `base_tree` 上。 */
  async function createTree(baseTreeSha: string, entries: TreeEntry[]): Promise<string> {
    const reply = await send('POST', `${repoUrl}/git/trees`, {
      base_tree: baseTreeSha,
      tree: entries,
    });
    ensureOk(reply, '创建目录树');
    const sha = isRecord(reply.data) ? reply.data.sha : undefined;
    if (typeof sha !== 'string' || sha === '') {
      throw new GitHubError('GitHub 没有返回新 tree 的 sha，无法继续提交');
    }
    return sha;
  }

  /** 建一个 parent 为当前 head 的 commit。 */
  async function createCommit(input: {
    message: string;
    treeSha: string;
    parentSha: string;
    authorName: string;
    authorEmail: string;
  }): Promise<{ sha: string; htmlUrl: string }> {
    const reply = await send('POST', commitsUrl, {
      message: input.message,
      tree: input.treeSha,
      parents: [input.parentSha],
      author: { name: input.authorName, email: input.authorEmail },
    });
    ensureOk(reply, '创建提交');
    const sha = isRecord(reply.data) ? reply.data.sha : undefined;
    if (typeof sha !== 'string' || sha === '') {
      throw new GitHubError('GitHub 没有返回新 commit 的 sha，无法确认发布结果');
    }
    const htmlUrl = isRecord(reply.data) ? reply.data.html_url : undefined;
    return {
      sha,
      htmlUrl:
        typeof htmlUrl === 'string' && htmlUrl !== ''
          ? htmlUrl
          : `${webBase}/${encodeSegment(owner)}/${encodeSegment(repo)}/commit/${sha}`,
    };
  }

  /**
   * 移动分支指针——**整个发布里唯一真正改动仓库的请求**。
   *
   * 返回 `false` 表示非快进（422）：说明有人在这期间往分支上推了东西，
   * 调用方必须重跑整条链拿到新 base，**而不是**加 `force` 硬压过去。
   */
  async function updateRef(commitSha: string): Promise<boolean> {
    const reply = await send('PATCH', `${repoUrl}${refsUrl}`, { sha: commitSha });
    if (reply.status === 200 || reply.status === 201) return true;
    if (reply.status === 422) return false;
    throw httpError('更新分支', reply);
  }

  async function verify(): Promise<VerifyResult> {
    const reply = await send('GET', repoUrl);
    if (AUTH_FAILURE_STATUSES.includes(reply.status)) {
      // 令牌问题不抛异常：连接页要原地显示"这条令牌不行"，而不是白屏。
      return {
        ok: false,
        expiresAt: null,
        message: `无法验证 GitHub 令牌（HTTP ${reply.status}）${hintForStatus(reply.status)}`,
      };
    }
    ensureOk(reply, '验证仓库访问权限');
    const raw = reply.headers.get(EXPIRATION_HEADER);
    const expiresAt = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
    return { ok: true, expiresAt };
  }

  async function listDataPaths(): Promise<DataPaths> {
    const reply = await send('GET', `${repoUrl}/git/trees/${branch}?recursive=1`);
    ensureOk(reply, '读取仓库文件列表');

    const data = reply.data;
    const tree = isRecord(data) ? data.tree : undefined;
    if (!Array.isArray(tree)) {
      throw new GitHubError('GitHub 返回的目录树格式无法识别，无法列出数据文件');
    }
    if (isRecord(data) && data.truncated === true) {
      // 半份列表比不给更危险：面板会以为某些文件不存在，从而把它们当作"待创建"。
      throw new GitHubError(
        '仓库文件过多，GitHub 返回的目录树被截断，无法安全地列出数据文件；请检查仓库规模',
      );
    }

    const active: string[] = [];
    const archive: string[] = [];
    for (const entry of tree) {
      if (!isRecord(entry)) continue;
      const path = entry.path;
      if (typeof path !== 'string') continue;
      if (entry.type !== FILE_TYPE) continue;
      if (ACTIVE_PATH_RE.test(path)) {
        active.push(path);
        continue;
      }
      if (ARCHIVE_PATH_RE.test(path)) archive.push(path);
    }

    // 排序让面板与测试都稳定（路径是零填充日期，字典序即时间序）。
    active.sort();
    archive.sort();
    return { active, archive };
  }

  async function getFile(path: string): Promise<FileContent | null> {
    const repoPath = assertRepoPath(path);
    const reply = await send(
      'GET',
      `${repoUrl}/contents/${encodePath(repoPath)}?ref=${encodeSegment(branch)}`,
    );
    if (reply.status === 404) return null;
    ensureOk(reply, `读取文件 ${repoPath}`);

    const data = reply.data;
    if (!isRecord(data)) throw new GitHubError(`读取文件 ${repoPath} 失败：GitHub 返回体无法识别`);
    const encoding = data.encoding;
    const content = data.content;
    const sha = data.sha;
    if (typeof sha !== 'string' || sha === '') {
      throw new GitHubError(`读取文件 ${repoPath} 失败：GitHub 没有返回文件 sha`);
    }
    if (encoding !== 'base64' || typeof content !== 'string') {
      // Contents API 对大于 1MB 的文件返回 `encoding: "none"`。
      throw new GitHubError(
        `文件 ${repoPath} 过大（超过 1MB），无法通过 Contents API 读取；数据文件不应这么大`,
      );
    }
    return { content: base64ToUtf8(content), sha };
  }

  async function commitChanges(input: CommitInput): Promise<CommitResult> {
    // 先做全部本地校验：校验放在任何请求之前，错配置就不会留下孤立 blob。
    const writes = (input.writes ?? []).map((write) => {
      if (typeof write.content !== 'string') {
        throw new GitHubError(`写入项 ${String(write.path)} 的内容必须是字符串`);
      }
      return { path: assertRepoPath(write.path), content: write.content };
    });
    const deletes = (input.deletes ?? []).map((path) => assertRepoPath(path));
    if (writes.length === 0 && deletes.length === 0) {
      // 空提交在 GitHub 那边是 422，而且会污染历史；在本地就拒绝，语义更清楚。
      throw new GitHubError('没有需要提交的改动，未创建任何提交');
    }
    if (typeof input.message !== 'string' || input.message.trim() === '') {
      throw new GitHubError('提交信息不能为空');
    }
    if (
      typeof input.authorName !== 'string' ||
      input.authorName.trim() === '' ||
      typeof input.authorEmail !== 'string' ||
      input.authorEmail.trim() === ''
    ) {
      throw new GitHubError('提交者姓名与邮箱不能为空（GitHub 需要它们来记录作者）');
    }
    // 同一个路径在 tree 里只能出现一次（GitHub 对重复条目直接 422）。
    // 与其让远端拒绝，不如在这里说清楚是调用方的哪一处重复了。
    const writePaths = new Set<string>();
    for (const write of writes) {
      if (writePaths.has(write.path)) throw new GitHubError(`同一个文件被写入了两次：${write.path}`);
      writePaths.add(write.path);
    }
    for (const path of deletes) {
      if (writePaths.has(path)) {
        throw new GitHubError(`同一个文件不能既写入又删除：${path}`);
      }
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // 每次尝试都从"重新读 head"开始：上一次 422 说明远端已前进，
      // 拿旧 base_tree 再提交只会被再拒一次。
      const headSha = await readBranchHead();
      const baseTreeSha = await readCommitTree(headSha);

      const entries: TreeEntry[] = [];
      for (const write of writes) {
        entries.push({
          path: write.path,
          mode: FILE_MODE,
          type: FILE_TYPE,
          sha: await createBlob(write.content),
        });
      }
      for (const path of deletes) {
        entries.push({ path, mode: FILE_MODE, type: FILE_TYPE, sha: null });
      }

      const treeSha = await createTree(baseTreeSha, entries);
      const commit = await createCommit({
        message: input.message,
        treeSha,
        parentSha: headSha,
        authorName: input.authorName,
        authorEmail: input.authorEmail,
      });

      if (await updateRef(commit.sha)) {
        return { commitSha: commit.sha, htmlUrl: commit.htmlUrl };
      }
      // 422：非快进。走到这里什么都没有发布出去（分支指针没动），继续下一轮。
    }

    throw new GitHubError(
      `发布失败：分支 ${branch} 在提交期间被反复更新，已重试 ${MAX_ATTEMPTS} 次仍未成功（HTTP 422）。` +
        '仓库没有任何改动被写入，请刷新后重试',
      422,
    );
  }

  return { verify, listDataPaths, getFile, commitChanges };
}
