/**
 * 任务视图里的子代理（路线 C / C5 收口）。
 *
 * 为什么单独一块：主 Agent 派出去的"核查员"如果用户看不见，等于这次派生没发生。
 * 子代理树本来就按 pipeline id 归属（任务 id 在这里就是 pipeline id），
 * 所以直接复用 `/api/pipeline/{id}/subagents`，不新造通道。
 */

import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';

import { Badge } from '@/components/ui';
import { supervisorApi } from '@/services/api/supervisor';
import type { SubagentNode } from '@/types/supervisor';

interface Props {
  taskId: string;
  /** 终态后不再轮询（省请求，也避免用户看到已经结束还在转的状态） */
  active?: boolean;
}

function statusVariant(status: SubagentNode['status']) {
  if (status === 'done') return 'success' as const;
  if (status === 'failed') return 'error' as const;
  if (status === 'running') return 'info' as const;
  return 'default' as const;
}

export function TaskSubagents({ taskId, active = true }: Props) {
  const [nodes, setNodes] = useState<SubagentNode[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await supervisorApi.getSubagents(taskId);
        if (!cancelled) setNodes(res.tree ?? []);
      } catch {
        // 子代理是附加信息：拉不到就不显示，不打扰主流程
        if (!cancelled) setNodes([]);
      }
    };
    void load();
    if (!active) return () => { cancelled = true; };
    const timer = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId, active]);

  if (nodes.length === 0) return null;

  return (
    <section className="space-y-1.5" aria-label="子代理">
      <h2 className="text-body-sm font-semibold text-on-surface flex items-center gap-1.5">
        <Bot className="w-4 h-4" /> 子代理（{nodes.length}）
      </h2>
      <ul className="space-y-1">
        {nodes.map((node) => (
          <li
            key={node.id}
            className="flex items-center gap-2 text-caption px-2.5 py-1.5 rounded-cw-sm bg-surface-container"
          >
            <Badge variant={statusVariant(node.status)}>{node.status}</Badge>
            <span className="text-on-surface truncate flex-1">{node.role}</span>
            {typeof node.cost_usd === 'number' && (
              <span className="text-on-surface-variant">${node.cost_usd.toFixed(4)}</span>
            )}
            {typeof node.duration_ms === 'number' && node.duration_ms > 0 && (
              <span className="text-on-surface-variant">
                {Math.round(node.duration_ms)}ms
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
