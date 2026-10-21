/**
 * 调度中枢的 SSE 增量接线（F1 实时段）。
 *
 * 设计取舍：**不新开一条 SSE 流**。后端把调度事件（ledger_entry / attribution /
 * diag_report / dispatch / subagent_* / exec）写进同一条管线 trace 流
 * （`services/trace.add_event`），前端再按 `type` 分流即可——两条流会让重连语义、
 * 鉴权 token、终态判定全部翻倍。
 *
 * 事件体形状：trace 事件是 `{seq, agent, type, level, message, detail}`，
 * 而 store 的 `applyEvent` 吃 `{type, data}`——所以这里做一次 `detail → data` 的搬运。
 *
 * 纪律：只旁听，不发请求；hydrate 负责首屏全量，本 hook 只补增量。
 */

import { useEffect } from 'react';

import { pipelineApi } from '@/services/api/pipeline';
import { connectSseStream } from '@/services/api/sseStream';
import { useSupervisorStore } from '@/stores/supervisorStore';

/** 调度中枢关心的 trace 事件类型（其余类型交给 AgentPanel 的日志流） */
export const SUPERVISOR_EVENT_TYPES = [
  'ledger_entry',
  'attribution',
  'diag_report',
  'dispatch',
  'subagent_start',
  'subagent_progress',
  'subagent_end',
  'exec',
] as const;

export type SupervisorEventType = (typeof SUPERVISOR_EVENT_TYPES)[number];

const _KNOWN: ReadonlySet<string> = new Set<string>(SUPERVISOR_EVENT_TYPES);

export function isSupervisorEventType(type: unknown): type is SupervisorEventType {
  return typeof type === 'string' && _KNOWN.has(type);
}

/**
 * 把一条 trace 事件转成 store 认识的 `{type, data}`；不关心的事件返回 null。
 * 导出以便单测（无需渲染组件）。
 */
export function toSupervisorEvent(
  raw: unknown,
): { type: SupervisorEventType; data: unknown } | null {
  if (!raw || typeof raw !== 'object') return null;
  const ev = raw as { type?: unknown; detail?: unknown; data?: unknown };
  if (!isSupervisorEventType(ev.type)) return null;
  // 真实 trace 事件用 detail；兼容 `{type, data}` 形状（测试/未来后端统一时）
  const data = ev.detail !== undefined && ev.detail !== null ? ev.detail : ev.data;
  return { type: ev.type, data };
}

/**
 * 订阅某条管线的调度增量事件。
 *
 * @param pipelineId 当前管线；为空时不连
 * @param enabled 关闭时立刻断开（抽屉没必要常驻订阅时可用）
 */
export function useSupervisorEvents(pipelineId: string | null, enabled = true): void {
  const applyEvent = useSupervisorStore((s) => s.applyEvent);

  useEffect(() => {
    if (!pipelineId || !enabled) return;
    const handle = connectSseStream({
      url: pipelineApi.getTraceStreamUrl(pipelineId),
      onMessage: (raw) => {
        const ev = toSupervisorEvent(raw);
        if (ev) applyEvent({ type: ev.type, data: ev.data });
      },
    });
    return () => handle.close();
    // applyEvent 是 zustand 稳定引用，但仍列入依赖以防 store 被重建
  }, [pipelineId, enabled, applyEvent]);
}
