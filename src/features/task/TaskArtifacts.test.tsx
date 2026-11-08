/**
 * 收口批次：任务产物 → 编辑器闭环。
 *
 * 三种状态必须都对：
 * 1. 没时间线时不显示假按钮（明说没有可编辑产物）；
 * 2. 有时间线时显示轨道/片段/时长，点按钮落项目并跳编辑器；
 * 3. 落项目失败（409 等）时把后端原因原样显示，不吞。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api, navigate } = vi.hoisted(() => ({
  api: {
    result: vi.fn(),
    toProject: vi.fn(),
  },
  navigate: vi.fn(),
}));

vi.mock('@/services/api/task', () => ({ taskApi: api }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

import { TaskArtifacts } from './TaskArtifacts';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskArtifacts', () => {
  it('没有时间线时明说，并禁用按钮', async () => {
    api.result.mockResolvedValue({
      task_id: 'task_1', has_timeline: false, tracks: 0, clips: 0,
      duration_sec: 0, output_path: '',
    });
    render(<TaskArtifacts taskId="task_1" />);
    expect(await screen.findByText(/还没有可编辑的时间线/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /在编辑器中打开/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('有时间线时显示指标，点击落项目并跳编辑器', async () => {
    api.result.mockResolvedValue({
      task_id: 'task_1', has_timeline: true, tracks: 3, clips: 12,
      duration_sec: 60, output_path: 'out/final.mp4',
    });
    api.toProject.mockResolvedValue({ task_id: 'task_1', project_id: 'proj_9', name: 'x' });
    render(<TaskArtifacts taskId="task_1" />);

    expect(await screen.findByText(/3 条轨道 · 12 个片段/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /在编辑器中打开/ }));

    await waitFor(() => expect(api.toProject).toHaveBeenCalledWith('task_1'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/editor/$projectId',
      params: { projectId: 'proj_9' },
    });
  });

  it('落项目失败时显示后端原因', async () => {
    api.result.mockResolvedValue({
      task_id: 'task_1', has_timeline: true, tracks: 1, clips: 2,
      duration_sec: 10, output_path: '',
    });
    api.toProject.mockRejectedValue({
      response: { data: { detail: '这条任务还没有可编辑的 timeline' } },
    });
    render(<TaskArtifacts taskId="task_1" />);
    await screen.findByText(/1 条轨道/);
    fireEvent.click(screen.getByRole('button', { name: /在编辑器中打开/ }));
    expect(await screen.findByText(/还没有可编辑的 timeline/)).toBeTruthy();
  });

  it('enabled=false 时不请求也不渲染', () => {
    render(<TaskArtifacts taskId="task_1" enabled={false} />);
    expect(api.result).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('任务产物')).toBeNull();
  });
});
