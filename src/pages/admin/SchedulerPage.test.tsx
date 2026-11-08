// @vitest-environment jsdom
/**
 * PRD B8（2026-10-29 / G4、G6）：调度页与渲染运维入口。
 *
 * 断言的是**动作语义**，不是"页面能渲染"：
 * 1. 调度 CRUD / toggle 打到正确端点；
 * 2. tick 与删除都要二次确认（tick 会真的派发任务、删除不可撤销）；
 * 3. 渲染后端展示「请求 vs 实际生效」，清理产物要二次确认并回显删除数量。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SchedulerPage } from './SchedulerPage';
import { RenderOpsSection } from '@/features/settings/RenderOpsSection';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    list: vi.fn(),
    create: vi.fn(),
    toggle: vi.fn(),
    remove: vi.fn(),
    tick: vi.fn(),
    getBackends: vi.fn(),
    cleanupArtifacts: vi.fn(),
    check: vi.fn(),
  },
}));

vi.mock('@/services/api/scheduler', () => ({
  schedulerApi: {
    list: mocks.list, create: mocks.create, toggle: mocks.toggle,
    remove: mocks.remove, tick: mocks.tick,
  },
}));

vi.mock('@/services/api', () => ({
  renderApi: { getBackends: mocks.getBackends, cleanupArtifacts: mocks.cleanupArtifacts },
  healthApi: { check: mocks.check },
}));

vi.mock('@/features/plugins/usePluginSlots', () => ({ usePluginSlots: () => [] }));
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/settings/scheduler' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const SCHED = {
  schedule_id: 'sched_1', name: '每日出片', interval_sec: 0, daily_hhmm: '09:30',
  payload: {}, active: true, next_run_at: '2026-10-30T01:30:00Z', last_run_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([SCHED]);
  mocks.create.mockResolvedValue(SCHED);
  mocks.toggle.mockResolvedValue({ status: 'ok', active: false });
  mocks.remove.mockResolvedValue({ status: 'deleted', schedule_id: 'sched_1' });
  mocks.tick.mockResolvedValue({ fired: 1, schedules: ['sched_1'] });
  mocks.getBackends.mockResolvedValue({
    backends: [{ name: 'local', available: true, capabilities: { h264: true, gpu: false } }],
    requested: 'local', effective: 'local', remote_render_url: false,
  });
  mocks.cleanupArtifacts.mockResolvedValue({ status: 'ok', removed: 7, older_than_days: 30 });
  mocks.check.mockResolvedValue({ status: 'ok' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(cleanup);

describe('B8 调度页', () => {
  it('列出定时任务，展示下次触发与状态', async () => {
    render(<SchedulerPage />);
    const list = await screen.findByTestId('scheduler-list');
    expect(list.textContent).toContain('每日出片');
    expect(list.textContent).toContain('每日 09:30');
    expect(list.textContent).toContain('下次');
    expect(list.textContent).toContain('运行中');
  });

  it('创建：校验通过后调 create（payload 形状正确）', async () => {
    render(<SchedulerPage />);
    await screen.findByTestId('scheduler-list');
    fireEvent.change(screen.getByTestId('schedule-name'), { target: { value: '每周巡检' } });
    fireEvent.change(screen.getByTestId('schedule-hhmm'), { target: { value: '08:05' } });
    fireEvent.click(screen.getByRole('button', { name: /创建/ }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({
      name: '每周巡检', interval_sec: 0, daily_hhmm: '08:05',
    }));
  });

  it('非法 HH:MM 不提交，给可读错误', async () => {
    render(<SchedulerPage />);
    await screen.findByTestId('scheduler-list');
    fireEvent.change(screen.getByTestId('schedule-name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByTestId('schedule-hhmm'), { target: { value: '25:99' } });
    fireEvent.click(screen.getByRole('button', { name: /创建/ }));

    const err = await screen.findByTestId('schedule-form-err');
    expect(err.textContent).toContain('HH:MM');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('toggle 调对应端点；删除需二次确认后才发请求', async () => {
    render(<SchedulerPage />);
    await screen.findByTestId('scheduler-list');

    fireEvent.click(screen.getByRole('button', { name: '停用' }));
    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledWith('sched_1', false));

    fireEvent.click(screen.getByLabelText('删除定时任务 每日出片'));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('sched_1'));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('不可撤销'));
  });

  it('tick 需二次确认，并回显触发了几个', async () => {
    render(<SchedulerPage />);
    await screen.findByTestId('scheduler-list');

    fireEvent.click(screen.getByRole('button', { name: /立即触发一次/ }));
    await waitFor(() => expect(mocks.tick).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('立即扫描一次到期任务'));
    expect((await screen.findByTestId('scheduler-note')).textContent).toContain('1 个任务');
  });

  it('取消确认 → 不发请求', async () => {
    (window.confirm as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    render(<SchedulerPage />);
    await screen.findByTestId('scheduler-list');
    fireEvent.click(screen.getByRole('button', { name: /立即触发一次/ }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(mocks.tick).not.toHaveBeenCalled();
  });

  it('空态明确说明下一步；加载失败可重试', async () => {
    mocks.list.mockResolvedValue([]);
    render(<SchedulerPage />);
    expect(await screen.findByTestId('scheduler-empty')).toBeTruthy();
    cleanup();

    mocks.list.mockRejectedValue(new Error('后端离线'));
    render(<SchedulerPage />);
    expect((await screen.findByTestId('scheduler-error')).textContent).toContain('后端离线');
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
});

describe('B8 渲染运维', () => {
  it('展示请求后端 vs 实际生效 + 后端清单', async () => {
    render(<RenderOpsSection />);
    const eff = await screen.findByTestId('render-effective');
    expect(eff.textContent).toContain('local');
    expect(eff.textContent).toContain('实际生效');
    expect(screen.getByTestId('render-backends').textContent).toContain('local');
  });

  it('清理产物：二次确认 + 回显删除数量；取消则不清理', async () => {
    render(<RenderOpsSection />);
    await screen.findByTestId('render-effective');

    fireEvent.click(screen.getByRole('button', { name: /清理/ }));
    await waitFor(() => expect(mocks.cleanupArtifacts).toHaveBeenCalledWith(30));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('不可撤销'));
    expect((await screen.findByTestId('render-cleanup-note')).textContent).toContain('7 个文件');

    cleanup();
    (window.confirm as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mocks.cleanupArtifacts.mockClear();
    render(<RenderOpsSection />);
    await screen.findByTestId('render-effective');
    fireEvent.click(screen.getByRole('button', { name: /清理/ }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(mocks.cleanupArtifacts).not.toHaveBeenCalled();
  });

  it('后端加载失败给可读错误与重试入口', async () => {
    mocks.getBackends.mockRejectedValue(new Error('后端离线'));
    render(<RenderOpsSection />);
    expect((await screen.findByTestId('render-ops-error')).textContent).toContain('后端离线');
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
});
