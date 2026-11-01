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
/**
 * 子 Agent 生命周期事件单独保留（start/update/end）。
 *
 * 原始事件只留最近 400 条，长跑阶段能把 `agent_run_start` 挤出窗口——
 * RunningSubagents 随后会认为“没有在跑的子 agent”，chip 凭空消失。
 * 生命周期与原始日志的生命周期不同，必须单独有界存放。
 */
export const MAX_RUN_EVENTS = 600;

export interface TaskState {
  task: Task | null;
  /**
   * 当前选中的任务 id。它先于 `task` 生效：切换任务时立刻改写，
   * 用来挡住上一个任务尚未完成的请求/SSE 回调（否则旧响应会污染新任务）。
   */
  activeTaskId: string;
  events: TaskEvent[];
  /** 只含 agent_run_* 的长期窗口（不受 MAX_TASK_EVENTS 裁剪） */
  runEvents: TaskEvent[];
  lastSeq: number;
  /** 当前窗口里最小的 seq；用来判断"还能不能往上翻" */
  oldestLoadedSeq: number;
  /** 服务端是否还有更早的事件 */
  hasEarlierEvents: boolean;
  /** 事件序号缺口（服务端这段读不到，例如 spilled 文件丢了） */
  seqGap: { from: number; to: number } | null;
  list: TaskListItem[];
  loading: boolean;
  error: string;

  createTask: (body: Parameters<typeof taskApi.create>[0]) => Promise<Task | null>;
  load: (taskId: string) => Promise<void>;
  /** 拉一段历史（订阅 SSE 前先水合；断线时也用它补段） */
  hydrateEvents: (
    taskId: string,
    opts?: number | { sinceSeq?: number; beforeSeq?: number; limit?: number },
  ) => Promise<void>;
  /** 往前翻一页历史（M3） */
  loadEarlierEvents: (taskId: string, limit?: number) => Promise<void>;
  applyEvent: (event: TaskEvent, forTaskId?: string) => void;
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
  activeTaskId: '',
  events: [] as TaskEvent[],
  runEvents: [] as TaskEvent[],
  lastSeq: 0,
  // M3：恢复元数据也要随 reset 归零，否则切任务/重进会把上一个任务的历史范围带过来
  oldestLoadedSeq: 0,
  hasEarlierEvents: false,
  seqGap: null,
  loading: false,
  error: '',
};

/**
 * 任务代际。每次切任务/重置自增，异步请求返回时据此丢弃过期结果。
 * 单靠 taskId 不够：同一任务快速 re-load 也会产生两条竞态响应。
 */
let _taskEpoch = 0;

/** 事件 → plan/step 状态推导（前端不向"后端已算好的状态"二次确认，双份状态必然漂移）。 */
/** `task_end.detail.reason` → 前端 status（口径与后端 TaskFinish.reason 对齐）。 */
export function terminalStatusOf(reason: string): Task['status'] {
  const r = String(reason || '').trim();
  if (r === 'cancelled' || r === 'cancel') return 'cancelled';
  if (r === 'paused') return 'paused';
  // 成功：正式跑完 / 预览跑完（预览是"如实完成了一次预览"，不是失败）
  if (r === 'tool_loop_completed' || r === 'plan_completed'
      || r === 'dry_run_preview' || r === 'plan_only_completed'
      || r === 'task_completed') return 'done';
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
    const epoch = ++_taskEpoch;
    set({ loading: true, error: '' });
    try {
      const res = await taskApi.create(body);
      if (epoch !== _taskEpoch) return null;
      set({
        task: res.task,
        activeTaskId: res.task.id,
        events: [],
        runEvents: [],
        lastSeq: 0,
        oldestLoadedSeq: 0,
        hasEarlierEvents: false,
        seqGap: null,
        loading: false,
      });
      return res.task;
    } catch (e) {
      if (epoch !== _taskEpoch) return null;
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  load: async (taskId) => {
    const id = String(taskId || '');
    if (!id) return;
    const switching = get().activeTaskId !== id;
    const epoch = ++_taskEpoch;
    set({
      loading: true,
      error: '',
      activeTaskId: id,
      // 切任务必须原子清空事件游标。seq 只在单个任务内单调，拿旧任务的 lastSeq
      // 给新任务去重会把新任务的前 N 条事件整段吞掉。
      ...(switching
        ? {
          task: null,
          events: [],
          runEvents: [],
          lastSeq: 0,
          oldestLoadedSeq: 0,
          hasEarlierEvents: false,
          seqGap: null,
        }
        : {}),
    });
    try {
      const res = await taskApi.get(id);
      if (epoch !== _taskEpoch || get().activeTaskId !== id) return;
      set({ task: res.task, loading: false });
    } catch (e) {
      if (epoch !== _taskEpoch || get().activeTaskId !== id) return;
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  /**
   * 拉一段历史事件（M3：订阅 SSE **之前**先水合，断线时也用它补段）。
   *
   * `sinceSeq` 语义 = 只要 seq 大于它的事件；入栈走 `applyEvent`（自带 seq 去重）。
   * 缺口判定：返回里第一条的 seq 比"期望的下一个"大，说明中间一段服务端读不到
   * （例如 spilled 文件丢了）——记 `seqGap`，UI 明说，不假装完整。
   */
  hydrateEvents: async (taskId, opts = {}) => {
    const cfg = typeof opts === 'number' ? { sinceSeq: opts } : opts;
    const sinceSeq = cfg.sinceSeq ?? 0;
    const current = get().activeTaskId;
    if (current && current !== taskId) return;   // 已经在看别的任务：这段历史不属于它
    if (!current) set({ activeTaskId: taskId });
    const epoch = _taskEpoch;
    try {
      const res = await taskApi.events(taskId, {
        sinceSeq,
        beforeSeq: cfg.beforeSeq,
        limit: cfg.limit,
      });
      // 请求期间可能已切任务/re-load：过期响应绝不能写进当前窗口。
      if (epoch !== _taskEpoch || get().activeTaskId !== taskId) return;
      const items = res.items ?? [];
      let expected = sinceSeq + 1;
      let gap: { from: number; to: number } | null = null;
      for (const raw of items) {
        const event = toTaskEvent(raw) ?? (raw as TaskEvent);
        if (typeof event.seq === 'number' && event.seq > expected && !gap) {
          gap = { from: expected, to: event.seq - 1 };
        }
        if (typeof event.seq === 'number') expected = Math.max(expected, event.seq + 1);
        get().applyEvent(event, taskId);
      }
      const seqs = items.map((e) => e.seq).filter((n) => typeof n === 'number');
      const oldest = seqs.length ? Math.min(...seqs) : 0;
      set({
        oldestLoadedSeq: oldest || get().oldestLoadedSeq,
        hasEarlierEvents: Boolean(res.has_more)
          || (oldest > 0 && Number(res.oldest_available_seq ?? 0) > 0
            && Number(res.oldest_available_seq) < oldest),
        seqGap: gap ?? get().seqGap,
      });
    } catch (e) {
      if (epoch !== _taskEpoch || get().activeTaskId !== taskId) return;
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadEarlierEvents: async (taskId, limit = 200) => {
    if (get().activeTaskId !== taskId) return;
    const before = get().oldestLoadedSeq;
    if (!before || before <= 1) {
      set({ hasEarlierEvents: false });
      return;
    }
    const epoch = _taskEpoch;
    try {
      const res = await taskApi.events(taskId, { beforeSeq: before, limit });
      if (epoch !== _taskEpoch || get().activeTaskId !== taskId) return;
      const items = (res.items ?? []).map((raw) => toTaskEvent(raw) ?? (raw as TaskEvent));
      if (!items.length) {
        set({ hasEarlierEvents: false });
        return;
      }
      set((state) => {
        const merged = new Map<number, TaskEvent>();
        for (const e of [...items, ...state.events]) merged.set(e.seq, e);
        const ordered = [...merged.values()].sort((a, b) => a.seq - b.seq);
        return {
          events: ordered,
          oldestLoadedSeq: ordered.length ? ordered[0].seq : state.oldestLoadedSeq,
          hasEarlierEvents: Boolean(res.has_more),
        };
      });
    } catch (e) {
      if (epoch !== _taskEpoch || get().activeTaskId !== taskId) return;
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  applyEvent: (event, forTaskId) => {
    if (!event || typeof event.seq !== 'number' || typeof event.type !== 'string') return;
    // SSE 回调带着它订阅的 taskId；切任务后旧流再吐出的事件必须丢弃。
    if (forTaskId && get().activeTaskId !== forTaskId) return;
    if (event.seq <= get().lastSeq) return;      // 重连回放会重发，按 seq 去重
    const events = [...get().events, event].slice(-MAX_TASK_EVENTS);
    const runEvents = event.type.startsWith('agent_run_')
      ? [...get().runEvents, event].slice(-MAX_RUN_EVENTS)
      : get().runEvents;
    const task = get().task;
    let nextTask = task;
    if (task) {
      const folded = _foldPlan(task, event);
      nextTask = folded ?? task;
      if (event.type === 'task_end') {
        // 收尾口径（modern agent）：后端已不再用 plan_completed 这一个名字。
        // 现网会发 tool_loop_completed / dry_run_preview / plan_only_completed /
        // cancelled / gate:* / tool_loop_error:*；只有"没跑成"的那几类才算失败。
        const detail = event.detail || {};
        const prevFinish = (nextTask as Task).finish;
        nextTask = {
          ...(nextTask as Task),
          status: terminalStatusOf(String(detail.reason || '')),
          finish: {
            // 字段缺省时保留已有收尾信息，不能用空数组把后端刚写好的未完成项抹掉。
            conclusion: event.message || prevFinish?.conclusion || '',
            completed: Array.isArray(detail.completed)
              ? (detail.completed as string[])
              : (prevFinish?.completed ?? []),
            unfinished: Array.isArray(detail.unfinished)
              ? (detail.unfinished as string[])
              : (prevFinish?.unfinished ?? []),
            reason: String(detail.reason || prevFinish?.reason || ''),
          },
        };
      } else if (event.type === 'gate_hit' && nextTask) {
        // 触闸不是失败，但用户需要立刻看到"为什么停了"
        nextTask = { ...(nextTask as Task) };
      }
    }
    set({ events, runEvents, lastSeq: event.seq, task: nextTask });
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

  reset: () => {
    _taskEpoch += 1;
    set({ ...EMPTY, list: [] });
  },
}));
