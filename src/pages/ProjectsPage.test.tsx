// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectsPage } from './ProjectsPage';
import type { ProjectSummary } from '@/types/api';

const projects: ProjectSummary[] = [
  { id: 'proj_1', name: '项目A', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z', folder: '', tags: [], track_count: 2, duration_sec: 10 },
  { id: 'proj_2', name: '项目B', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z', folder: '', tags: [], track_count: 3, duration_sec: 20 },
];

const { mocks } = vi.hoisted(() => ({
  mocks: {
    list: vi.fn(),
    remove: vi.fn(),
    getThumbnailUrl: vi.fn(),
    toast: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  projectApi: {
    list: mocks.list,
    remove: mocks.remove,
    getThumbnailUrl: mocks.getThumbnailUrl,
  },
}));

vi.mock('@/stores/toastStore', () => ({
  toast: mocks.toast,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

/** Open the delete confirm on a card, then click the confirm (trash) button. */
async function confirmDelete(projectName: string) {
  fireEvent.click(screen.getByRole('button', { name: `删除项目 ${projectName}` }));
  const cancel = screen.getByRole('button', { name: '取消' });
  const deleteConfirm = cancel.previousElementSibling as HTMLElement;
  fireEvent.click(deleteConfirm);
}

describe('ProjectsPage handleDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue(projects);
    mocks.getThumbnailUrl.mockReturnValue('http://localhost:8000/api/project/proj_1/thumbnail');
  });

  it('removes the project from the list when the delete API succeeds', async () => {
    mocks.remove.mockResolvedValue({ ok: true });
    render(<ProjectsPage />);
    await screen.findByText('项目A');

    await confirmDelete('项目A');

    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith('proj_1');
    });
    await waitFor(() => {
      expect(screen.queryByText('项目A')).toBeNull();
    });
    expect(screen.getByText('项目B')).toBeTruthy();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('keeps the project in the list and shows an error toast when the delete API fails', async () => {
    mocks.remove.mockRejectedValue(new Error('后端不可达'));
    render(<ProjectsPage />);
    await screen.findByText('项目A');

    await confirmDelete('项目A');

    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith('proj_1');
    });
    await waitFor(() => {
      expect(screen.getByText('项目A')).toBeTruthy();
    });
    expect(mocks.toast).toHaveBeenCalledWith('删除失败：后端不可达，项目已保留', 'error');
  });
});
