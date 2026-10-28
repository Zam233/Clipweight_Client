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
import { useCopilotStore } from '@/stores/copilotStore';

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
    // PRD §19.3：不跳 /task/{id}——在编辑器右侧"任务运行"标签里就地跑。
    // 标签可复用（同任务已开则聚焦），调用方拿到 mode:'task' 后**不要再 navigate**。
    try {
      useCopilotStore.getState().openTab({
        id: `task-run:${taskId}`,
        kind: 'task-run',
        title: '任务运行',
        closable: true,
        payload: { taskId },
      });
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
