// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TypeForgePage } from './TypeForgePage';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    sessions: vi.fn(), start: vi.fn(), detail: vi.fn(), message: vi.fn(),
    commit: vi.fn(), remove: vi.fn(), validate: vi.fn(), navigate: vi.fn(), toast: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  typeForgeApi: {
    sessions: mocks.sessions, start: mocks.start, detail: mocks.detail,
    message: mocks.message, messageStream: mocks.message, commit: mocks.commit, remove: mocks.remove,
  },
  typeMakerApi: { validate: mocks.validate },
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/stores/toastStore', () => ({ toast: mocks.toast }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessions.mockResolvedValue({ sessions: [], total: 0 });
  mocks.start.mockResolvedValue({ session_id: 's1', draft: {} });
  mocks.validate.mockResolvedValue({ ok: true, errors: [], warnings: [] });
  mocks.commit.mockResolvedValue({ status: 'created', id: 'demo_type' });
});
afterEach(() => cleanup());

describe('TypeForgePage', () => {
  it('新建会话后填写 ID/名称并提交', async () => {
    render(<TypeForgePage />);
    expect(await screen.findByText(/TypeForge/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /新建类型/ }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/类型 ID/), { target: { value: 'demo_type' } });
    fireEvent.change(screen.getByPlaceholderText('类型名称'), { target: { value: '示例类型' } });
    fireEvent.click(screen.getByRole('button', { name: /保存类型/ }));
    await waitFor(() => expect(mocks.commit).toHaveBeenCalled());
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/type-maker/$typeId', params: { typeId: 'demo_type' } });
  });
});
