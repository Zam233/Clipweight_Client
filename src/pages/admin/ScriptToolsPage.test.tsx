// @vitest-environment jsdom
/**
 * PRD B4（2026-10-29 / G14）：三条后端已有、前端此前无客户端的能力。
 *
 * 断言的是**契约与边界**，不是"页面能渲染"：
 * 1. URL / payload 与后端签名一致（run-batch / script-tools / topic-suggest）；
 * 2. 脚本工具页 `fallback=true` 必须显式说出来（不装作处理成功）；
 * 3. 结果只读预览，不自动写入时间线、不启动任务。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { pipelineApi } from '@/services/api';
import { ScriptToolsPage } from '@/pages/admin/ScriptToolsPage';

const { mocks } = vi.hoisted(() => ({
  mocks: { post: vi.fn(), get: vi.fn() },
}));

vi.mock('@/services/api/client', () => ({
  getApiClient: () => ({ post: mocks.post, get: mocks.get }),
}));

vi.mock('@/services/api/sse', () => ({ apiBase: () => 'http://api.test' }));

vi.mock('@/services/api', async () => {
  const mod = await import('@/services/api/pipeline');
  // ConsoleShell 会打健康检查——页面测试同时需要它
  return { pipelineApi: mod.pipelineApi, healthApi: { check: vi.fn(async () => ({ status: 'ok' })) } };
});

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/settings/script-tools' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('@/features/plugins/usePluginSlots', () => ({ usePluginSlots: () => [] }));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockResolvedValue({ data: {} });
});

describe('B4 pipeline 客户端契约', () => {
  it('runBatch 发 {requests}，并规范化 results', async () => {
    mocks.post.mockResolvedValue({
      data: { results: [{ ok: true, topic: 'A', pipeline_id: 'pl_1' }, { ok: false, topic: 'B', error: '410' }] },
    });
    const res = await pipelineApi.runBatch([{ topic: 'A' }, { topic: 'B' }]);
    expect(mocks.post).toHaveBeenCalledWith('/api/pipeline/run-batch', {
      requests: [{ topic: 'A' }, { topic: 'B' }],
    });
    expect(res.results).toHaveLength(2);
    expect(res.results[1].ok).toBe(false);
  });

  it('scriptTools 保留 fallback 标记（LLM 不可用时不撒谎）', async () => {
    mocks.post.mockResolvedValue({
      data: { mode: 'expand', result: '原文', fallback: true, note: 'LLM 不可用，未扩写' },
    });
    const res = await pipelineApi.scriptTools({ mode: 'expand', script_text: '原文' });
    expect(mocks.post).toHaveBeenCalledWith('/api/pipeline/script-tools', {
      mode: 'expand', script_text: '原文',
    });
    expect(res.fallback).toBe(true);
    expect(res.note).toBe('LLM 不可用，未扩写');
  });

  it('topicSuggest 只返回有 title 的条目，并补默认参数', async () => {
    mocks.post.mockResolvedValue({
      data: { topics: [{ title: '选题一', reason: '有热度' }, { reason: '没有标题' }] },
    });
    const res = await pipelineApi.topicSuggest({ category: 'vlog' });
    expect(mocks.post).toHaveBeenCalledWith('/api/pipeline/topic-suggest', {
      category: 'vlog', count: 5, use_web: false,
    });
    expect(res.topics).toEqual([{ title: '选题一', reason: '有热度' }]);
  });
});

describe('B4 脚本工具页', () => {
  it('提交后展示结果，且不提示已写入时间线', async () => {
    mocks.post.mockResolvedValue({ data: { mode: 'rewrite', result: '改写后的稿子' } });
    render(<ScriptToolsPage />);

    fireEvent.change(screen.getByTestId('script-input'), { target: { value: '原始口播稿' } });
    fireEvent.click(screen.getByRole('button', { name: /开始处理/ }));

    expect(await screen.findByTestId('script-result')).toBeTruthy();
    expect(screen.getByTestId('script-result').textContent).toContain('改写后的稿子');
    expect(mocks.post).toHaveBeenCalledWith('/api/pipeline/script-tools', {
      mode: 'rewrite', script_text: '原始口播稿',
    });
    expect(screen.queryByTestId('script-fallback')).toBeNull();
    // 页面明说这是只读预览
    expect(screen.getByText(/不会自动写入时间线或启动任务/)).toBeTruthy();
  });

  it('fallback（LLM 不可用）显式提示，不装作处理成功', async () => {
    mocks.post.mockResolvedValue({
      data: { mode: 'expand', result: '原文', fallback: true, note: 'LLM 不可用，未扩写' },
    });
    render(<ScriptToolsPage />);
    fireEvent.click(screen.getByTestId('script-mode-expand'));
    fireEvent.change(screen.getByTestId('script-input'), { target: { value: '原文' } });
    fireEvent.click(screen.getByRole('button', { name: /开始处理/ }));

    const note = await screen.findByTestId('script-fallback');
    expect(note.textContent).toContain('未扩写');
  });

  it('空文稿不提交；后端错误可读', async () => {
    render(<ScriptToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: /开始处理/ }));
    expect(await screen.findByTestId('script-error')).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();

    cleanup();
    mocks.post.mockRejectedValue({ response: { data: { detail: 'mode 必须为 rewrite/expand/summarize' } } });
    render(<ScriptToolsPage />);
    fireEvent.change(screen.getByTestId('script-input'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /开始处理/ }));
    await waitFor(() => expect(screen.getByTestId('script-error').textContent).toContain('mode 必须为'));
  });
});
