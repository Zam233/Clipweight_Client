/**
 * 任务 store（路线 C / C4）。
 *
 * 与 `agentStore` 的差别不是"换了个字段名"，而是**语义换了**：
 * - 没有 `phase`（阶段是管线时代的产物）；用户看到的是 plan 里的 step 列表。
 * - 事件流是唯一事实来源：`applyEvent` 把事件折进 `events`，plan/step 状态由事件推导，
 *   不再依赖后端额外推一份"当前阶段"。
 *
 * 有界：事件留最近 400 条（长任务上千条，全量渲染会卡）。
 */

import { create } from 'zustand';

import { taskApi } from '@/services/api/task';
// 复用同一份任务事件规整（含 causation_id 等 trace 信封字段），避免 hydration 丢线索
import { toTaskEvent } from '@/features/task/useTaskEvents';
import type { PlanStep, Task, TaskEvent, TaskListItem } from '@/types/task';

export const MAX_TASK_EVENTS = 400;

export interface TaskState {
  task: Task | null;
  events: TaskEvent[];
  lastSeq: number;
  list: TaskListItem[];
  loading: boolean;
  error: string;

  createTask: (body: Parameters<typeof taskApi.create>[0]) => Promise<Task | null>;
  load: (taskId: string) => Promise<void>;
  hydrateEvents: (taskId: string, sinceSeq?: number) => Promise<void>;
  applyEvent: (event: TaskEvent) => void;
  start: (taskId: string) => Promise<void>;
  pause: (taskId: string) => Promise<void>;
  resume: (taskId: string) => Promise<void>;
  cancel: (taskId: string) => Promise<void>;
  inject: (taskId: string, text: string) => Promise<void>;
  replan: (taskId: string) => Promise<void>;
  loadList: () => Promise<void>;
  reset: () => void;
}

const EMPTY = {
  task: null as Task | null,
  events: [] as TaskEvent[],
  lastSeq: 0,
  loading: false,
  error: '',
};

/** 事件 → plan/step 状态推导（前端不向"后端已算好的状态"二次确认，双份状态必然漂移）。 */
/** `task_end.detail.reason` → 前端 status（口径与后端 TaskFinish.reason 对齐）。 */
export function terminalStatusOf(reason: string): Task['status'] {
  const r = String(reason || '').trim();
  if (r === 'cancelled' || r === 'cancel') return 'cancelled';
  if (r === 'paused') return 'paused';
  // 成功：正式跑完 / 预览跑完（预览是"如实完成了一次预览"，不是失败）
  if (r === 'tool_loop_completed' || r === 'plan_completed'
      || r === 'dry_run_preview' || r === 'task_completed') return 'done';
  // 已知失败口径：触闸中止 / 循环报错 / provider 不可用 / 收尾守门没过 / 空原因
  if (r === '' || r.startsWith('gate:') || r.startsWith('step_failed')
      || r.startsWith('tool_loop_error') || r.startsWith('tool_loop_unavailable')
      || r === 'validation_failed' || r.includes('缺少可渲染时间线')) return 'failed';
  // Kernel 把未捕获异常的类型名当 reason（`TimeoutError` / `ValueError` …）
  if (/Error$|Exception$|Timeout$/.test(r)) return 'failed';
  // PRD B5：不认识的终态原因不再伪装成 failed——后端加了新 reason 时
  // UI 显示"后端终态：<reason>"，而不是让用户以为这一轮真的失败了。
  return 'unknown_terminal';
}

function _foldPlan(task: Task, event: TaskEvent): Task | null {
  const detail = event.detail || {};
  const plan = task.plan;
  if (!plan) return null;

  // PRD B6（2026-10-29 / G7）：主 agent 化之后 Plan 只是**初始假设**（后端
  // `hypothesis_only=true`，默认）。真实执行由 tool_loop 现场决定，步骤状态可能永远
  // 停在 pending；再用 step_*/tool_result 去改它，等于把"设想"渲染成"执行进度"。
  // 所以：假设态下只有 plan/replan（假设本身被改写）会更新，进度类事件一律不碰。
  const hypothesis = plan.hypothesis_only !== false;
  if (hypothesis && !['plan', 'replan'].includes(event.type)) return null;

  if (event.type === 'plan' && Array.isArray(detail.steps)) {
    return { ...task, plan: { ...plan, steps: detail.steps as PlanStep[] } };
  }
  if (event.type === 'replan' && Array.isArray(detail.steps)) {
    const added = detail.steps as PlanStep[];
    return {
      ...task,
      plan: { ...plan, version: plan.version + 1, steps: [...plan.steps, ...added] },
    };
  }
  const stepId = String(detail.step_id || '');
  if (!stepId) return null;
  const idx = plan.steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return null;
  const steps = [...plan.steps];
  const current = steps[idx];

  if (event.type === 'step_start') {
    steps[idx] = {
      ...current,
      status: 'running',
      attempt: Number(detail.attempt ?? current.attempt + 1),
    };
  } else if (event.type === 'tool_result') {
    const status = String(detail.status || 'error');
    steps[idx] = {
      ...current,
      status: status === 'ok' || status === 'dry_run' ? 'running' : 'failed',
      result_brief: String(detail.brief || ''),
      error: (detail.error as string | null) ?? null,
      duration_ms: Number(detail.duration_ms ?? 0),
    };
  } else if (event.type === 'step_end') {
    const status = String(detail.status || current.status);
    steps[idx] = {
      ...current,
      status: (status as typeof current.status) || 'done',
    };
  } else {
    return null;
  }
  return { ...task, plan: { ...plan, steps } };
}

export const useTaskStore = create<TaskState>((set, get) => ({
  list: [],
  ...EMPTY,

  createTask: async (body) => {
    set({ loading: true, error: '' });
    try {
      const res = await taskApi.create(body);
      set({ task: res.task, events: [], lastSeq: 0, loading: false });
      return res.task;
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  load: async (taskId) => {
    set({ loading: true, error: '' });
    try {
      const res = await taskApi.get(taskId);
      set({ task: res.task, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  hydrateEvents: async (taskId, sinceSeq = 0) => {
    try {
      const res = await taskApi.events(taskId, sinceSeq);
      for (const event of res.items) get().applyEvent(toTaskEvent(event) ?? event);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  applyEvent: (event) => {
    if (!event || typeof event.seq !== 'number' || typeof event.type !== 'string') return;
    if (event.seq <= get().lastSeq) return;      // 重连回放会重发，按 seq 去重
    const events = [...get().events, event].slice(-MAX_TASK_EVENTS);
    const task = get().task;
    let nextTask = task;
    if (task) {
      const folded = _foldPlan(task, event);
      nextTask = folded ?? task;
      if (event.type === 'task_end') {
        // 收尾口径（modern agent）：后端已不再用 plan_completed 这一个名字。
        // 现网会发 tool_loop_completed / dry_run_preview / cancelled / gate:* / tool_loop_error:*，
        // 只有"没跑成"的那几类才算失败——否则成功任务在 UI 上显示失败（P0）。
        nextTask = {
          ...(nextTask as Task),
          status: terminalStatusOf(String(event.detail?.reason || '')),
          finish: {
            conclusion: event.message,
            completed: (event.detail?.completed as string[]) || [],
            unfinished: (event.detail?.unfinished as string[]) || [],
            reason: String(event.detail?.reason || ''),
          },
        };
      } else if (event.type === 'gate_hit' && nextTask) {
        // 触闸不是失败，但用户需要立刻看到"为什么停了"
        nextTask = { ...(nextTask as Task) };
      }
    }
    set({ events, lastSeq: event.seq, task: nextTask });
  },

  start: async (taskId) => {
    try {
      await taskApi.resume(taskId);   // resume = 从当前检查点开跑（新任务等价于开跑）
      await get().load(taskId);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  pause: async (taskId) => {
    try {
      await taskApi.pause(taskId);
      await get().load(taskId);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  resume: async (taskId) => {
    try {
      const res = await taskApi.resume(taskId);
      // PRD B11：终态任务被后端拒绝（409 → refused）。这不是"网络错误"，
      // 而是明确结论——如实写进 error 让工具条/运行页都能显示，并且不重载状态。
      if (res?.refused) {
        set({ error: res.message || '任务已结束，无法继续' });
        return;
      }
      await get().load(taskId);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  cancel: async (taskId) => {
    try {
      await taskApi.cancel(taskId);
      await get().load(taskId);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  inject: async (taskId, text) => {
    try {
      await taskApi.inject(taskId, text);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  replan: async (taskId) => {
    try {
      const res = await taskApi.replan(taskId);
      set({ task: res.task });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadList: async () => {
    try {
      const res = await taskApi.list();
      set({ list: res.items });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  reset: () => set({ ...EMPTY, list: [] }),
}));
