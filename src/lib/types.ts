export type Priority = 0 | 1 | 2;

export type TimeBlock = { start: string; end: string };

export type Task = {
  id: string;
  title: string;
  done: boolean;
  completedAt: string | null;
  order: number;
  priority: Priority;
  tags: string[];
  note: string;
  timeBlock: TimeBlock | null;
  createdAt: string;
  updatedAt: string;
};

export type DayEntry = { date: string; tasks: Task[] };

/**
/**
 * 主导航的键。与 `src/components/TopBar.astro` 的导航项一一对应；
 * 单日页 `/date/[date]` 归入 `today`。
 */
export type NavKey = 'today' | 'archive' | 'calendar' | 'tags' | 'stats';
