/**
 * 阶段详情标签（PRD §19.10）：该阶段的报告卡（来自 docs/reports）+ 事件摘要。
 */
import React from 'react';
import { workspaceApi, type WorkspaceReport } from '@/services/api';

export function CopilotStageTab({ projectId, stage }: { projectId?: string; stage?: string }) {
  const [reports, setReports] = React.useState<WorkspaceReport[]>([]);
  const [content, setContent] = React.useState('');
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    if (!projectId || !stage) return undefined;
    const load = async () => {
      try {
        const res = await workspaceApi.reports(projectId, 200);
        if (!alive) return;
        setReports((res.reports ?? []).filter((r) => r.stage === stage));
      } catch (e) {
        if (alive) setNote(`加载失败：${String((e as Error)?.message || e)}`);
      }
    };
    void load();
    return () => { alive = false; };
  }, [projectId, stage]);

  if (!projectId || !stage) {
    return <div className="p-3 text-caption text-on-surface-variant">缺少阶段或项目标识。</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-3 text-caption" data-testid="stage-tab">
      <p className="mb-1 text-label-sm text-on-surface">阶段：{stage}</p>
      {note && <p className="text-error">{note}</p>}
      {reports.length === 0 && <p className="text-on-surface-variant">该阶段还没有报告（或未运行过）。</p>}
      <ul className="mb-2 space-y-1">
        {reports.map((r) => (
          <li key={r.seq}>
            <button
              type="button"
              className="text-left text-primary hover:underline"
              onClick={async () => {
                try {
                  const res = await workspaceApi.report(projectId, r.seq);
                  setContent(res.content);
                } catch (e) {
                  setContent(`读取失败：${String((e as Error)?.message || e)}`);
                }
              }}
            >
              #{r.seq} {r.status} — {r.headline}
            </button>
          </li>
        ))}
      </ul>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-surface-container p-2">
        {content}
      </pre>
    </div>
  );
}
