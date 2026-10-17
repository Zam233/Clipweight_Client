// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AgentPanel } from './AgentPanel';
import { useAgentStore } from '@/stores/agentStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { createDefaultClip } from '@/types/timeline';
import { pipelineApi } from '@/services/api';
import type { CreativeBrief } from '@/types/persona';

vi.mock('@/pages/useBackendHealth', () => ({
  useBackendHealth: () => 'online',
}));

vi.mock('@/services/api', () => ({
  healthApi: { check: vi.fn().mockResolvedValue({ status: 'ok' }) },
  pipelineApi: {
    getTraceStreamUrl: (pid: string) => `http://localhost:8000/api/pipeline/${pid}/events`,
    getResult: vi.fn().mockRejectedValue(new Error('not found')),
    cancel: vi.fn().mockResolvedValue({}),
  },
  requirementsApi: {
    init: vi.fn(),
    chat: vi.fn(),
    edit: vi.fn(),
    proceed: vi.fn(),
    // R6：默认返回空（无问题、未 blocked）→ 行为等价于旧路径，不改变既有用例
    intent: vi.fn().mockResolvedValue({ intent: '', resolution: {}, problems: [] }),
    intentApply: vi.fn().mockResolvedValue({ applied: false, blocked: true, report: { problems: [] }, problems: [] }),
    upload: vi.fn().mockResolvedValue({ file_name: 'ref.txt', content_preview: 'x' }),
  },
  personaApi: {
    listIds: vi.fn().mockResolvedValue([]), // M13
    list: vi.fn().mockResolvedValue([]),
  },
}));

// P0-9/10: SSE 挂接异步化——测试环境直接返回空 token（开放模式语义）
vi.mock('@/services/api/sse', () => ({
  fetchSseToken: async () => '',
  withSseToken: (url: string) => url,
  apiBase: () => 'http://localhost:8000',
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
    cancelling: false,
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
  // M13: personaApi.listIds 等工厂级 vi.fn() 实现必须在测试间保留——
  // restoreAllMocks 会把实现清成 undefined，导致后续挂载 .then 崩溃。
  vi.clearAllMocks();
});

describe('U5: SSE reconnect cap', () => {
  it('stops reconnecting after 5 consecutive failures and shows disconnect banner', async () => {
    vi.useFakeTimers();
    try {
      useAgentStore.setState({ pipelineId: 'p1', phase: 'structure' });
      render(<AgentPanel />);
      await act(async () => {}); // flush SSE 挂接（P0-9 后异步取 token）

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
          await act(async () => {}); // flush token 微任务后完成 SSE 重挂接
        }
      }

      // 第 5 次失败后不再重连
      expect(MockEventSource.instances.length).toBe(5);
      act(() => {
        vi.advanceTimersByTime(30000);
      });
      expect(MockEventSource.instances.length).toBe(5);
      // B2: 最后一个实例已显式 close（不依赖原生自动重连）
      expect(MockEventSource.instances[4].closed).toBe(true);

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
      await act(async () => {}); // flush SSE 挂接（P0-9 后异步取 token）

      // 4 次失败（逼近上限）
      for (let i = 0; i < 4; i++) {
        const es = MockEventSource.instances[MockEventSource.instances.length - 1];
        act(() => {
          es.onerror?.();
        });
        act(() => {
          vi.advanceTimersByTime(3000);
        });
        await act(async () => {}); // flush token 微任务后完成 SSE 重挂接
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
        await act(async () => {}); // flush token 微任务后完成 SSE 重挂接
      }
      expect(MockEventSource.instances.length).toBe(9);
      expect(screen.queryByText('连接已断开')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('U11: pipeline auto-reconnect after refresh', () => {
  it('restores pipelineId from sessionStorage and opens SSE on mount', async () => {
    sessionStorage.setItem('cw_pipeline_id', 'pid-xyz');
    // 刷新后 store 重置：无 pipelineId、phase 回落 idle
    useAgentStore.setState({ pipelineId: null, phase: 'idle' });

    render(<AgentPanel />);
    await act(async () => {}); // flush SSE 挂接

    expect(useAgentStore.getState().pipelineId).toBe('pid-xyz');
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toContain('pid-xyz');
  });

  it('does not open SSE when no persisted pipelineId', () => {
    render(<AgentPanel />);
    expect(MockEventSource.instances.length).toBe(0);
  });
});

describe('B17: reset requirements status on pipeline finish', () => {
  it('SSE done 事件后 store.status 复位为 pipeline_done 且输入框恢复', async () => {
    useAgentStore.setState({
      pipelineId: 'p1',
      phase: 'structure',
      requirementsStatus: 'pipeline_running',
      requirementsSessionId: 'req_1',
      requirementsMessages: [
        { id: 'm1', role: 'user', content: '选题', timestamp: new Date().toISOString() },
        { id: 'm2', role: 'assistant', content: '方案已确认', timestamp: new Date().toISOString() },
      ],
    });
    render(<AgentPanel />);
    await act(async () => {}); // flush SSE 挂接
    expect(MockEventSource.instances.length).toBe(1);

    // 模拟管线完成事件
    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'done' }) }));
    });

    await act(async () => { await Promise.resolve(); });

    expect(useAgentStore.getState().requirementsStatus).toBe('pipeline_done');
    // 输入区恢复：发送按钮/输入框存在
    expect(screen.getByPlaceholderText(/继续与需求 Agent 对话/)).toBeTruthy();
  });

  it('轮70：成功终态清除上一轮失败残留的错误横幅', async () => {
    useAgentStore.setState({
      pipelineId: 'p1',
      phase: 'structure',
      requirementsStatus: 'pipeline_running',
      requirementsSessionId: 'req_1',
      error: '上一轮失败：渲染错误',
      requirementsMessages: [
        { id: 'm1', role: 'user', content: '选题', timestamp: new Date().toISOString() },
      ],
    });
    render(<AgentPanel />);
    await act(async () => {});

    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'done' }) }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(useAgentStore.getState().error).toBeNull();
  });

  it('SSE error 事件为非终态：仅记录警告建议，不判失败（终态由 done/timeout 决定）', async () => {
    useAgentStore.setState({
      pipelineId: 'p2',
      phase: 'structure',
      requirementsStatus: 'pipeline_running',
      requirementsMessages: [
        { id: 'm1', role: 'user', content: '选题', timestamp: new Date().toISOString() },
      ],
    });
    render(<AgentPanel />);
    await act(async () => {}); // flush SSE 挂接
    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'error', error: 'boom' }) }));
    });

    await act(async () => { await Promise.resolve(); });

    // 批B：error 事件不再判终态失败——熔断跳过/自愈重做异常时管线仍继续，
    // 终态由 done（按 result.status 判定）/ cancelled / timeout 决定
    expect(useAgentStore.getState().requirementsStatus).toBe('pipeline_running');
    expect(useAgentStore.getState().phase).toBe('structure');
    const suggestions = useAgentStore.getState().suggestions;
    expect(suggestions.some((s) => s.message.includes('boom'))).toBe(true);
    // 运行态输入框隐藏（既有设计：pipeline_running 时输入区让位给进度条）；
    // 非终态错误不中断管线，也不把会话打成 error
    expect(screen.queryByPlaceholderText(/继续与需求 Agent 对话/)).toBeNull();
  });
});

describe('G7: reference file upload', () => {
  it('上传成功后添加"已上传"系统消息', async () => {
    useAgentStore.setState({
      requirementsSessionId: 'req_1',
      requirementsMessages: [
        { id: 'm1', role: 'user', content: '选题', timestamp: new Date().toISOString() },
        { id: 'm2', role: 'assistant', content: '回复', timestamp: new Date().toISOString() },
      ],
    });
    render(<AgentPanel />);

    const file = new File(['内容'], 'ref.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const msgs = useAgentStore.getState().requirementsMessages;
      expect(msgs.some((m) => m.content.includes('已上传 ref.txt'))).toBe(true);
    });
  });

  it('无会话时提示先开始会话', async () => {
    useAgentStore.setState({
      requirementsSessionId: null,
      requirementsMessages: [
        { id: 'm1', role: 'user', content: '选题', timestamp: new Date().toISOString() },
        { id: 'm2', role: 'assistant', content: '回复', timestamp: new Date().toISOString() },
      ],
    });
    render(<AgentPanel />);

    const file = new File(['内容'], 'ref.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const msgs = useAgentStore.getState().requirementsMessages;
      expect(msgs.some((m) => m.content.includes('请先开始需求会话'))).toBe(true);
    });
  });
});

describe('G4: current agent activity in bottom bar', () => {
  it('运行时显示最新非 system 日志条目活动', async () => {
    useAgentStore.setState({
      pipelineId: 'p1',
      phase: 'animation',
      logEntries: [
        { id: 'l1', timestamp: Date.now(), agent: 'system', type: 'info', summary: '执行组' },
        { id: 'l2', timestamp: Date.now(), agent: 'animation', type: 'llm', summary: 'LLM MG 生成…' },
      ],
    });
    render(<AgentPanel />);
    expect(screen.getByText(/animation · LLM MG 生成/)).toBeTruthy();
  });

  it('无日志时回退相位名', async () => {
    useAgentStore.setState({
      pipelineId: 'p1',
      phase: 'structure',
      logEntries: [{ id: 'l1', timestamp: Date.now(), agent: 'system', type: 'info', summary: 'start' }],
    });
    render(<AgentPanel />);
    // 仅 system 日志 → 回退相位标签
    expect(screen.getByText(/当前：/)).toBeTruthy();
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

describe('G2: pipeline cancel', () => {
  it('renders stop button when running, disabled while cancelling', () => {
    useAgentStore.setState({ pipelineId: 'p1', phase: 'structure', cancelling: false });
    render(<AgentPanel />);

    expect(screen.getByText('停止')).toBeTruthy();

    // cancelling: true → 按钮禁用且文案切换
    act(() => {
      useAgentStore.setState({ cancelling: true });
    });
    const btn = screen.getByText('取消中…') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('clicking stop calls pipelineApi.cancel with the pipelineId', async () => {
    useAgentStore.setState({ pipelineId: 'p1', phase: 'structure', cancelling: false });
    const cancel = vi.mocked(pipelineApi.cancel).mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true); // 批B：取消前确认
    render(<AgentPanel />);

    fireEvent.click(screen.getByText('停止'));

    expect(cancel).toHaveBeenCalledWith('p1');
  });

  it('cancel failure logs error and keeps SSE open', async () => {
    useAgentStore.setState({ pipelineId: 'p1', phase: 'structure', cancelling: false });
    vi.mocked(pipelineApi.cancel).mockRejectedValue(new Error('boom'));
    vi.spyOn(window, 'confirm').mockReturnValue(true); // 批B：取消前确认
    render(<AgentPanel />);
    await act(async () => {}); // flush SSE 挂接
    expect(MockEventSource.instances.length).toBe(1);

    fireEvent.click(screen.getByText('停止'));
    await act(async () => { await Promise.resolve(); });

    const logs = useAgentStore.getState().logEntries;
    expect(logs.some((e) => e.type === 'error' && e.summary.includes('取消失败'))).toBe(true);
    // 取消请求失败 → 不关闭 SSE，继续追踪管线
    expect(MockEventSource.instances[0].closed).toBe(false);
  });

  it('SSE cancelled event → phase failed, requirements error, SSE closed, sessionStorage cleared', async () => {
    useAgentStore.setState({ pipelineId: 'p1', phase: 'structure', cancelling: false });
    sessionStorage.setItem('cw_pipeline_id', 'p1');
    render(<AgentPanel />);
    await act(async () => {}); // flush SSE 挂接
    expect(MockEventSource.instances.length).toBe(1);

    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'cancelled', summary: '管线已取消' }) }));
    });
    await act(async () => { await Promise.resolve(); });

    expect(useAgentStore.getState().phase).toBe('failed');
    expect(useAgentStore.getState().requirementsStatus).toBe('error');
    expect(es.closed).toBe(true);
    expect(sessionStorage.getItem('cw_pipeline_id')).toBeNull();
    const logs = useAgentStore.getState().logEntries;
    // 批B：取消为中性结果 → info 级日志（不再红色 error）
    expect(logs.some((e) => e.type === 'info' && e.summary === '管线已取消')).toBe(true);
  });
});

describe('轮72: 建议列表交互 + 耗时计时', () => {
  it('建议可逐条忽略（X 按钮）', async () => {
    useAgentStore.setState({
      requirementsMessages: [
        { id: 'm0', role: 'assistant', content: 'x', timestamp: new Date().toISOString() },
      ],
      suggestions: [
        { id: 's1', type: 'pace', message: '第一条建议', confidence: 0.6 },
        { id: 's2', type: 'pace', message: '第二条建议', confidence: 0.6 },
      ],
    });
    render(<AgentPanel />);
    expect(screen.getByText('第一条建议')).toBeTruthy();

    fireEvent.click(screen.getAllByTitle('忽略该建议')[0]);
    await waitFor(() => {
      expect(useAgentStore.getState().suggestions.map((s) => s.id)).toEqual(['s2']);
    });
    expect(screen.queryByText('第一条建议')).toBeNull();
  });

  it('建议可复制（调用剪贴板）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    useAgentStore.setState({
      requirementsMessages: [
        { id: 'm0', role: 'assistant', content: 'x', timestamp: new Date().toISOString() },
      ],
      suggestions: [{ id: 's1', type: 'pace', message: '可复制的建议', confidence: 0.6 }],
    });
    render(<AgentPanel />);
    fireEvent.click(screen.getByTitle('复制建议'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('可复制的建议'));
  });

  it('运行中显示耗时（mm:ss）', async () => {
    useAgentStore.setState({
      pipelineId: 'p1',
      phase: 'structure',
      pipelineStartedAt: Date.now() - 65_000,
      requirementsMessages: [
        { id: 'm0', role: 'assistant', content: 'x', timestamp: new Date().toISOString() },
      ],
    });
    render(<AgentPanel />);
    await act(async () => {});
    expect(screen.getByTitle('本轮耗时').textContent).toMatch(/^01:0\d$/);
  });
});

describe('轮69: SSE delta 流式消费', () => {
  it('delta 增量填充同一条气泡，result 到达后收尾替换', async () => {
    const api = await import('@/services/api');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const streamChat = vi.fn(async (
      _sid: string,
      _msg: string,
      onChunk?: (c: { type: string; data: unknown }) => void,
    ) => {
      onChunk?.({ type: 'status', data: 'typing' });
      onChunk?.({ type: 'delta', data: '你好' });
      await gate;
      onChunk?.({ type: 'delta', data: '，世界' });
      return { reply: '你好，世界', status: 'gathering' };
    });
    (api.requirementsApi as unknown as { streamChat: typeof streamChat }).streamChat = streamChat;

    useAgentStore.setState({
      requirementsSessionId: 'sess_1',
      requirementsStatus: 'gathering',
      requirementsMessages: [
        { id: 'm0', role: 'assistant', content: '请描述选题', timestamp: new Date().toISOString() },
      ],
    });
    render(<AgentPanel />);

    const ta = screen.getByPlaceholderText('继续与需求 Agent 对话…（Shift+Enter 换行）');
    fireEvent.change(ta, { target: { value: '做一期数码评测' } });
    fireEvent.keyDown(ta, { key: 'Enter' });

    // 流中间态：打字气泡已出现且标记 streaming
    await waitFor(() => {
      const msgs = useAgentStore.getState().requirementsMessages;
      const last = msgs[msgs.length - 1];
      expect(last.role).toBe('assistant');
      expect(last.content).toBe('你好');
      expect(last.streaming).toBe(true);
    });
    expect(screen.getByLabelText('正在输出')).toBeTruthy();

    release();
    // 收尾：同一气泡被权威 reply 替换，streaming 复位，不新增气泡
    await waitFor(() => {
      const msgs = useAgentStore.getState().requirementsMessages;
      const assistant = msgs.filter((m) => m.role === 'assistant');
      expect(assistant).toHaveLength(2); // 初始一条 + 流式一条
      expect(assistant[1].content).toBe('你好，世界');
      expect(assistant[1].streaming).toBe(false);
    });
    expect(useAgentStore.getState().requirementsBusy).toBe(false);
  });

  it('流式失败时打字气泡转为错误文案且 streaming 复位', async () => {
    const api = await import('@/services/api');
    const streamChat = vi.fn(async (
      _sid: string,
      _msg: string,
      onChunk?: (c: { type: string; data: unknown }) => void,
    ) => {
      onChunk?.({ type: 'delta', data: '部分内容' });
      throw new Error('network down');
    });
    (api.requirementsApi as unknown as { streamChat: typeof streamChat }).streamChat = streamChat;

    useAgentStore.setState({
      requirementsSessionId: 'sess_2',
      requirementsStatus: 'gathering',
      requirementsMessages: [
        { id: 'm0', role: 'assistant', content: '请描述选题', timestamp: new Date().toISOString() },
      ],
    });
    render(<AgentPanel />);

    const ta = screen.getByPlaceholderText('继续与需求 Agent 对话…（Shift+Enter 换行）');
    fireEvent.change(ta, { target: { value: '选题' } });
    fireEvent.keyDown(ta, { key: 'Enter' });

    await waitFor(() => {
      const msgs = useAgentStore.getState().requirementsMessages;
      const last = msgs[msgs.length - 1];
      expect(last.content).toContain('消息发送失败');
      expect(last.streaming).toBe(false);
    });
  });
});

/**
 * R6：选中素材后的自然语言指令先走 `/intent` 落位，再决定"直接执行"还是"弹确认卡"。
 *
 * 这一层的价值全在**门禁**：宁可多问一句，也不要按用户没确认的意图去改时间线。
 * 因此断言的核心不是"卡片长什么样"，而是"什么情况下 edit 一定不被调用"。
 */
describe('R6: 意图落位门禁', () => {
  const api = () => import('@/services/api') as unknown as Promise<{
    requirementsApi: {
      intent: ReturnType<typeof vi.fn>;
      intentApply: ReturnType<typeof vi.fn>;
      edit: ReturnType<typeof vi.fn>;
    };
  }>;

  function seedSelection() {
    const clip = createDefaultClip({
      id: 'c0', kind: 'video' as const, track_id: 'tr1',
      start_sec: 0, duration_sec: 2, text: '进球片段',
    });
    useTimelineStore.setState({
      timeline: {
        id: 'tl1', width: 1920, height: 1080, fps: 30, duration_sec: 10,
        tracks: [{ id: 'tr1', name: 'V1', kind: 'video' as const, index: 0, locked: false, muted: false, clips: [clip] }],
      },
    });
    useSelectionStore.setState({ selectedClipIds: ['c0'], selectedTrackId: 'tr1' });
    useAgentStore.setState({
      requirementsSessionId: 'req_r6',
      requirementsStatus: 'gathering',
      requirementsMessages: [{ id: 'm0', role: 'assistant', content: '说吧', timestamp: new Date().toISOString() }],
    });
  }

  async function submit(text: string) {
    render(<AgentPanel />);
    const ta = screen.getByPlaceholderText('描述对选中素材的修改…（Shift+Enter 换行）');
    fireEvent.change(ta, { target: { value: text } });
    fireEvent.keyDown(ta, { key: 'Enter' });
  }

  it('解析无问题 → 不弹卡，直接走 /edit', async () => {
    const r = await api();
    r.requirementsApi.intent.mockResolvedValue({ intent: '删掉选中片段', resolution: { questions: [] }, problems: [] });
    r.requirementsApi.edit.mockResolvedValue({ reply: '已删除', status: 'gathering' });
    seedSelection();
    await submit('把这段删了');

    await waitFor(() => expect(r.requirementsApi.edit).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('intent-card')).toBeNull();
  });

  it('有未答问题 → 弹卡且绝不动时间线（edit 零调用）', async () => {
    const r = await api();
    r.requirementsApi.edit.mockClear();
    r.requirementsApi.intent.mockClear();
    r.requirementsApi.intent.mockResolvedValue({
      intent: '删除匹配片段',
      resolution: {
        preview: ['remove → c0'],
        affected_clip_ids: ['c0'],
        questions: [{ code: 'ambiguous', text: '「这段」指哪个？', options: [
          { value: 'c0', label: '进球片段' }, { value: 'c1', label: '庆祝片段' },
        ] }],
      },
      problems: [],
    });
    r.requirementsApi.edit.mockResolvedValue({ reply: 'x', status: 'gathering' });
    seedSelection();
    await submit('把这段删了');

    await waitFor(() => expect(screen.getByTestId('intent-card')).toBeTruthy());
    expect(screen.getByTestId('intent-preview').textContent).toContain('remove → c0');
    expect((screen.getByTestId('intent-confirm') as HTMLButtonElement).disabled).toBe(true);
    // 关键门禁：问题没答完之前，后端编辑通路一次都不能被碰到
    expect(r.requirementsApi.edit).not.toHaveBeenCalled();
  });

  it('答完问题点确认 → 走 /intent/apply 执行确认过的那份意图', async () => {
    const r = await api();
    r.requirementsApi.intent.mockClear();
    r.requirementsApi.intentApply.mockClear();
    r.requirementsApi.edit.mockClear();
    r.requirementsApi.intent.mockResolvedValue({
      intent: '删除匹配片段',
      intent_raw: { ops: [{ op: 'remove', target: { selected: true } }] },
      resolution: {
        preview: ['remove → c0'],
        affected_clip_ids: ['c0'],
        questions: [{ code: 'ambiguous', text: '「这段」指哪个？', options: [
          { value: 'c0', label: '进球片段' }, { value: 'c1', label: '庆祝片段' },
        ] }],
      },
      problems: [],
    });
    r.requirementsApi.intentApply.mockResolvedValue({
      applied: true, blocked: false,
      timeline: { id: 'tl1', width: 1920, height: 1080, fps: 30, duration_sec: 6, tracks: [] },
      report: { preview: ['共 1 项改动：片段 1 → 0 个'], problems: [],
                affected_clip_ids: ['c0'], clips_before: 1, clips_after: 0,
                duration_before: 2, duration_after: 0 },
      problems: [],
    });
    seedSelection();
    await submit('把这段删了');

    await waitFor(() => expect(screen.getByTestId('intent-card')).toBeTruthy());
    fireEvent.click(screen.getByTestId('intent-option-ambiguous-c0'));
    fireEvent.click(screen.getByTestId('intent-confirm'));

    await waitFor(() => expect(r.requirementsApi.intentApply).toHaveBeenCalledTimes(1));
    const [, payload] = r.requirementsApi.intentApply.mock.calls[0] as [string, Record<string, unknown>];
    // 关键：执行的是用户确认过的那份意图（intent_raw 原样回传）+ 他选的答案
    expect(payload.apply).toBe(true);
    expect(payload.answers).toEqual({ ambiguous: 'c0' });
    expect(payload.intent_raw).toEqual({ ops: [{ op: 'remove', target: { selected: true } }] });
    // 不再绕道 /edit（那会让模型把这句话重新理解一遍）
    expect(r.requirementsApi.edit).not.toHaveBeenCalled();
  });

  it('执行失败（后端 block）→ 如实说"时间线未变"并把问题挂回卡上', async () => {
    const r = await api();
    r.requirementsApi.intent.mockClear();
    r.requirementsApi.intentApply.mockClear();
    r.requirementsApi.intent.mockResolvedValue({
      intent: '删除匹配片段',
      resolution: { preview: [], affected_clip_ids: [], questions: [] },
      problems: [{ level: 'error', where: 'ops[0]', message: '不支持的操作' }],
      blocked: true,
    });
    r.requirementsApi.intentApply.mockResolvedValue({
      applied: false, blocked: true,
      report: { problems: [{ level: 'error', where: 'ops[0]', message: '这段会把时间线清空' }],
                preview: [], affected_clip_ids: [], clips_before: 1, clips_after: 0,
                duration_before: 2, duration_after: 0 },
      problems: [],
    });
    seedSelection();
    await submit('把这个片段炸开');

    await waitFor(() => expect(screen.getByTestId('intent-blocked')).toBeTruthy());
    // blocked 的卡不能有可用的确认按钮（第一次就拦住）
    expect((screen.getByTestId('intent-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(r.requirementsApi.intentApply).not.toHaveBeenCalled();
    expect(r.requirementsApi.edit).not.toHaveBeenCalled();
  });

  it('/intent/apply 抛错 → 明确告知未改动，不伪装成功', async () => {
    const r = await api();
    r.requirementsApi.intent.mockClear();
    r.requirementsApi.intentApply.mockClear();
    r.requirementsApi.intent.mockResolvedValue({
      intent: '删除匹配片段',
      resolution: {
        preview: ['remove → c0'],
        affected_clip_ids: ['c0'],
        questions: [{ code: 'ambiguous', text: '「这段」指哪个？', options: [
          { value: 'c0', label: '进球片段' },
        ] }],
      },
      problems: [],
    });
    r.requirementsApi.intentApply.mockRejectedValue(new Error('boom'));
    seedSelection();
    await submit('把这段删了');

    await waitFor(() => expect(screen.getByTestId('intent-card')).toBeTruthy());
    fireEvent.click(screen.getByTestId('intent-option-ambiguous-c0'));
    fireEvent.click(screen.getByTestId('intent-confirm'));
    await waitFor(() => {
      const msgs = useAgentStore.getState().requirementsMessages;
      expect(msgs[msgs.length - 1].content).toContain('时间线未变');
    });
  });

  it('blocked（不能执行的操作）→ 弹卡并拦住，用户可取消', async () => {
    const r = await api();
    r.requirementsApi.intent.mockClear();
    r.requirementsApi.edit.mockClear();
    r.requirementsApi.intent.mockResolvedValue({
      intent: '做点别的',
      resolution: { preview: [], questions: [] },
      problems: [{ level: 'error', message: "不支持的操作 'explode'" }],
    });
    seedSelection();
    await submit('把这个片段炸开');

    await waitFor(() => expect(screen.getByTestId('intent-blocked').textContent).toContain('explode'));
    expect((screen.getByTestId('intent-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(r.requirementsApi.edit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('intent-cancel'));
    await waitFor(() => expect(screen.queryByTestId('intent-card')).toBeNull());
    expect(r.requirementsApi.edit).not.toHaveBeenCalled();
  });

  it('/intent 挂了 → 静默降级为直接编辑（不挡用户的手）', async () => {
    const r = await api();
    r.requirementsApi.intent.mockClear();
    r.requirementsApi.edit.mockClear();
    r.requirementsApi.intent.mockRejectedValue(new Error('404 not found'));
    r.requirementsApi.edit.mockResolvedValue({ reply: '已删除', status: 'gathering' });
    seedSelection();
    await submit('把这段删了');

    await waitFor(() => expect(r.requirementsApi.edit).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('intent-card')).toBeNull();
  });
});
