/**
 * 底部"正在运行的子 agent"（PRD §19.3 / 需求 9）
 *
 * - 数据源：`GET /api/pipeline/{taskId}/subagents`（task id 兼容 pid）；
 * - 事件驱动 + 3s 兜底轮询（只在任务非终态时）；
 * - **只在点击时**打开标签（绝不自动开，防标签爆炸）。
 */
import React from 'react';
import { Bot } from 'lucide-react';
import { supervisorApi } from '@/services/api';
import { useCopilotStore } from '@/stores/copilotStore';

interface SubagentNode {
  id: string;
  role?: string;
  status?: string;
  cost_usd?: number;
  duration_ms?: number;
}

export function RunningSubagents({ taskId, active }: { taskId: string; active?: boolean }) {
  const [nodes, setNodes] = React.useState<SubagentNode[]>([]);
  const openTab = useCopilotStore((s) => s.openTab);

  React.useEffect(() => {
    if (!taskId) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const res = await supervisorApi.getSubagents(taskId);
        if (!alive) return;
        const list = ((res as { subagents?: SubagentNode[]; nodes?: SubagentNode[] }).subagents
          ?? (res as { nodes?: SubagentNode[] }).nodes ?? []) as SubagentNode[];
        setNodes(list);
      } catch {
        /* 没有子 agent / 端点不可用：静默（这里不是错误现场） */
      }
    };
    void load();
    if (!active) return () => { alive = false; };
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [taskId, active]);

  if (!nodes.length) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1 border-t border-outline-variant/20 px-3 py-1.5"
      data-testid="running-subagents"
    >
      <span className="text-caption text-on-surface-variant/70">子 agent</span>
      {nodes.map((n) => (
        <button
          key={n.id}
          type="button"
          data-subagent-chip={n.id}
          className="inline-flex items-center gap-1 rounded-full border border-outline-variant/40 px-2 py-0.5 text-caption text-on-surface-variant hover:border-outline hover:text-on-surface"
          onClick={() => openTab({
            id: `subagent:${n.id}`,
            kind: 'subagent',
            title: `${n.role || '子 agent'}`,
            closable: true,
            payload: { taskId, subagentId: n.id },
          })}
        >
          <Bot className="h-3 w-3" />
          <span className="max-w-[96px] truncate">{n.role || n.id}</span>
          <span className="text-on-surface-variant/60">{n.status || ''}</span>
        </button>
      ))}
    </div>
  );
}
