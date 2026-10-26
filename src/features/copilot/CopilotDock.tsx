/**
 * 副驾驶容器（PRD §19.2 / 需求 8、9）
 *
 * 右侧面板从"直接渲染 AgentPanel"改成"标签容器"：
 * - `requirements` → 复用现有 AgentPanel（内部不改，降低回归面）；
 * - `task-run` / `subagent` / `stage` / `workspace` / `docs` → F2–F4 逐步接入，
 *   现在明确显示"待接入"，**不假装已经能用**。
 */
import React from 'react';
import { AgentPanel } from '@/features/agent/AgentPanel';
import { WorkspaceMaterialsPanel } from '@/features/workspace/WorkspaceMaterialsPanel';
import { CopilotTabBar } from './CopilotTabBar';
import { CopilotTaskRunTab } from './CopilotTaskRunTab';
import { CopilotDocsTab } from './CopilotDocsTab';
import { CopilotStageTab } from './CopilotStageTab';
import { CopilotSubagentTab } from './CopilotSubagentTab';
import { useCopilotStore } from '@/stores/copilotStore';

function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="p-3 text-caption text-on-surface-variant">
      <p className="mb-1 text-label-sm text-on-surface">{title}</p>
      <p>{hint}</p>
    </div>
  );
}

export function CopilotDock() {
  const tabs = useCopilotStore((s) => s.tabs);
  const activeId = useCopilotStore((s) => s.activeId);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const body = (() => {
    switch (active?.kind) {
      case 'requirements':
        return <AgentPanel />;
      case 'workspace':
        return active.payload?.projectId ? (
          <WorkspaceMaterialsPanel projectId={active.payload.projectId} compact />
        ) : (
          <Placeholder title="工作区" hint="尚未绑定项目：从「新建制作 → 04 工作区」进入，或打开一个项目。" />
        );
      case 'task-run':
        return <CopilotTaskRunTab taskId={String(active.payload?.taskId || '')} />;
      case 'subagent':
        return (
          <CopilotSubagentTab
            taskId={active.payload?.taskId}
            subagentId={active.payload?.subagentId}
          />
        );
      case 'stage':
        return (
          <CopilotStageTab
            projectId={active.payload?.projectId}
            stage={active.payload?.stage}
          />
        );
      case 'docs':
        return <CopilotDocsTab projectId={String(active.payload?.projectId || '')} />;
      default:
        return <Placeholder title={active?.title ?? '未选择'} hint="该标签暂未接入。" />;
    }
  })();

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="copilot-dock">
      <CopilotTabBar />
      <div className="min-h-0 flex-1 overflow-auto" data-testid="copilot-body">
        {body}
      </div>
    </div>
  );
}
