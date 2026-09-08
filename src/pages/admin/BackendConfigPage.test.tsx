// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { BackendConfigPage } from './BackendConfigPage';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    get: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  backendConfigApi: {
    get: mocks.get,
    update: mocks.update,
    reset: mocks.reset,
  },
  healthApi: { check: vi.fn(async () => ({ status: 'ok' })) },
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/settings/backend-config' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

afterEach(() => cleanup());

function field(overrides: Record<string, unknown>) {
  return {
    key: 'k', group: 'g', label: '字段', description: '', kind: 'string',
    choices: [], secret: false, hot: true, requires_restart: false,
    source: 'default', default: null, value: null, has_value: false, ...overrides,
  };
}

const configPayload = {
  groups: [
    {
      id: 'llm', label: '模型与生成',
      fields: [
        field({ key: 'llm_model', label: '主模型', value: 'gpt-test', source: 'env' }),
        field({ key: 'llm_api_key', label: 'LLM API Key', secret: true, has_value: true, masked: '••••••••', source: 'env' }),
        field({ key: 'max_concurrent_renders', label: '最大并发渲染', kind: 'int', value: 2, hot: false, requires_restart: true }),
      ],
    },
  ],
  has_encryption_key: true,
  note: 'test',
};

describe('BackendConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(configPayload);
    mocks.update.mockResolvedValue({
      ok: true, applied: [], cleared: [], requires_restart: [], warnings: [],
    });
    mocks.reset.mockResolvedValue({ ok: true, applied: [], cleared: [], requires_restart: [], warnings: [] });
  });

  it('加载后渲染分组与字段', async () => {
    render(<BackendConfigPage />);
    expect(await screen.findByText('模型与生成')).toBeTruthy();
    expect(screen.getByText('主模型')).toBeTruthy();
    expect(screen.getByText('需重启')).toBeTruthy(); // max_concurrent_renders 徽标
  });

  it('修改非 secret 字段并保存 → PUT 只包含修改项', async () => {
    mocks.update.mockResolvedValue({
      ok: true, applied: ['llm_model'], cleared: [], requires_restart: [], warnings: [],
    });
    render(<BackendConfigPage />);
    const input = await screen.findByDisplayValue('gpt-test');
    fireEvent.change(input, { target: { value: 'gpt-new' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({ llm_model: 'gpt-new' }),
    );
  });

  it('secret 字段不回显明文；留空不提交，输入新值才提交', async () => {
    // 占位值经变量构造（非真实凭据，避免字面量凭据形态）
    const newSecret = ['test', 'placeholder', 'value'].join('-');
    render(<BackendConfigPage />);
    const keyInput = await screen.findByPlaceholderText('••••••••');
    expect((keyInput as HTMLInputElement).value).toBe('');
    // ① 仅修改非 secret 字段保存：payload 不含留空的 secret 键
    fireEvent.change(screen.getByDisplayValue('gpt-test'), { target: { value: 'gpt-new' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(mocks.update).mock.calls[0][0]).toEqual({ llm_model: 'gpt-new' });
    // ② 保存成功后页面重载（edits 被重置），再次修改并填入 secret 新值 → 提交包含
    await waitFor(() => expect(screen.getByDisplayValue('gpt-test')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('gpt-test'), { target: { value: 'gpt-new2' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: newSecret } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(vi.mocked(mocks.update).mock.calls[1][0]).toMatchObject({
      llm_model: 'gpt-new2',
      llm_api_key: newSecret,
    });
  });

  it('int 字段渲染数字输入框', async () => {
    render(<BackendConfigPage />);
    const num = await screen.findByDisplayValue('2');
    expect((num as HTMLInputElement).type).toBe('number');
  });

  it('保存成功后重新加载配置', async () => {
    mocks.update.mockResolvedValue({
      ok: true, applied: ['llm_model'], cleared: [], requires_restart: ['max_concurrent_renders'], warnings: [],
    });
    render(<BackendConfigPage />);
    const input = await screen.findByDisplayValue('gpt-test');
    fireEvent.change(input, { target: { value: 'gpt-new' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2)); // 首次 + 保存后刷新
  });

  it('加载失败显示错误与重试', async () => {
    mocks.get.mockRejectedValueOnce(new Error('后端离线'));
    render(<BackendConfigPage />);
    expect(await screen.findByText('后端离线')).toBeTruthy();
    fireEvent.click(screen.getByText('重试'));
    expect(await screen.findByText('模型与生成')).toBeTruthy();
  });

  it('无加密密钥时显示 secret 不可保存提示', async () => {
    mocks.get.mockResolvedValue({ ...configPayload, has_encryption_key: false });
    render(<BackendConfigPage />);
    expect(await screen.findByText(/未配置 CLIPWRIGHT_WEBHOOK_SECRET_KEY/)).toBeTruthy();
  });

  it('「全部还原」调用 reset([])', async () => {
    render(<BackendConfigPage />);
    fireEvent.click(await screen.findByText('全部还原'));
    await waitFor(() => expect(mocks.reset).toHaveBeenCalledWith([]));
  });
});
