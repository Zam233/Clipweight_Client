// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TypeCatalogPanel } from './TypeCatalogPanel';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('./useTypeCatalog', () => ({
  useTypeCatalog: () => ({
    types: [{ id: 'demo_type', name: '示例类型', description: '描述', builtin: false, tags: [] }],
    loading: false, error: null, reload: vi.fn(),
  }),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('TypeCatalogPanel', () => {
  it('点击类型卡片进入详情，点击 AI 创建进入 TypeForge', () => {
    render(<TypeCatalogPanel />);
    fireEvent.click(screen.getByText('示例类型'));
    expect(navigate).toHaveBeenCalledWith({ to: '/settings/type-maker/$typeId', params: { typeId: 'demo_type' } });
    fireEvent.click(screen.getByRole('button', { name: /AI 创建/ }));
    expect(navigate).toHaveBeenCalledWith({ to: '/settings/type-maker/forge' });
  });
});
