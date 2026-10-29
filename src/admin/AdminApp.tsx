import { CheckCircle2, CloudOff, Loader2, Lock, PencilLine, Wrench } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';

import { Button } from './components/ui/button';
import { Checkbox } from './components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Select } from './components/ui/select';
import { Toaster } from './components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Textarea } from './components/ui/textarea';
import { deriveView, type Phase, type View } from './view-state';

/**
 * 后台外壳（`/admin` 的唯一 React 岛屿）。
 *
 * ## 这一版只有骨架
 *
 * 状态机四个状态：`locked`（要口令）/ `disconnected`（没连上 GitHub）/
 * `ready`（可以编辑）/ `publishing`（正在提交）。
 *
 * `dirty`（有未保存改动）**不是第五个状态**，而是 `ready` 的派生条件——只有在
 * 就绪之上才谈得上「改过没改」。所以下面的 `view` 由 `phase` 加 `dirty` 算出来，
 * 不额外存一份 status，从根上排除「未就绪但有未保存改动」这种非法组合。
 * 那条计算本身抽在 `./view-state.ts`（纯函数 `deriveView`，有穷举测试）。
 *
 * 每个分支现在只画一个占位块。**Task 13–16 会把占位块整段替换掉**：
 * - Task 13 → `locked` 换成真正的锁屏（口令校验）
 * - Task 14 → `disconnected` 换成 GitHub 连接流程
 * - Task 15 → `ready` / `dirty` 换成条目编辑器
 * - Task 16 → `publishing` 换成提交/发布进度
 *
 * 底部的「调试条」与「技术栈自检」面板同样是临时脚手架：Task 13 接上真实状态机后
 * 整块删除。它们存在的唯一目的，是让当前这一步能人工逐个验证四个视图都渲染得出来。
 */

const PHASE_ORDER: readonly Phase[] = ['locked', 'disconnected', 'ready', 'publishing'];

const PHASE_LABEL: Record<Phase, string> = {
  locked: '未解锁',
  disconnected: '未连接',
  ready: '就绪',
  publishing: '发布中',
};

const VIEW_LABEL: Record<View, string> = {
  ...PHASE_LABEL,
  dirty: '就绪 · 有未保存改动',
};

/** 每个视图的占位文案。Task 13–16 会连同占位块一起替换。 */
const PLACEHOLDER: Record<View, { icon: typeof Lock; title: string; body: string }> = {
  locked: {
    icon: Lock,
    title: '锁屏（占位）',
    body: '这里会显示口令输入框，校验通过后进入「就绪」。由 Task 13 实现。',
  },
  disconnected: {
    icon: CloudOff,
    title: '未连接 GitHub（占位）',
    body: '这里会显示仓库连接状态与填写访问令牌的表单。由 Task 14 实现。',
  },
  ready: {
    icon: CheckCircle2,
    title: '就绪（占位）',
    body: '这里会显示当天的条目编辑器：新增、勾选、排序、加标签。由 Task 15 实现。',
  },
  dirty: {
    icon: PencilLine,
    title: '就绪 · 有未保存改动（占位）',
    body: '编辑器会在此状态提示「有改动未保存」，发布入口才会亮起。由 Task 15、16 实现。',
  },
  publishing: {
    icon: Loader2,
    title: '发布中（占位）',
    body: '这里会显示提交进度与失败重试；发布期间编辑入口锁住。由 Task 16 实现。',
  },
};

export default function AdminApp({ siteTitle }: { siteTitle: string }) {
  // 将来被真实状态机替换的就是这一处：Task 13 起改由会话 + GitHub 连接共同决定。
  const [phase, setPhase] = React.useState<Phase>('locked');
  // `ready` 之上的派生条件；不在 ready 下时它没有意义，也不读。
  const [dirty, setDirty] = React.useState(false);

  const view: View = deriveView(phase, dirty);
  const { icon: ViewIcon, title, body } = PLACEHOLDER[view];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[64rem] flex-col gap-6 px-5 pt-8 pb-16 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-semibold tracking-[-0.01em]">{siteTitle} · 后台</h1>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            骨架版本：四个视图均为占位，锁屏、连接、编辑与发布尚未接线。
          </p>
        </div>
        {/* data-view 给自动化测试读当前状态用，不参与样式。 */}
        <span
          data-testid="admin-view"
          data-view={view}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-[0.8125rem]',
            phase === 'publishing' ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground',
          )}
        >
          <ViewIcon
            className={cn('size-3.5', phase === 'publishing' && 'animate-spin')}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          {VIEW_LABEL[view]}
        </span>
      </header>

      {/* 当前状态的占位视图。Task 13–16 用真实界面替换整块。 */}
      <section
        aria-labelledby="admin-view-title"
        className="flex flex-col items-start gap-3 rounded-[var(--radius)] border border-border bg-card px-5 py-6"
      >
        <h2 id="admin-view-title" className="flex items-center gap-2 text-[1.0625rem] font-semibold">
          <ViewIcon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          {title}
        </h2>
        <p className="max-w-[42rem] text-[0.9375rem] leading-relaxed text-muted-foreground">{body}</p>
      </section>

      <DebugBar phase={phase} dirty={dirty} onPhase={setPhase} onDirty={setDirty} />

      <Toaster position="bottom-right" />
    </div>
  );
}

/**
 * 临时调试条：手动切换状态机状态、手动翻转 `dirty`。
 * **Task 13 接上真实状态机后整块删除**（连同下面的 `TechCheckDialog`）。
 */
function DebugBar({
  phase,
  dirty,
  onPhase,
  onDirty,
}: {
  phase: Phase;
  dirty: boolean;
  onPhase: (next: Phase) => void;
  onDirty: (next: boolean) => void;
}) {
  return (
    <section
      aria-label="状态调试（临时）"
      className="mt-auto rounded-[var(--radius)] border border-dashed border-border px-4 py-3"
    >
      <p className="mb-2 flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
        <Wrench className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        临时调试：切换状态机状态（Task 13–16 接线后删除）
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {PHASE_ORDER.map((item) => (
          <Button
            key={item}
            size="sm"
            variant={phase === item ? 'default' : 'outline'}
            aria-pressed={phase === item}
            onClick={() => {
              // 离开 ready 时顺手清掉 dirty：它只是 ready 的派生条件，
              // 留着会让「再回到 ready」时凭空多出未保存改动。
              if (item !== 'ready') onDirty(false);
              onPhase(item);
            }}
          >
            {PHASE_LABEL[item]}
          </Button>
        ))}
        <Button
          size="sm"
          variant={dirty ? 'default' : 'outline'}
          aria-pressed={dirty}
          disabled={phase !== 'ready'}
          title={phase === 'ready' ? undefined : '只有「就绪」下才有未保存改动这一说'}
          onClick={() => onDirty(!dirty)}
        >
          未保存改动
        </Button>
        <TechCheckDialog />
      </div>
    </section>
  );
}

/** 组件自检面板：把这次接线引入的每个 UI 组件各渲染一次，确认样式与交互都活着。 */
function TechCheckDialog() {
  const [confirmed, setConfirmed] = React.useState(false);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          技术栈自检
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>技术栈自检</DialogTitle>
          <DialogDescription>
            这几个控件只用来确认组件已接线、配色沿用站点令牌。Task 13–16 会删掉这个面板。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="form" className="mt-4">
          <TabsList>
            <TabsTrigger value="form">表单</TabsTrigger>
            <TabsTrigger value="toast">提示</TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="flex flex-col gap-3 pt-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tech-title">标题</Label>
              <Input id="tech-title" defaultValue="写清楚今天要做什么" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tech-note">备注</Label>
              <Textarea id="tech-note" rows={2} placeholder="可选" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tech-priority">优先级</Label>
              <Select id="tech-priority" defaultValue="1">
                <option value="0">低</option>
                <option value="1">中</option>
                <option value="2">高</option>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="tech-done" defaultChecked />
              <Label htmlFor="tech-done">已完成</Label>
            </div>
          </TabsContent>

          <TabsContent value="toast" className="flex flex-col items-start gap-2 pt-1">
            <Button size="sm" onClick={() => toast.success('已保存', { description: '草稿留在本地。' })}>
              成功提示
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => toast.error('发布失败', { description: '令牌无权写入仓库。' })}
            >
              失败提示
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              关闭
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={() => {
              setConfirmed(true);
              toast('自检通过：组件正常渲染');
            }}
          >
            记录自检
          </Button>
        </DialogFooter>
        {confirmed ? <p className="mt-2 text-[0.8125rem] text-done">已记录本次自检。</p> : null}
      </DialogContent>
    </Dialog>
  );
}
