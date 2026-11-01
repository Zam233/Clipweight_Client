/**
 * 副驾驶容器（PRD §19.2 / 需求 8；2026-10-31 用户定稿）
 *
 * 右侧面板只有**一排**标签：
 * - `requirements` → 需求对话宿主（RequirementsPane，无自身标题行/标签）；
 * - `task-run`（固定 `trace`）→ 轨迹：事件流 + 右侧详情检查器，另含「日志」视图
 *   （原「执行日志」标签已撤删，能力并入这里）；
 * - `subagent` / `stage` / `workspace` / `docs` → F2–F4 逐步接入。
 *
 * 注意：Dock 只挂载当前激活标签的内容，SSE 订阅仍在各自的 store/provider 中，
 * 不在此处重复订阅。
 */
import React from 'react';
import { RequirementsPane } from '@/features/agent/AgentPanel';
import { WorkspaceMaterialsPanel } from '@/features/workspace/WorkspaceMaterialsPanel';
import { CopilotTabBar } from './CopilotTabBar';
import { CopilotTaskRunTab } from './CopilotTaskRunTab';
import { CopilotDocsTab } from './CopilotDocsTab';
import { CopilotArtifactTab } from './CopilotArtifactTab';
import { CopilotStageTab } from './CopilotStageTab';
import { CopilotSubagentTab } from './CopilotSubagentTab';
import { useCopilotStore } from '@/stores/copilotStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';

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
        return <RequirementsPane />;
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
      case 'artifact':
        return <CopilotArtifactTab path={String(active.payload?.path || '')} />;
      default:
        return <Placeholder title={active?.title ?? '未选择'} hint="该标签暂未接入。" />;
    }
  })();

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="copilot-dock">
      <CopilotTabBar />
      <div className="min-h-0 flex-1 overflow-auto" data-testid="copilot-body">
        {/* 局部兜底：某个标签的数据形状炸了，只坏这一个面板，别把整个编辑器带走。
            key 用标签 id —— 切标签会重置错误状态，换一个面板就能继续工作。 */}
        <ErrorBoundary key={active?.id ?? 'none'} region={active?.title ?? '副驾驶'}>
          {body}
        </ErrorBoundary>
      </div>
    </div>
  );
}

