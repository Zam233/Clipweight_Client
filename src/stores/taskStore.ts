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
function _foldPlan(task: Task, event: TaskEvent): Task | null {
  const detail = event.detail || {};
  const plan = task.plan;
  if (!plan) return null;

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
      for (const event of res.items) get().applyEvent(event);
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
        nextTask = {
          ...(nextTask as Task),
          status: String(event.detail?.reason || '') === 'plan_completed'
            ? 'done'
            : 'failed',
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
      await taskApi.resume(taskId);
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
