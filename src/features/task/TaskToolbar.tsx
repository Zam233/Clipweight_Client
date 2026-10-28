/**
 * 任务控制条（路线 C / C4 / Q6）。
 *
 * Q6 已裁定：**逐 Step 确认只用于 dangerous 档**，所以这里的插话框默认收起，
 * 不打断用户。暂停/继续/取消始终可见（长任务里"停一下"是最常见需求）。
 *
 * PRD B11（2026-10-29 / G8）：状态与动作收敛到一张 `STATUS_ACTIONS` 表。
 * 之前是散在 JSX 里的 `status === 'x'` 判断，加一个状态就要改三处，
 * 而且「后端终态（unknown_terminal）」当时没人处理——按钮会出现不该出现的「继续」。
 */
import { useState } from 'react';
import { MessageSquarePlus, Pause, Play, X, Eye } from 'lucide-react';

import { Button } from '@/components/ui';
import type { TaskStatus } from '@/types/task';

interface Props {
  status: TaskStatus;
  busy?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onInject?: (text: string) => void;
  /** 终态时「查看结果」的入口（跳到产物/结论，不重新跑） */
  onViewResult?: () => void;
}

interface StatusAction {
  label: string;
  hint: string;
  pause?: boolean;
  resume?: boolean;
  cancel?: boolean;
  view?: boolean;
  inject?: boolean;
}

/** 单一事实源：每个状态能做什么、旁边那句人话是什么意思。 */
export const STATUS_ACTIONS: Record<TaskStatus, StatusAction> = {
  pending: {
    label: '待开始', hint: '还没开始跑；点「开始」会真的花预算',
    resume: true, cancel: true, inject: true,
  },
  planning: {
    label: '正在规划', hint: '主 agent 在做初始假设', pause: true, cancel: true,
  },
  running: {
    label: '执行中', hint: '暂停后已完成的步骤不会重跑', pause: true, cancel: true, inject: true,
  },
  paused: {
    label: '已暂停', hint: '暂停不是结束：点「继续」会从检查点接着跑', resume: true, cancel: true, inject: true,
  },
  done: {
    label: '已完成', hint: '任务已结束，不能继续；要重做请新建任务', view: true,
  },
  failed: {
    label: '未完成', hint: '任务已结束（失败）；可以先看结果，再新建重做', view: true,
  },
  cancelled: {
    label: '已取消', hint: '任务已结束，不能继续', view: true,
  },
  unknown_terminal: {
    label: '后端终态（待适配）', hint: '后端给了前端还不认识的终态原因；任务已结束，不能继续',
    view: true,
  },
};

export function TaskToolbar({
  status, busy, onPause, onResume, onCancel, onInject, onViewResult,
}: Props) {
  const [text, setText] = useState('');
  const action = STATUS_ACTIONS[status] ?? STATUS_ACTIONS.pending;
  const terminal = !action.pause && !action.resume && !action.inject && action.view === true;

  const resumeLabel = status === 'paused' ? '继续' : '开始';

  return (
    <div className="space-y-2" data-testid="task-toolbar" data-status={status}>
      <div className="flex items-center gap-2">
        <span className="sr-only">任务状态</span>
        <span className="text-caption text-on-surface-variant">{action.label}</span>
        {action.pause && (
          <Button size="sm" variant="outline" onClick={onPause} disabled={busy}>
            <Pause className="w-3.5 h-3.5 mr-1" /> 暂停
          </Button>
        )}
        {action.resume && (
          <Button size="sm" onClick={onResume} disabled={busy}>
            <Play className="w-3.5 h-3.5 mr-1" /> {resumeLabel}
          </Button>
        )}
        {action.view && onViewResult && (
          <Button size="sm" variant="outline" onClick={onViewResult} disabled={busy}>
            <Eye className="w-3.5 h-3.5 mr-1" /> 查看结果
          </Button>
        )}
        {action.cancel && (
          <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
            <X className="w-3.5 h-3.5 mr-1" /> 取消
          </Button>
        )}
        <span className="text-caption text-on-surface-variant" data-testid="task-status-hint">
          {action.hint}
        </span>
      </div>

      {action.inject && !terminal && (
        <div className="flex items-center gap-2">
          <input
            className="flex-1 bg-surface-container rounded-cw-sm px-2.5 py-1.5 text-caption text-on-surface outline-none border border-outline-variant/30 focus:border-primary"
            placeholder="想插一句话？例如：第 3 段换成实拍"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="人工插话"
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={!text.trim() || busy}
            onClick={() => {
              if (!text.trim()) return;
              onInject?.(text.trim());
              setText('');
            }}
          >
            <MessageSquarePlus className="w-3.5 h-3.5 mr-1" /> 插话
          </Button>
        </div>
      )}
    </div>
  );
}
