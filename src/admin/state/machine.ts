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
 * ## `selected` 只可能指向**真的载入过**的那一天
 *
 * 进 `ready` 时 `selected` 不是调用方传进来的，而是 `selectDay()` 从 `days` 的键里挑的
 * （优先"今天"，否则已解析的最新一天）。这不是洁癖：仓库里某一天的文件**存在但解析失败**时，
 * 它既不在 `days` 里、也不该被选中 —— 否则编辑器会把那一天当成"空白的新一天"，
 * 发布时用一个空条目覆盖掉仓库里那份读不出来的真实文件。那是源数据上的静默丢失。
 * 同理，一天都没读出来时**根本不进 `ready`**（空编辑器 + 一个虚构的 `selected` 只会更糟）。
 *
 * ## 没载入的那几天不会消失
 *
 * `ready` / `publishing` 上带 `loadWarnings`：仓库里存在、但这次没能载入的日期与原因。
 * 它是数据源**不完整**的证据，必须活着穿过 `TOKEN_OK`、`PUBLISH_START`、`PUBLISH_FAIL`，
 * 直到 `CLEAR_TOKEN` 才随数据一起丢弃。发布链路（Task 16）应当据此**拒绝**写入这些日期
 * ——它们的内容还躺在仓库里没被读出来，覆盖就是丢数据。
 *
 * ## 契约
 *
 * - **纯函数**：不修改入参，返回新对象（`days` / `dirty` 有变化时一定换新容器）。
 * - **穷举**：`action` 结束时做 `never` 检查，将来新增动作而漏了分支会**编译失败**；
 *   运行期万一收到未知动作则抛错，绝不静默吞掉（静默吞掉会让"点了没反应"变成谜）。
 * - 可以安全地喂给 `React.useReducer`。
 */

import type { DayEntry } from '@/lib/types';

/**
 * 仓库里**存在**、但这次没能载入的一天。
 *
 * 与"这一天不存在"必须分开：不存在可以新建，存在却读不出来时覆盖就是丢数据。
 */
export type LoadWarning = { date: string; message: string };

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
      /** 存在但没能载入的日期；`undefined` 与空数组同义（都表示"全都载入了"）。 */
      loadWarnings?: LoadWarning[];
    }
  | {
      status: 'publishing';
      days: Record<string, DayEntry>;
      selected: string;
      dirty: Set<string>;
      tokenExpiresAt: string | null;
      loadWarnings?: LoadWarning[];
    };

/** 全部动作。字段即语义：`message` 一律是**给人看的中文**。 */
export type AdminAction =
  /** 口令校验通过。 */
  | { type: 'UNLOCK_OK' }
  /** 口令不对（或校验本身失败）。 */
  | { type: 'UNLOCK_FAIL'; message: string }
  /**
   * 令牌验证 + 首轮数据读取都成功；`days` 由调用方（`ConnectView`）从仓库读出来。
   *
   * **注意这里没有 `selected`**：选哪一天由 `selectDay()` 从 `days` 里派生，
   * 调用方只能提供"希望优先选中哪天"（`todayKey`）。这样"选中的那天其实没载入"
   * 就写不出来了。
   */
  | {
      type: 'TOKEN_OK';
      days: Record<string, DayEntry>;
      todayKey: string;
      tokenExpiresAt: string | null;
      loadWarnings?: LoadWarning[];
    }
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

/**
 * 把 `ready` / `publishing` 的数据原样搬过去（**同一个对象**，不是复制）。
 *
 * `loadWarnings` 也在这里搬：它证明"数据源不完整"，发布失败回到 `ready` 时必须还在，
 * 否则用户会以为上次那几天的读取失败已经不存在了。
 */
function loaded(
  state: LoadedState,
): Pick<LoadedState, 'days' | 'selected' | 'dirty' | 'tokenExpiresAt' | 'loadWarnings'> {
  return {
    days: state.days,
    selected: state.selected,
    dirty: state.dirty,
    tokenExpiresAt: state.tokenExpiresAt,
    loadWarnings: state.loadWarnings,
  };
}

/**
 * 进 `ready` 时选哪一天：优先 `todayKey`，否则**已成功解析的**最新一天。
 *
 * 只在 `days` 的键里挑，所以返回值一定指向一份真实载入的数据 —— 仓库里那些
 * "存在但解析失败"的日期不可能被选中。日期键是零填充的 `YYYY-MM-DD`，
 * 所以字典序最大即时间最新。
 */
export function selectDay(days: Record<string, DayEntry>, todayKey: string): string {
  if (days[todayKey] !== undefined) return todayKey;
  const dates = Object.keys(days).sort();
  return dates[dates.length - 1] ?? todayKey;
}

/** 读 `loadWarnings`（`undefined` 与空数组同义，都表示"全都载入了"）。 */
export function loadWarningsOf(state: AdminState): LoadWarning[] {
  return 'loadWarnings' in state ? (state.loadWarnings ?? []) : [];
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

    case 'TOKEN_OK': {
      const parsedDates = Object.keys(action.days).sort();
      if (parsedDates.length === 0) {
        // 一天都没读出来：**不进 `ready`**。否则会得到一个"有编辑入口、但没有数据、
        // 且 `selected` 指向一份读不出来的文件"的界面——那正是覆盖丢数据的入口。
        // 调用方本应先发 `TOKEN_FAIL`；这里是最后一道防线。
        return state.status === 'disconnected'
          ? { ...state, error: '连上了仓库，但没有任何一天的数据文件被成功读取' }
          : state;
      }
      // 数据整批换成刚从仓库读回来的那一份，所以 `dirty` 归零：旧的改动标记指向的内容
      // 已经被远端内容替换掉了，留着只会让人以为有尚未发布的改动。
      return {
        status: 'ready',
        days: action.days,
        // 派生而不是接收：`selected` 一定是 `days` 里真实存在的键。
        selected: selectDay(action.days, action.todayKey),
        dirty: new Set<string>(),
        loadWarnings: action.loadWarnings ?? [],
        tokenExpiresAt: action.tokenExpiresAt,
      };
    }

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
