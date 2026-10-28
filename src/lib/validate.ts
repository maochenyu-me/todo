/**
 * 后台编辑期的**校验与自愈**纯逻辑。
 *
 * 与 `entry-codec.ts` 的分工（别合并，也别互相重复规则）：
 * - `entry-codec.ts` 校验"从磁盘/JSON.parse 读到的**未知原始值**"，是结构层，错误带
 *   `tasks[2].title` 这类定位前缀，越界值一律报错。
 * - 本文件校验"面板里已经被解析成 `Task` 的**对象**"，是编辑层，返回**给用户看的中文文案**
 *   （spec 8.7），要贴在表单字段下方，且必须逐字一致。
 * - 长度上限（标题 ≤ 200、备注 ≤ 2000、标签 ≤ 10 × 20）只在这里管；`normalizeTask` 的自愈
 *   （补 `completedAt`、tag 去重）也只在这里。
 *
 * 铁律：本文件不得 import `node:*`，也不得 import 任何框架——后台在浏览器里跑。
 */

import type { DayEntry, Task } from './types';

/** spec 8.7 表格的文案，逐字对应，改动前先改 spec。 */
const MSG = {
  titleRequired: '待办需要一个标题。',
  titleTooLong: '标题最多 200 字，长内容请写进备注。',
  noteTooLong: '备注最多 2000 字。',
  tags: '最多 10 个标签，每个不超过 20 字。',
  timeBlock: '结束时间要晚于开始时间。',
  duplicateId: '出现重复标识，请删除后重新添加这一条。',
} as const;

const MAX_TITLE = 200;
const MAX_NOTE = 2000;
const MAX_TAGS = 10;
const MAX_TAG = 20;

/**
 * 按**字符**（码点）计长度，而非 UTF-16 码元。
 * `'😀'.length === 2`，用户眼里的"一个字"会被算成两个字，emoji 标题会被无故判超长。
 */
function charCount(s: string): number {
  return Array.from(s).length;
}

/**
 * 校验单个 task，返回人类可读中文错误（空数组 = 通过）。
 *
 * 只查 spec 8.7 的硬闸，**不查结构合法性**：字段类型、`HH:MM` 格式、时间戳是否为空
 * 都属于 `entry-codec.ts` 那条读盘路径的活。这里拿到的是已经定形的 `Task`。
 */
export function validateTask(task: Task): string[] {
  const errors: string[] = [];

  // 标题：先去空白再判空与计长。"  写周报  " 与 "写周报" 对用户是同一个标题，
  // 两侧空白不该让 200 字的内容变成 204 字而被拒。
  const title = task.title.trim();
  if (title === '') {
    // 空标题只报"需要一个标题"，不再叠加长度错误（空串当然不超长，逻辑上也互斥）。
    errors.push(MSG.titleRequired);
  } else if (charCount(title) > MAX_TITLE) {
    errors.push(MSG.titleTooLong);
  }

  // 备注是长内容容器，两侧空白可能是刻意的排版，故不 trim，只按原文计长。
  if (charCount(task.note) > MAX_NOTE) errors.push(MSG.noteTooLong);

  // 标签：去空白后丢掉空标签再计数（空白标签不会渲染成胶囊，`normalizeTask` 也会丢弃它，
  // 把它算进上限会让用户看着 9 个标签却被判"最多 10 个"）。但**不去重**：去重后计数会让
  // 面板上明明排着 11 个胶囊的列表通过校验——用户看得见的数量才是该被判的数量。
  const tags = task.tags.map((t) => t.trim()).filter((t) => t !== '');
  if (tags.length > MAX_TAGS || tags.some((t) => charCount(t) > MAX_TAG)) {
    // 一条文案覆盖"数量超限"与"单个超长"两种情形——spec 8.7 就是同一句。
    errors.push(MSG.tags);
  }

  // 时间块：`null` 表示不排时间，合法。`HH:MM` 是零填充的，故字符串字典序即时刻序，
  // 不必解析成分钟。`end === start` 是零长度时间段，同样报错。
  // 前提是格式已合法——`"9:00"` 这种缺零填充的输入属于结构错误，由 `entry-codec.ts` 拦，
  // 到不了这一层（面板的时间输入框产出的永远是 `HH:MM`）。
  if (task.timeBlock !== null && task.timeBlock.end <= task.timeBlock.start) {
    errors.push(MSG.timeBlock);
  }

  return errors;
}

/**
 * 校验一整天，返回人类可读中文错误（空数组 = 通过）。
 *
 * 只**报错**，不修改 `entry`：整天的 `order` 重排由调用方（编辑器/发布流程）在做完
 * 增删改之后自行处理，`normalizeTask` 也**不会**重排 `order`（它只拿到一个 task，
 * 无法知道整天的顺序）。别指望这个函数顺手帮你修数据。
 */
export function validateDay(entry: DayEntry): string[] {
  const errors: string[] = [];

  // 先按任务顺序收集各自的字段错误。
  for (const task of entry.tasks) {
    errors.push(...validateTask(task));
  }

  // 再查同日 id 重复：同一个 id 出现 N 次只报一条（用户只需要知道"这一条重复了"），
  // 两个不同 id 各自重复则各报一条。空 id 是结构问题（entry-codec 管），这里不判。
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const task of entry.tasks) {
    if (seen.has(task.id)) {
      if (!reported.has(task.id)) {
        errors.push(MSG.duplicateId);
        reported.add(task.id);
      }
    } else {
      seen.add(task.id);
    }
  }

  return errors;
}

/**
 * 自愈：把一条 task 收敛成可以直接落盘的形状，返回**新对象**，绝不改入参。
 *
 * 做三件事（也只有三件）：
 * 1. `done === true` 却没有 `completedAt`（`null`、`undefined` 或全空白）→ 补上当前时间的
 *    ISO 字符串。这是 spec 8.7 最后一行的"自愈优先于让用户理解内部约束"。
 *    `done === false` 时**不动**已有的 `completedAt`（那是用户的记录，不该被静默抹掉）。
 * 2. `tags` 逐项去空白、丢空串、去重（保留首次出现的顺序）。
 * 3. **不重排 `order`**——单条 task 无从知道自己在整天的位置；重排整天 `order` 是调用方的事。
 */
export function normalizeTask(task: Task, now: Date = new Date()): Task {
  // `typeof !== 'string'` 一并兜住 `null` 与运行时可能出现的 `undefined`——类型上
  // `Task.completedAt` 是 `string | null`，但数据来自 JSON，不赌它没被手改过。
  // 只在 `done === true` 时补；`done === false` 时原样保留（已有记录不该被静默抹掉）。
  const hasCompletedAt = typeof task.completedAt === 'string' && task.completedAt.trim() !== '';
  const completedAt = task.done && !hasCompletedAt ? now.toISOString() : task.completedAt;

  const tags: string[] = [];
  for (const raw of task.tags) {
    const tag = raw.trim();
    if (tag !== '' && !tags.includes(tag)) tags.push(tag);
  }

  return { ...task, completedAt, tags };
}
