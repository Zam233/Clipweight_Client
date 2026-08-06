// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { AgentPanel } from './AgentPanel';
import { useAgentStore } from '@/stores/agentStore';
import type { CreativeBrief } from '@/types/persona';

vi.mock('@/services/api', () => ({
  pipelineApi: {
    getTraceStreamUrl: (pid: string) => `http://localhost:8000/api/pipeline/${pid}/events`,
    getResult: vi.fn().mockRejectedValue(new Error('not found')),
  },
  requirementsApi: {
    init: vi.fn(),
    chat: vi.fn(),
    edit: vi.fn(),
    proceed: vi.fn(),
  },
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

const brief: CreativeBrief = {
  title: '独特简报标题XYZ',
  overview: '概述',
  target_audience: '受众',
  core_message: '核心信息',
  style_direction: '风格',
  structure_suggestion: '结构',
  duration_estimate: '时长',
  key_elements: [],
  special_requirements: [],
};

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  // jsdom 未实现 Element.scrollTo
  Element.prototype.scrollTo = vi.fn();
  localStorage.clear();
  sessionStorage.clear();
  useAgentStore.setState({
    pipelineId: null,
    phase: 'idle',
    progress: 0,
    error: null,
    logEntries: [],
    pipelineSummary: null,
    mgTotal: 0,
    mgDone: 0,
    agentTimeline: null,
    requirementsMessages: [],
    requirementsStatus: 'idle',
    requirementsSessionId: null,
    requirementsBusy: false,
    creativeBrief: null,
    productionPlan: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('U5: SSE reconnect cap', () => {
  it('stops reconnecting after 5 consecutive failures and shows disconnect banner', async () => {
    vi.useFakeTimers();
    try {
      useAgentStore.setState({ pipelineId: 'p1', phase: 'structure' });
      render(<AgentPanel />);

      // 初始挂接
      expect(MockEventSource.instances.length).toBe(1);

      // 连续 5 次断线：前 4 次会 3s 后重连，第 5 次判定断线
      for (let i = 0; i < 5; i++) {
        const es = MockEventSource.instances[MockEventSource.instances.length - 1];
        act(() => {
          es.onerror?.();
        });
        if (i < 4) {
          act(() => {
            vi.advanceTimersByTime(3000);
          });
        }
      }

      // 第 5 次失败后不再重连
      expect(MockEventSource.instances.length).toBe(5);
      act(() => {
        vi.advanceTimersByTime(30000);
      });
      expect(MockEventSource.instances.length).toBe(5);

      // 红色断线横幅
      expect(screen.getByText('连接已断开')).toBeTruthy();

      // 写入 error 日志
      const logs = useAgentStore.getState().logEntries;
      expect(
        logs.some((e) => e.type === 'error' && e.summary.includes('SSE 连接已断开')),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets retry counter on a successful onmessage', async () => {
    vi.useFakeTimers();
    try {
      useAgentStore.setState({ pipelineId: 'p1', phase: 'structure' });
      render(<AgentPanel />);

      // 4 次失败（逼近上限）
      for (let i = 0; i < 4; i++) {
        const es = MockEventSource.instances[MockEventSource.instances.length - 1];
        act(() => {
          es.onerror?.();
        });
        act(() => {
          vi.advanceTimersByTime(3000);
        });
      }
      expect(MockEventSource.instances.length).toBe(5);

      // 收到一条成功事件 → 计数清零
      const es = MockEventSource.instances[MockEventSource.instances.length - 1];
      act(() => {
        es.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'info', summary: 'ok' }) }));
      });

      // 再次失败 4 次：仍应继续重连（未达到 5 次连续失败）
      for (let i = 0; i < 4; i++) {
        const cur = MockEventSource.instances[MockEventSource.instances.length - 1];
        act(() => {
          cur.onerror?.();
        });
        act(() => {
          vi.advanceTimersByTime(3000);
        });
      }
      expect(MockEventSource.instances.length).toBe(9);
      expect(screen.queryByText('连接已断开')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('U11: pipeline auto-reconnect after refresh', () => {
  it('restores pipelineId from sessionStorage and opens SSE on mount', () => {
    sessionStorage.setItem('cw_pipeline_id', 'pid-xyz');
    // 刷新后 store 重置：无 pipelineId、phase 回落 idle
    useAgentStore.setState({ pipelineId: null, phase: 'idle' });

    render(<AgentPanel />);

    expect(useAgentStore.getState().pipelineId).toBe('pid-xyz');
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toContain('pid-xyz');
  });

  it('does not open SSE when no persisted pipelineId', () => {
    render(<AgentPanel />);
    expect(MockEventSource.instances.length).toBe(0);
  });
});

describe('U13: brief/plan card dedupe', () => {
  it('skips markdown body when message carries a creative_brief attachment', () => {
    useAgentStore.setState({
      requirementsStatus: 'brief_ready',
      requirementsMessages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '✅ 创作方案已完成\n\n标题：独特简报标题XYZ（正文内嵌重复内容）',
          timestamp: new Date().toISOString(),
          creative_brief: brief,
        },
      ],
    });

    render(<AgentPanel />);

    // 正文 markdown 不再渲染（内嵌的重复段落消失）
    expect(screen.queryByText(/创作方案已完成/)).toBeNull();
    expect(screen.queryByText(/正文内嵌重复内容/)).toBeNull();
    // 卡片仍然渲染
    expect(screen.getAllByText('独特简报标题XYZ').length).toBeGreaterThan(0);
    expect(screen.getByText('创意简报')).toBeTruthy();
  });

  it('still renders markdown body for assistant messages without attachments', () => {
    useAgentStore.setState({
      requirementsMessages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '这是普通回复内容ABC',
          timestamp: new Date().toISOString(),
        },
      ],
    });

    render(<AgentPanel />);
    expect(screen.getByText(/这是普通回复内容ABC/)).toBeTruthy();
  });
});
