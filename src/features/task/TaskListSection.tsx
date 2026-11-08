/**
 * 管理页的任务列表段（收口批次：PipelineAdminPage 并入任务视图）。
 *
 * 为什么放在管线监控页而不是单开一页：运维真正要知道的是"最近跑过什么、成没成、
 * 花了多少"。老 runs 与任务列表本质是同一件事的两代数据结构，放一起才好对照，
 * 也方便 C7 之后直接删掉老那块。
 */

import { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';

import { Badge } from '@/components/ui';
import { taskApi } from '@/services/api/task';
import type { TaskListItem } from '@/types/task';
import { useCopilotStore, TRACE_TAB } from '@/stores/copilotStore';
import { useTaskStore } from '@/stores/taskStore';

import { statusLabel } from '@/features/task/labels';

function variantOf(status: string) {
  if (status === 'done') return 'success' as const;
  if (status === 'failed') return 'error' as const;
  // PRD B5：后端终态但前端未适配 → 警告色（不是"失败"，也不是"成功"）
  if (status === 'unknown_terminal') return 'warning' as const;
  if (status === 'running') return 'info' as const;
  return 'default' as const;
}

export function TaskListSection() {
  // /task/$taskId 页已删除（PRD §19.3）：点任务改为切到固定的「轨迹」标签。
  // 动态 task-run 标签会被 normalizeTabs 丢弃，必须先把该任务装进 store。
  const openInCopilot = (taskId: string) => {
    void useTaskStore.getState().load(taskId);
    useCopilotStore.getState().openTab(TRACE_TAB);
    useCopilotStore.getState().setActive(TRACE_TAB.id);
  };
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await taskApi.list(20);
        if (!cancelled) setItems(res.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mb-6 max-w-[900px]" aria-label="任务列表">
      <h2 className="flex items-center gap-1.5 text-title-sm font-medium text-on-surface mb-2">
        <ListChecks className="w-4 h-4 text-primary" /> 最近任务（主 Agent）
      </h2>
      {error && <p className="text-caption text-error">{error}</p>}
      {items.length === 0 ? (
        <p className="text-caption text-on-surface-variant">
          还没有任务记录。首页「一句话出片」可以发起一条。
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => openInCopilot(item.id)}
                className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-cw-sm
                  bg-surface-container hover:bg-surface-container-high text-caption"
              >
                <Badge variant={variantOf(item.status)}>{statusLabel(item.status)}</Badge>
                <span className="text-on-surface truncate flex-1">{item.topic}</span>
                <span className="text-on-surface-variant">{item.steps} 步</span>
                <span className="text-on-surface-variant font-mono">{item.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
