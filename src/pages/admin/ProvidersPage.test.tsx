// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ProvidersPage } from './ProvidersPage';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    list: vi.fn(), available: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    setRole: vi.fn(), setModels: vi.fn(), upsertModel: vi.fn(), deleteModel: vi.fn(),
    fetchModels: vi.fn(), testSource: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  healthApi: { check: vi.fn(async () => ({ status: 'ok' })) },
}));

vi.mock('@/services/api/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/providers')>();
  return {
    ...actual, // 保留 KIND_ROLES / ROLE_LABELS / providersForKind / buildSourcePayload
    providersApi: {
      list: mocks.list, available: mocks.available, create: mocks.create, update: mocks.update,
      remove: mocks.remove, setRole: mocks.setRole, setModels: mocks.setModels,
      upsertModel: mocks.upsertModel, deleteModel: mocks.deleteModel, fetchModels: mocks.fetchModels,
      testSource: mocks.testSource,
    },
  };
});

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/settings/providers' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

afterEach(() => cleanup());

const AVAILABLE = {
  llm_provider: ['openai', 'anthropic', 'plugin-llm'],
  tts_provider: ['qwen-tts'],
  embedding_provider: ['openai', 'local'],
  rerank_provider: ['http'],
  role_kinds: { main: 'llm', flash: 'llm', vision: 'llm', embed: 'embedding', rerank: 'rerank', tts: 'tts' },
  tts_aliases: { qwen_tts: 'qwen-tts' },
};

const SOURCES = [
  {
    id: 'src_a', name: 'Deepseek', kind: 'llm', provider: 'openai',
    base_url: 'https://api.deepseek.com', timeout_sec: 90, proxy: '', headers: { 'X-Tenant': 'cw' },
    models: [{ id: 'deepseek-chat', name: 'deepseek-chat', enabled: true },
             { id: 'deepseek-reasoner', name: 'deepseek-reasoner', enabled: false }],
    api_keys_masked: ['sk-a****'], key_count: 1, has_keys: true,
  },
  {
    id: 'src_b', name: '本地 Ollama', kind: 'llm', provider: 'ollama',
    models: [], key_count: 0, has_keys: false,
  },
  { id: 'src_e', name: '阿里云 Embed', kind: 'embedding', provider: 'openai', models: [{ id: 'text-embedding-v3', enabled: true }] },
];

function mockApi(roles: Record<string, unknown> = {}) {
  mocks.list.mockResolvedValue({ sources: SOURCES, roles });
  mocks.available.mockResolvedValue(AVAILABLE);
}

describe('ProvidersPage（模型提供商）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi({ main: { source_id: 'src_a', model: 'deepseek-chat' } });
  });

  it('渲染四个 tab，默认 LLM 且只显示该类型的源', async () => {
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    for (const label of ['LLM', '嵌入 Embedding', '重排序 Rerank', '语音 TTS']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.queryByText('阿里云 Embed')).toBeNull(); // embedding 源不在 LLM tab
    expect(screen.getByTestId('role-main')).toBeTruthy();
  });

  it('LLM tab 同时提供主/Flash/视觉三个角色，且提示角色在工程文件分配', async () => {
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    expect(screen.getByTestId('role-flash')).toBeTruthy();
    expect(screen.getByTestId('role-vision')).toBeTruthy();
    expect(screen.getByTestId('tab-hint').textContent).toContain('工程文件');
  });

  it('切到嵌入 tab 后只显示嵌入源与嵌入角色', async () => {
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByRole('button', { name: '嵌入 Embedding' }));
    await screen.findByTestId('source-src_e');
    expect(screen.queryByTestId('source-src_a')).toBeNull();
    expect(screen.getByTestId('role-embed')).toBeTruthy();
  });

  it('提供商下拉来自门面（含插件贡献）', async () => {
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByTestId('source-src_a'));
    const select = screen.getByTestId('f-provider') as HTMLSelectElement;
    await waitFor(() => {
      const opts = Array.from(select.options).map((o) => o.value);
      expect(opts).toEqual(['openai', 'anthropic', 'plugin-llm']);
    });
  });

  it('选中源回填设置、密钥掩码与模型清单', async () => {
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByTestId('source-src_a'));
    expect((screen.getByTestId('f-base-url') as HTMLInputElement).value).toBe('https://api.deepseek.com');
    expect((screen.getByTestId('f-timeout') as HTMLInputElement).value).toBe('90');
    expect((screen.getByTestId('f-id') as HTMLInputElement).value).toBe('src_a');
    expect((screen.getByDisplayValue('sk-a****'))).toBeTruthy();
    expect(screen.getByText(/deepseek-reasoner/)).toBeTruthy();
    expect((screen.getByTestId('role-main') as HTMLSelectElement).value).toBe('src_a');
  });

  it('新建源 → 保存 调 create（含裁剪后的负载）', async () => {
    mocks.create.mockResolvedValue({ id: 'src_new', name: 'aliyun' });
    mocks.setModels.mockResolvedValue({});
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByRole('button', { name: /新建源/ }));
    fireEvent.change(screen.getByTestId('f-name'), { target: { value: ' aliyun ' } });
    fireEvent.change(screen.getByTestId('f-base-url'), { target: { value: 'https://dashscope.aliyuncs.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^保存$/ }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      name: 'aliyun', kind: 'llm', base_url: 'https://dashscope.aliyuncs.com',
    });
  });

  it('已存在的源走 update 而不是 create', async () => {
    mocks.update.mockResolvedValue({ id: 'src_a', name: 'Deepseek' });
    mocks.setModels.mockResolvedValue({});
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByTestId('source-src_a'));
    fireEvent.click(screen.getByRole('button', { name: /^保存$/ }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('src_a', expect.any(Object)));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('模型启用开关翻转后调 upsertModel', async () => {
    mocks.upsertModel.mockResolvedValue({
      models: [{ id: 'deepseek-reasoner', name: 'deepseek-reasoner', enabled: true }],
    });
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByTestId('source-src_a'));
    fireEvent.click(screen.getByLabelText('启用 deepseek-reasoner'));
    await waitFor(() => expect(mocks.upsertModel).toHaveBeenCalledWith('src_a', {
      id: 'deepseek-reasoner', name: 'deepseek-reasoner', enabled: true,
    }));
  });

  it('删除模型调 deleteModel', async () => {
    mocks.deleteModel.mockResolvedValue({ models: [] });
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByTestId('source-src_a'));
    fireEvent.click(screen.getByLabelText('删除模型 deepseek-chat'));
    await waitFor(() => expect(mocks.deleteModel).toHaveBeenCalledWith('src_a', 'deepseek-chat'));
  });

  it('自定义模型走 upsertModel', async () => {
    mocks.upsertModel.mockResolvedValue({ models: [{ id: 'qwen-max', enabled: true }] });
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByTestId('source-src_a'));
    fireEvent.change(screen.getByTestId('new-model'), { target: { value: 'qwen-max' } });
    fireEvent.click(screen.getByRole('button', { name: /自定义模型/ }));
    await waitFor(() => expect(mocks.upsertModel).toHaveBeenCalledWith('src_a', {
      id: 'qwen-max', name: 'qwen-max', enabled: true,
    }));
  });

  it('B4：逐模型生成参数保存后随 upsertModel 提交', async () => {
    mocks.upsertModel.mockResolvedValue({
      models: [{ id: 'deepseek-chat', name: 'deepseek-chat', enabled: true,
        generation: { temperature: 0.3, max_tokens: 900 } }],
    });
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByTestId('source-src_a'));

    fireEvent.click(screen.getByLabelText('生成参数 deepseek-chat'));
    fireEvent.change(screen.getByLabelText('temperature deepseek-chat'), { target: { value: '0.3' } });
    fireEvent.change(screen.getByLabelText('max_tokens deepseek-chat'), { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: /保存参数/ }));

    await waitFor(() => expect(mocks.upsertModel).toHaveBeenCalledWith('src_a', expect.objectContaining({
      id: 'deepseek-chat',
      generation: { temperature: 0.3, max_tokens: 900 },
    })));
  });

  it('B4：非法生成参数 inline 报错且不提交', async () => {
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByTestId('source-src_a'));

    fireEvent.click(screen.getByLabelText('生成参数 deepseek-chat'));
    fireEvent.change(screen.getByLabelText('temperature deepseek-chat'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /保存参数/ }));

    const err = await screen.findByTestId('generation-error-deepseek-chat');
    expect(err.textContent).toContain('temperature');
    expect(mocks.upsertModel).not.toHaveBeenCalled();
  });

  it('「获取模型列表」为空时给出可读提示', async () => {
    mocks.fetchModels.mockResolvedValue({ models: [], note: '获取失败：timeout' });
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.click(screen.getByTestId('source-src_a'));
    fireEvent.click(screen.getByRole('button', { name: /获取模型列表/ }));
    expect(await screen.findByText('获取失败：timeout')).toBeTruthy();
  });

  it('角色分配下拉调用 setRole，模型取清单内首个启用项', async () => {
    mocks.setRole.mockResolvedValue({});
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.change(screen.getByTestId('role-flash'), { target: { value: 'src_b' } });
    await waitFor(() => expect(mocks.setRole).toHaveBeenCalledWith('flash', 'src_b', ''));
  });

  it('解绑角色传空 source_id', async () => {
    mocks.setRole.mockResolvedValue({});
    render(<ProvidersPage />);
    await screen.findByTestId('source-src_a');
    fireEvent.change(screen.getByTestId('role-main'), { target: { value: '' } });
    await waitFor(() => expect(mocks.setRole).toHaveBeenCalledWith('main', '', ''));
  });

  it('接口失败时展示错误而不是静默', async () => {
    mocks.list.mockRejectedValue(new Error('后端离线'));
    render(<ProvidersPage />);
    expect(await screen.findByText('后端离线')).toBeTruthy();
  });
});

// ── P1/P5 评审修复：模型可选 / 源级测试 / 优先级提示 / 多密钥文案 ──────────
describe('ProvidersPage 角色模型选择与源测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi({ main: { source_id: 'src_a', model: 'deepseek-chat' } });
  });

  it('角色行提供模型下拉（不再只能自动取第一个）', async () => {
    render(<ProvidersPage />);
    fireEvent.click(await screen.findByTestId('source-src_a'));
    const modelSelect = screen.getByTestId('role-model-main') as HTMLSelectElement;
    const options = Array.from(modelSelect.options).map((o) => o.value);
    // src_a 有两个模型，其中 deepseek-reasoner 已停用 → 只列启用中的
    expect(options).toEqual(['', 'deepseek-chat']);
    expect(modelSelect.value).toBe('deepseek-chat');
  });

  it('切换模型 → 以指定模型调用 setRole', async () => {
    mocks.setRole.mockResolvedValue({});
    render(<ProvidersPage />);
    fireEvent.click(await screen.findByTestId('source-src_a'));
    fireEvent.change(screen.getByTestId('role-model-main'), { target: { value: 'deepseek-chat' } });
    await waitFor(() => expect(mocks.setRole).toHaveBeenCalledWith('main', 'src_a', 'deepseek-chat'));
  });

  it('「测试连接」调 testSource 并展示结果', async () => {
    mocks.testSource.mockResolvedValue({ ok: true, latencyMs: 42, detail: '连通正常，列出 3 个模型' });
    render(<ProvidersPage />);
    fireEvent.click(await screen.findByTestId('source-src_a'));
    fireEvent.click(screen.getByTestId('test-source'));
    expect(await screen.findByText(/测试通过（42ms）/)).toBeTruthy();
  });

  it('测试未通过时给可读原因', async () => {
    mocks.testSource.mockResolvedValue({ ok: false, detail: '未取到模型列表：可能是鉴权失败' });
    render(<ProvidersPage />);
    fireEvent.click(await screen.findByTestId('source-src_a'));
    fireEvent.click(screen.getByTestId('test-source'));
    expect(await screen.findByText(/测试未通过：未取到模型列表/)).toBeTruthy();
  });

  it('页面说明「角色绑定优先于后端配置」与多密钥语义', async () => {
    render(<ProvidersPage />);
    fireEvent.click(await screen.findByTestId('source-src_a'));
    expect(screen.getByText(/覆盖/)).toBeTruthy();
    expect(screen.getByText(/第一条为当前使用/)).toBeTruthy();
  });
});
