// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TypeDetailPage } from './TypeDetailPage';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    get: vi.fn(), update: vi.fn(), remove: vi.fn(), validate: vi.fn(), navigate: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  typeMakerApi: {
    get: mocks.get, update: mocks.update, remove: mocks.remove, validate: mocks.validate,
  },
}));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ typeId: 'demo_type' }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('@/stores/toastStore', () => ({ toast: vi.fn() }));

const custom = {
  id: 'demo_type', name: '示例类型', description: '测试',
  shot_params: { min_shot_sec: 1, max_shot_sec: 3, transition_type: 'cut', transition_duration_sec: 0.2, cut_on_beat: true },
  prompts: { genre: { text: '快节奏知识解说' } },
  param_rules: [], signature_traits: [], declares: {}, waivers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(custom);
  mocks.validate.mockResolvedValue({ ok: true, errors: [], warnings: [] });
  mocks.update.mockResolvedValue({ status: 'updated' });
  mocks.remove.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('TypeDetailPage', () => {
  it('默认只读，编辑后保存，删除需确认', async () => {
    render(<TypeDetailPage />);
    expect(await screen.findByText('示例类型')).toBeTruthy();
    expect(screen.getByRole('button', { name: /编辑/ }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    expect(screen.getByRole('button', { name: /保存/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(mocks.validate).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith('demo_type', expect.objectContaining({ id: 'demo_type' }));
    fireEvent.click(screen.getByRole('button', { name: /删除/ }));
    expect(screen.getByText(/确认删除类型/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('demo_type'));
    expect(mocks.navigate).toHaveBeenCalled();
  });

  it('内置类型编辑/删除禁用', async () => {
    mocks.get.mockResolvedValue({ id: 'builtin_x', name: '内置类型', description: '', builtin: true });
    render(<TypeDetailPage />);
    expect(await screen.findByText('内置类型')).toBeTruthy();
    expect((screen.getByRole('button', { name: /编辑/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /删除/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
