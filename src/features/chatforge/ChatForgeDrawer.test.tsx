// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ChatForgeDrawer } from './ChatForgeDrawer';

const { api } = vi.hoisted(() => ({
  api: { startPromptSession: vi.fn(), message: vi.fn(), commitPrompt: vi.fn() },
}));

vi.mock('@/services/api/chatForge', () => ({ chatForgeApi: api }));

afterEach(() => cleanup());

describe('ChatForgeDrawer（F-05）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.startPromptSession.mockResolvedValue({ session_id: 's1', scope: 'mv_prompt' });
    api.message.mockResolvedValue({ reply: '好的，要什么节奏？' });
    api.commitPrompt.mockResolvedValue({
      prompt: '版画质感，三墨套印，硬切为主',
      avoid: ['花哨转场'],
      rationale: '依据对话',
      degraded: false,
      source_messages: 2,
      session_id: 's1',
    });
  });

  it('发送消息后显示回复', async () => {
    render(<ChatForgeDrawer context={{ type: 'lyric_mv' }} onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('chatforge-input'), { target: { value: '要版画质感' } });
    fireEvent.click(screen.getByText('发送'));
    await waitFor(() => expect(screen.getByText('好的，要什么节奏？')).toBeTruthy());
    expect(api.startPromptSession).toHaveBeenCalledWith({ type: 'lyric_mv' });
  });

  it('蒸馏后回填 prompt 与 avoid', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<ChatForgeDrawer context={{}} onApply={onApply} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('chatforge-input'), { target: { value: '要版画质感' } });
    fireEvent.click(screen.getByText('发送'));
    await waitFor(() => expect(screen.getByText('好的，要什么节奏？')).toBeTruthy());
    fireEvent.click(screen.getByText('蒸馏为提示词'));
    await waitFor(() => expect(screen.getByText('版画质感，三墨套印，硬切为主')).toBeTruthy());
    fireEvent.click(screen.getByText('填入提示词区'));
    expect(onApply).toHaveBeenCalledWith({
      prompt: '版画质感，三墨套印，硬切为主',
      avoid: ['花哨转场'],
      sessionId: 's1',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('没有消息时蒸馏给出提示而不调接口', async () => {
    render(<ChatForgeDrawer context={{}} onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('蒸馏为提示词'));
    await waitFor(() => expect(screen.getByText('先聊两句再蒸馏')).toBeTruthy());
    expect(api.commitPrompt).not.toHaveBeenCalled();
  });

  it('对话服务不可用时降级提示，不阻塞手填', async () => {
    api.startPromptSession.mockRejectedValue(new Error('down'));
    render(<ChatForgeDrawer context={{}} onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('chatforge-input'), { target: { value: '要版画' } });
    fireEvent.click(screen.getByText('发送'));
    await waitFor(() =>
      expect(screen.getByText('对话服务不可用，可继续手填提示词')).toBeTruthy(),
    );
    // 会话建不起来时不应该再打消息接口（不假装成功）
    expect(api.message).not.toHaveBeenCalled();
  });

  it('规则兜底时明确标注未用 LLM', async () => {
    api.commitPrompt.mockResolvedValue({
      prompt: '硬切为主',
      avoid: [],
      rationale: '规则蒸馏',
      degraded: true,
      source_messages: 1,
      session_id: 's1',
    });
    render(<ChatForgeDrawer context={{}} onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('chatforge-input'), { target: { value: '硬切' } });
    fireEvent.click(screen.getByText('发送'));
    await waitFor(() => expect(screen.getByText('好的，要什么节奏？')).toBeTruthy());
    fireEvent.click(screen.getByText('蒸馏为提示词'));
    await waitFor(() => expect(screen.getByText('规则兜底（未用 LLM）')).toBeTruthy());
  });
});
