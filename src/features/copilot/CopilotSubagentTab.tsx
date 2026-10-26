/**
 * 子 agent 详情标签（PRD §19.3）：从 supervisor 快照里取该 worker 的状态/成本/输出。
 */
import React from 'react';
import { supervisorApi } from '@/services/api';

interface Node {
  id: string;
  role?: string;
  status?: string;
  cost_usd?: number;
  duration_ms?: number;
  last_output?: string;
}

export function CopilotSubagentTab({ taskId, subagentId }: { taskId?: string; subagentId?: string }) {
  const [node, setNode] = React.useState<Node | null>(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    if (!taskId || !subagentId) return undefined;
    const load = async () => {
      try {
        const res = await supervisorApi.getSubagents(taskId);
        if (!alive) return;
        const list = ((res as { subagents?: Node[]; nodes?: Node[] }).subagents
          ?? (res as { nodes?: Node[] }).nodes ?? []) as Node[];
        setNode(list.find((n) => n.id === subagentId) ?? null);
      } catch (e) {
        if (alive) setError(String((e as Error)?.message || e));
      }
    };
    void load();
    return () => { alive = false; };
  }, [taskId, subagentId]);

  if (!taskId || !subagentId) {
    return <div className="p-3 text-caption text-on-surface-variant">缺少子 agent 标识。</div>;
  }
  if (error) return <div className="p-3 text-caption text-error">加载失败：{error}</div>;
  if (!node) return <div className="p-3 text-caption text-on-surface-variant">子 agent 已结束或不存在。</div>;

  return (
    <div className="space-y-2 p-3 text-caption" data-testid="subagent-tab">
      <p className="text-label-sm text-on-surface">{node.role || node.id}</p>
      <dl className="grid grid-cols-[80px_1fr] gap-1 text-on-surface-variant">
        <dt>状态</dt><dd className="text-on-surface">{node.status || '—'}</dd>
        <dt>成本</dt><dd className="text-on-surface">{node.cost_usd == null ? '未知' : `$${node.cost_usd}`}</dd>
        <dt>耗时</dt><dd className="text-on-surface">{node.duration_ms ? `${node.duration_ms}ms` : '—'}</dd>
      </dl>
      {node.last_output && (
        <>
          <p className="text-on-surface-variant/70">输出结论</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-cw-sm bg-surface-container p-2">
            {node.last_output}
          </pre>
        </>
      )}
    </div>
  );
}
