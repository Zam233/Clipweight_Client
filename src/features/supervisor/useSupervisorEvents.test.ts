// @vitest-environment jsdom
/**
 * 调度中枢 SSE 接线（F1 实时段）。
 *
 * 只测两件真会坏的事：
 * 1. trace 事件 `{type, detail}` → store `{type, data}` 的映射（含分流与脏数据）；
 * 2. 开关与管线切换时正确关闭旧连接（漏关会累积 EventSource）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { stream, streamUrl } = vi.hoisted(() => ({
  stream: {
    onMessage: null as null | ((data: unknown) => void),
    close: vi.fn(),
    reconnect: vi.fn(),
  },
  streamUrl: vi.fn((pid: string) => `http://localhost:8000/api/pipeline/trace/stream/${pid}`),
}));

vi.mock('@/services/api/sseStream', () => ({
  connectSseStream: vi.fn((opts: { onMessage: (d: unknown) => void }) => {
    stream.onMessage = opts.onMessage;
    return { close: stream.close, reconnect: stream.reconnect };
  }),
}));

vi.mock('@/services/api/pipeline', () => ({
  pipelineApi: { getTraceStreamUrl: streamUrl },
}));

import { connectSseStream } from '@/services/api/sseStream';
import { useSupervisorStore } from '@/stores/supervisorStore';

import { isSupervisorEventType, toSupervisorEvent, useSupervisorEvents } from './useSupervisorEvents';

function ledgerEntry() {
  return {
    id: 'le_1',
    stage: 'edit',
    attempt: 1,
    decision: 'pass',
    degradations: [],
    warnings: [],
    duration_ms: 5,
    ts: '2026-10-17T10:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stream.onMessage = null;
  useSupervisorStore.getState().reset();
});

afterEach(() => {
  stream.onMessage = null;
});

describe('事件分流', () => {
  it('识别调度事件类型', () => {
    expect(isSupervisorEventType('ledger_entry')).toBe(true);
    expect(isSupervisorEventType('subagent_progress')).toBe(true);
    expect(isSupervisorEventType('exec')).toBe(true);
    expect(isSupervisorEventType('tool')).toBe(false);
    expect(isSupervisorEventType(undefined)).toBe(false);
  });

  it('把 trace 的 detail 搬到 data', () => {
    const ev = toSupervisorEvent({ type: 'diag_report', detail: { conclusion: '素材缺失' } });
    expect(ev).toEqual({ type: 'diag_report', data: { conclusion: '素材缺失' } });
  });

  it('非调度类型与脏数据返回 null', () => {
    expect(toSupervisorEvent({ type: 'timeline_snapshot', detail: {} })).toBeNull();
    expect(toSupervisorEvent({ type: 'info', message: 'x' })).toBeNull();
    expect(toSupervisorEvent(null)).toBeNull();
    expect(toSupervisorEvent('str')).toBeNull();
  });
});

describe('useSupervisorEvents', () => {
  it('订阅 trace 流并把事件喂给 store', () => {
    renderHook(() => useSupervisorEvents('pl_1', true));

    expect(streamUrl).toHaveBeenCalledWith('pl_1');
    expect(connectSseStream).toHaveBeenCalledTimes(1);

    stream.onMessage?.({ type: 'ledger_entry', detail: ledgerEntry() });
    expect(useSupervisorStore.getState().ledger).toHaveLength(1);

    // 无关事件不污染状态
    stream.onMessage?.({ type: 'tool', detail: { tool: 'ffmpeg' } });
    expect(useSupervisorStore.getState().ledger).toHaveLength(1);
  });

  it('pipelineId 为空或 enabled=false 时不连', () => {
    renderHook(() => useSupervisorEvents(null, true));
    renderHook(() => useSupervisorEvents('pl_2', false));
    expect(connectSseStream).not.toHaveBeenCalled();
  });

  it('卸载与关闭时断开连接', () => {
    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useSupervisorEvents('pl_3', enabled),
      { initialProps: { enabled: true } },
    );
    expect(connectSseStream).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    expect(stream.close).toHaveBeenCalledTimes(1);

    rerender({ enabled: true });
    unmount();
    expect(stream.close).toHaveBeenCalledTimes(2);
  });
});
