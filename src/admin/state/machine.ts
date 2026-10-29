/**
 * 后台状态机：**纯 reducer**，不碰 DOM、不碰网络、不做 I/O。
 *
 * ## 四个状态，一条铁律
 *
 * ```
 * locked ──UNLOCK_OK──▶ disconnected ──TOKEN_OK──▶ ready ──PUBLISH_START──▶ publishing
 *           UNLOCK_FAIL         TOKEN_FAIL ◀──┐      ▲        PUBLISH_FAIL ◀──┘
 *           （留在 locked）      （留在 ready）  └──────┘  PUBLISH_OK / CLEAR_TOKEN
 * ```
 *
 * **`disconnected` 这个变体里没有 `days` 字段。** 这不是"忘了清空"，而是类型结构：
 * 依赖它就必须先写 `if (state.status === 'ready')`，`days` 才在作用域里。于是
 * 「没连上 GitHub 却渲染出了任务数据」在编译期就写不出来 —— 这比任何一条
 * "记得别渲染"的注释或测试都可靠。数据只可能来自 `client.getFile()`（仓库），
 * 绝不来自构建产物或本地缓存。
 *
 * ## `dirty` 不是第五个状态
 *
 * `dirty`（有未保存改动）是 `ready` 之上的**派生条件**（`dirty.size > 0`），
 * 由 `deriveView()` 折算成 `dirty` 视图。它不能独立存在，所以"未就绪却有未保存改动"
 * 这种组合没有地方可以写出来。
 *
 * ## 失败为什么不丢改动
 *
 * `TOKEN_FAIL` 与 `PUBLISH_FAIL` 都返回 `status: 'ready'`，并把进来的 `days` / `dirty`
 * **原样（同一个对象）** 带过去，只额外挂一条 `error`。改动的存亡由类型结构决定，
 * 不靠 reducer 记得"此处不要清空"。`publishing` 里也完整带着 `days` / `dirty` / `selected`，
 * 正是为了让"提交失败"能原地恢复。
 *
 * ## 契约
 *
 * - **纯函数**：不修改入参，返回新对象（`days` / `dirty` 有变化时一定换新容器）。
 * - **穷举**：`action` 结束时做 `never` 检查，将来新增动作而漏了分支会**编译失败**；
 *   运行期万一收到未知动作则抛错，绝不静默吞掉（静默吞掉会让"点了没反应"变成谜）。
 * - 可以安全地喂给 `React.useReducer`。
 */

import type { DayEntry } from '@/lib/types';

/** 后台的全部状态。注意 `disconnected` **没有** `days` 字段，这是刻意的。 */
export type AdminState =
  | { status: 'locked'; error?: string }
  | { status: 'disconnected'; tokenExpiresAt: string | null; error?: string }
  | {
      status: 'ready';
      days: Record<string, DayEntry>;
      selected: string;
      dirty: Set<string>;
      tokenExpiresAt: string | null;
      error?: string;
    }
  | {
      status: 'publishing';
      days: Record<string, DayEntry>;
      selected: string;
      dirty: Set<string>;
      tokenExpiresAt: string | null;
    };

/** 全部动作。字段即语义：`message` 一律是**给人看的中文**。 */
export type AdminAction =
  /** 口令校验通过。 */
  | { type: 'UNLOCK_OK' }
  /** 口令不对（或校验本身失败）。 */
  | { type: 'UNLOCK_FAIL'; message: string }
  /** 令牌验证 + 首轮数据读取都成功；`days` 由调用方（`ConnectView`）从仓库读出来。 */
  | { type: 'TOKEN_OK'; days: Record<string, DayEntry>; selected: string; tokenExpiresAt: string | null }
  /** 令牌失效 / 网络故障 / 读取失败。停在 `ready`，改动不丢。 */
  | { type: 'TOKEN_FAIL'; message: string }
  /** 断开连接：令牌被清除，数据一并丢弃。 */
  | { type: 'CLEAR_TOKEN' }
  /** 选中另一天（只换 `selected`）。 */
  | { type: 'SELECT_DAY'; date: string }
  /** 某一天被改过：替换该天条目并标记为未保存。 */
  | { type: 'PATCH_DAY'; day: DayEntry }
  /** 开始提交。 */
  | { type: 'PUBLISH_START' }
  /** 提交成功：清空 `dirty`。 */
  | { type: 'PUBLISH_OK' }
  /** 提交失败：回到 `ready`，`days` / `dirty` 原样保留。 */
  | { type: 'PUBLISH_FAIL'; message: string };

/** 起点。口令门在前，所以默认是 `locked`。 */
export const initialAdminState: AdminState = { status: 'locked' };

/** `ready` / `publishing` 共有的那份数据（两者在数据上完全一致，只是能不能编辑不同）。 */
type LoadedState = Extract<AdminState, { status: 'ready' | 'publishing' }>;

function loaded(state: LoadedState): Pick<LoadedState, 'days' | 'selected' | 'dirty' | 'tokenExpiresAt'> {
  return {
    days: state.days,
    selected: state.selected,
    dirty: state.dirty,
    tokenExpiresAt: state.tokenExpiresAt,
  };
}

/**
 * 状态机本体。
 *
 * 结构上只有一处"真的会丢数据"：`CLEAR_TOKEN` 与 `UNLOCK_OK`。其余分支要么原样带过去，
 * 要么在原数据上换一个字段——看一眼就知道改动丢不了。
 */
export function adminReducer(state: AdminState, action: AdminAction): AdminState {
  switch (action.type) {
    case 'UNLOCK_OK':
      // 口令门只是"界面遮挡"，解开之后仍然没有仓库数据可看 —— 所以进 disconnected，
      // 且这个变体里根本没有 `days` 字段。
      return { status: 'disconnected', tokenExpiresAt: null };

    case 'UNLOCK_FAIL':
      // 只有停在 locked 上才谈得上"口令错"；别的状态收到它就是过时的异步结果，原样不动。
      return state.status === 'locked' ? { status: 'locked', error: action.message } : state;

    case 'TOKEN_OK':
      // 数据整批换成刚从仓库读回来的那一份，所以 `dirty` 归零：旧的改动标记指向的内容
      // 已经被远端内容替换掉了，留着只会让人以为有尚未发布的改动。
      return {
        status: 'ready',
        days: action.days,
        selected: action.selected,
        dirty: new Set<string>(),
        tokenExpiresAt: action.tokenExpiresAt,
      };

    case 'TOKEN_FAIL':
      if (state.status === 'ready') return { ...state, error: action.message };
      if (state.status === 'disconnected') return { ...state, error: action.message };
      if (state.status === 'locked') return { ...state, error: action.message };
      // `publishing` 没有 `error` 字段：正在提交时收到"令牌失效"只可能是过时的结果，
      // 提交链路自己会以 `PUBLISH_FAIL` 收尾。
      return state;

    case 'CLEAR_TOKEN':
      // 断开连接 = 数据一起丢弃。想再看数据，得重新连接、重新从仓库读。
      return { status: 'disconnected', tokenExpiresAt: null };

    case 'SELECT_DAY':
      // 换一天看，不等于改了什么：`dirty` 一个字都不动。
      return state.status === 'ready' ? { ...state, selected: action.date } : state;

    case 'PATCH_DAY': {
      if (state.status !== 'ready') return state;
      const date = action.day.date;
      if (date === '') return state;
      return {
        ...state,
        // 新的 `days` / `dirty` 容器：绝不就地改上一份 state（React 靠引用判断变化）。
        days: { ...state.days, [date]: action.day },
        dirty: new Set([...state.dirty, date]),
      };
    }

    case 'PUBLISH_START':
      if (state.status !== 'ready') return state;
      // 把整份数据带进 `publishing`：提交失败时才能原样恢复。
      return { status: 'publishing', ...loaded(state) };

    case 'PUBLISH_OK':
      // 只有"正在提交"才有发布成功可言；`ready` 上收到就当清空 `dirty`（幂等）。
      if (state.status === 'publishing') {
        return {
          status: 'ready',
          ...loaded(state),
          dirty: new Set<string>(),
        };
      }
      if (state.status === 'ready') return { ...state, dirty: new Set<string>(), error: undefined };
      return state;

    case 'PUBLISH_FAIL':
      if (state.status === 'publishing') {
        // 回到 `ready`，改动与选中的那一天原样保留，只多一条错误。
        return { status: 'ready', ...loaded(state), error: action.message };
      }
      if (state.status === 'ready') return { ...state, error: action.message };
      return state;

    default: {
      // 穷举兜底：将来往 `AdminAction` 里加了动作却忘了处理，这里会**编译失败**；
      // 运行期（旧 bundle、拼错的字符串）则明确抛错，而不是"点了没反应"。
      const unknown: never = action;
      throw new Error(`未知的后台状态动作：${JSON.stringify(unknown)}`);
    }
  }
}

/**
 * `dirty` 是不是空的 —— 内部工具：`ready` 之上的派生条件。
 *
 * 单独抽出来是因为后台外壳（`AdminApp`）要把它和 `deriveView` 拼起来用，
 * 而 `dirty` 只在 `ready` / `publishing` 上存在。
 */
export function hasUnsavedChanges(state: AdminState): boolean {
  return 'dirty' in state && state.dirty.size > 0;
}
