/**
 * `/api/requirements/proceed` 的返回处理（双轨：老管线 vs 主 Agent Task）。
 *
 * PRD docs/workspace-prd-2026-10-24.md §6.2：`agent_mode=on` 时后端返回
 * `task_id`（`pipeline_id` 字段保留兼容，值相同）。前端必须据此切换订阅源：
 * - Task → `/api/task/{id}/events/stream`，并跳 `/task/{id}` 看计划/步骤；
 * - 老管线 → 保持 `/api/pipeline/{id}/events`。
 *
 * 两个调用点（AgentPanel.confirmPlan / ReviewPanel.confirm）共用这里，避免
 * 各写一份、其中一份忘了带 task 分支（历史上就是这么漏的）。
 */

import { savePipelineId } from '@/services/storage/pipelineSession';
import { REQUIREMENTS_TAB, useCopilotStore } from '@/stores/copilotStore';
import { isSessionTimelineEnabled } from '@/features/sessionTimeline/flag';

export interface ProceedResultLike {
  pipeline_id?: string;
  task_id?: string;
  workspace_root?: string;
  mode?: string;
}

export type ProceedTarget = { mode: 'task'; id: string } | { mode: 'pipeline'; id: string };

const TASK_KEY = 'cw_task_id';
const WORKSPACE_KEY = 'cw_workspace_root';

export function applyProceedResult(res: ProceedResultLike | null | undefined): ProceedTarget | null {
  if (!res) return null;
  const taskId = String(res.task_id || '');
  if (taskId) {
    try {
      sessionStorage.setItem(TASK_KEY, taskId);
      if (res.workspace_root) sessionStorage.setItem(WORKSPACE_KEY, String(res.workspace_root));
    } catch {
      /* 隐私模式/配额满：不影响本次跳转 */
    }
    // 合流（2026-10-31 用户裁定）：默认**不**再开「轨迹」标签——任务事件已经进需求对话那条流。
    // 「轨迹」作为专业视图保留在 `+` 菜单里，需要深挖时手动开。
    try {
      if (isSessionTimelineEnabled()) {
        useCopilotStore.getState().openTab(REQUIREMENTS_TAB);
        useCopilotStore.getState().setActive(REQUIREMENTS_TAB.id);
      } else {
        useCopilotStore.getState().openTab({
          id: `task-run:${taskId}`,
          kind: 'task-run',
          title: '轨迹',
          closable: true,
          payload: { taskId },
        });
      }
    } catch {
      /* store 不可用（极端场景）不影响返回值 */
    }
    return { mode: 'task', id: taskId };
  }
  const pipelineId = String(res.pipeline_id || '');
  if (pipelineId) {
    savePipelineId(pipelineId);
    return { mode: 'pipeline', id: pipelineId };
  }
  return null;
}

export function storedTaskId(): string {
  try {
    return sessionStorage.getItem(TASK_KEY) || '';
  } catch {
    return '';
  }
}

export function storedWorkspaceRoot(): string {
  try {
    return sessionStorage.getItem(WORKSPACE_KEY) || '';
  } catch {
    return '';
  }
}
