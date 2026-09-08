// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { EditorLayout } from './EditorLayout';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    setPanelWidth: vi.fn(),
    setTimelineHeight: vi.fn(),
    panels: { assets: true, properties: true, agent: true },
    panelWidths: { assets: 260, properties: 320, agent: 300 },
    timelineHeight: 260,
    mobilePanel: null as string | null,
    setMobilePanel: vi.fn(),
    timelineDirty: false,
  },
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: (sel?: (s: unknown) => unknown) => {
    const st = {
      panels: mocks.panels,
      panelWidths: mocks.panelWidths,
      timelineHeight: mocks.timelineHeight,
      setPanelWidth: mocks.setPanelWidth,
      setTimelineHeight: mocks.setTimelineHeight,
      mobilePanel: mocks.mobilePanel,
      setMobilePanel: mocks.setMobilePanel,
    };
    return sel ? sel(st) : st;
  },
}));

vi.mock('@/features/assets/AssetPanel', () => ({ AssetPanel: () => <div>assets</div> }));
vi.mock('@/features/preview/PreviewPanel', () => ({ PreviewPanel: () => <div>preview</div> }));
vi.mock('@/features/timeline/components/TimelinePanel', () => ({ TimelinePanel: () => <div>timeline</div> }));
vi.mock('@/features/properties/PropertiesPanel', () => ({ PropertiesPanel: () => <div>properties</div> }));
vi.mock('@/features/agent/AgentPanel', () => ({ AgentPanel: () => <div>agent</div> }));
vi.mock('@/features/timeline/components/EditorToolbar', () => ({ EditorToolbar: () => <div>toolbar</div> }));
vi.mock('@/features/agent/ReviewPanel', () => ({ ReviewPanel: () => <div>review</div> }));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel?: (s: unknown) => unknown) =>
    sel ? sel({ reviewMode: null, setReviewMode: vi.fn(), creativeBrief: null, productionPlan: null })
      : { reviewMode: null, setReviewMode: vi.fn(), creativeBrief: null, productionPlan: null },
}));

const storeMock = () => ({
  isSaving: false, lastSavedAt: null, saveError: null,
  currentTimeSec: 0, loopRegion: null, isLooping: false,
  toolMode: 'select',
  showFramesInRuler: false, setShowFramesInRuler: vi.fn(),
  undoStack: [], redoStack: [],
});
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: (sel?: (s: unknown) => unknown) => sel ? sel(storeMock()) : storeMock(),
}));
vi.mock('@/stores/previewStore', () => ({
  usePreviewStore: (sel?: (s: unknown) => unknown) => sel ? sel(storeMock()) : storeMock(),
}));
vi.mock('@/stores/timelineStore', () => ({
  useTimelineStore: (sel?: (s: unknown) => unknown) => {
    const st = {
      ...storeMock(),
      timeline: { fps: 30, duration_sec: 0, tracks: [] },
      isDirty: mocks.timelineDirty,
    };
    return sel ? sel(st) : st;
  },
}));
vi.mock('@/stores/selectionStore', () => ({
  useSelectionStore: (sel?: (s: unknown) => unknown) => sel ? sel(storeMock()) : storeMock(),
}));
vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: (sel?: (s: unknown) => unknown) => sel ? sel(storeMock()) : storeMock(),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (sel?: (s: unknown) => unknown) => sel ? sel(storeMock()) : storeMock(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 触发分隔条拖拽：从 startX 拖到 endX（鼠标按下 → 移动 → 抬起）。 */
function dragDivider(divider: HTMLElement, startX: number, endX: number) {
  act(() => {
    fireEvent.mouseDown(divider, { clientX: startX, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: endX, clientY: 100 });
    fireEvent.mouseUp(document);
  });
}

describe('EditorLayout 面板分隔条方向（BUG2 回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Agent 面板：向右拖 divider（dx>0）→ 面板收窄（w - dx）', () => {
    const { container } = render(<EditorLayout />);
    const dividers = container.querySelectorAll('.panel-divider');
    // 顺序：assets divider, properties divider, agent divider（timeline 是 panel-divider-h）
    expect(dividers.length).toBe(3);
    const agentDivider = dividers[2];
    dragDivider(agentDivider as HTMLElement, 500, 560); // dx = +60
    expect(mocks.setPanelWidth).toHaveBeenCalledWith('agent', 300 - 60); // 240，收窄
  });

  it('Agent 面板：向左拖 divider（dx<0）→ 面板加宽（w - dx）', () => {
    const { container } = render(<EditorLayout />);
    const dividers = container.querySelectorAll('.panel-divider');
    const agentDivider = dividers[2];
    dragDivider(agentDivider as HTMLElement, 500, 440); // dx = -60
    expect(mocks.setPanelWidth).toHaveBeenCalledWith('agent', 300 + 60); // 360，加宽
  });

  it('Assets 面板：向右拖 → 加宽（w + dx，divider 在右侧）', () => {
    const { container } = render(<EditorLayout />);
    const dividers = container.querySelectorAll('.panel-divider');
    dragDivider(dividers[0] as HTMLElement, 200, 260); // dx = +60
    expect(mocks.setPanelWidth).toHaveBeenCalledWith('assets', 260 + 60);
  });

  it('Properties 面板：向右拖 → 收窄（w - dx，divider 在左侧）', () => {
    const { container } = render(<EditorLayout />);
    const dividers = container.querySelectorAll('.panel-divider');
    dragDivider(dividers[1] as HTMLElement, 400, 460); // dx = +60
    expect(mocks.setPanelWidth).toHaveBeenCalledWith('properties', 320 - 60);
  });
});

describe('轮75: 状态栏未保存指示', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timelineDirty = false;
  });

  it('isDirty=true 时显示「● 未保存」', () => {
    mocks.timelineDirty = true;
    const { container } = render(<EditorLayout />);
    expect(container.textContent).toContain('● 未保存');
  });

  it('isDirty=false 时不显示未保存', () => {
    const { container } = render(<EditorLayout />);
    expect(container.textContent).not.toContain('● 未保存');
  });
});

describe('轮69: 响应式 3b 折叠抽屉', () => {
  /** 模拟 <lg 视口：所有媒体查询均不匹配。 */
  function stubNarrowViewport() {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mobilePanel = null;
  });

  it('<lg 视口：docked 面板全部隐藏（无分隔条）', () => {
    stubNarrowViewport();
    const { container } = render(<EditorLayout />);
    expect(container.querySelectorAll('.panel-divider').length).toBe(0);
    // 预览与时间线仍在（画布已流式）
    expect(container.textContent).toContain('preview');
    expect(container.textContent).toContain('timeline');
  });

  it('<lg 视口：mobilePanel 渲染为抽屉（dialog 角色 + 面板内容）', () => {
    stubNarrowViewport();
    mocks.mobilePanel = 'agent';
    const { container } = render(<EditorLayout />);
    expect(container.querySelectorAll('.panel-divider').length).toBe(0);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain('agent');
  });

  it('抽屉关闭按钮调用 setMobilePanel(null)', () => {
    stubNarrowViewport();
    mocks.mobilePanel = 'assets';
    const { getByLabelText } = render(<EditorLayout />);
    act(() => { fireEvent.click(getByLabelText('关闭面板')); });
    expect(mocks.setMobilePanel).toHaveBeenCalledWith(null);
  });

  it('<768 视口：时间线渲染只读提示层', () => {
    stubNarrowViewport();
    const { getByLabelText } = render(<EditorLayout />);
    expect(getByLabelText('时间线只读提示')).toBeTruthy();
  });

  it('≥lg 视口（matchMedia 匹配）：抽屉不渲染，docked 恢复', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    mocks.mobilePanel = 'agent';
    const { container } = render(<EditorLayout />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelectorAll('.panel-divider').length).toBe(3);
  });
});
