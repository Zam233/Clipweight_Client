// @vitest-environment jsdom
/**
 * PersonaForgePage 的 ChatForge 历史欠账回归：
 * 1. 会话 id 本地持久化（刷新/离开后仍能恢复）；
 * 2. 会话列表（后端 GET /sessions）——切换与删除；
 * 3. 知识库管理——列出 / 编辑 / 删除；
 * 4. 图片附件——选择后进入待发送队列，随消息发给后端并在气泡里渲染缩略图。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  chatForgeStart: vi.fn(),
  chatForgeMessage: vi.fn(),
  chatForgeState: vi.fn(),
  chatForgeKnowledge: vi.fn(),
  chatForgeSessions: vi.fn(),
  chatForgeDeleteSession: vi.fn(),
  chatForgeKnowledgeList: vi.fn(),
  chatForgeKnowledgeGet: vi.fn(),
  chatForgeKnowledgeUpdate: vi.fn(),
  chatForgeKnowledgeDelete: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/stores/toastStore', () => ({ toast: mocks.toast }));
vi.mock('@/services/api', () => ({
  personaApi: {
    chatForgeStart: mocks.chatForgeStart,
    chatForgeMessage: mocks.chatForgeMessage,
    chatForgeState: mocks.chatForgeState,
    chatForgeKnowledge: mocks.chatForgeKnowledge,
    chatForgeCommit: vi.fn(),
    chatForgeSessions: mocks.chatForgeSessions,
    chatForgeDeleteSession: mocks.chatForgeDeleteSession,
    chatForgeKnowledgeList: mocks.chatForgeKnowledgeList,
    chatForgeKnowledgeGet: mocks.chatForgeKnowledgeGet,
    chatForgeKnowledgeUpdate: mocks.chatForgeKnowledgeUpdate,
    chatForgeKnowledgeDelete: mocks.chatForgeKnowledgeDelete,
  },
}));

import { PersonaForgePage } from './PersonaForgePage';

function emptyState() {
  return {
    chatForgeSessions: { sessions: [], total: 0 },
    chatForgeKnowledgeList: { items: [], total: 0 },
    chatForgeStart: { session_id: 'sess_abc123456', persona_draft: {}, progress: {} },
    chatForgeMessage: { reply: '好的', persona_draft: {}, progress: {} },
    chatForgeState: { session_id: 'sess_old1', message_count: 2, knowledge_base_count: 1 },
  };
}

describe('PersonaForgePage · ChatForge 欠账', () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    // jsdom 没有实现 Element.scrollTo（页面滚动到底部用它）
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
    Object.values(mocks).forEach((m) => { if (typeof m === 'function' && 'mockReset' in m) (m as ReturnType<typeof vi.fn>).mockReset(); });
    const state = emptyState();
    mocks.chatForgeSessions.mockResolvedValue(state.chatForgeSessions);
    mocks.chatForgeKnowledgeList.mockResolvedValue(state.chatForgeKnowledgeList);
    mocks.chatForgeStart.mockResolvedValue(state.chatForgeStart);
    mocks.chatForgeMessage.mockResolvedValue(state.chatForgeMessage);
    mocks.chatForgeState.mockResolvedValue(state.chatForgeState);
  });

  it('会话 id 写入 localStorage，下次进入自动填回恢复框', async () => {
    const first = render(<PersonaForgePage />);
    fireEvent.click(screen.getByText('开始对话'));
    await waitFor(() => expect(mocks.chatForgeStart).toHaveBeenCalled());
    await waitFor(() => {
      expect(localStorage.getItem('clipwright.forgeSessionId')).toBe('sess_abc123456');
    });
    first.unmount();
    cleanup();

    // 重新挂载（模拟刷新）：恢复框里应带出上次的会话 id
    render(<PersonaForgePage />);
    await waitFor(() => {
      const input = screen.getByPlaceholderText('会话 ID（恢复后端历史会话）') as HTMLInputElement;
      expect(input.value).toBe('sess_abc123456');
    });
    expect(screen.getByText(/上次会话/)).toBeTruthy();
  });

  it('历史会话列表可列出、切换、删除', async () => {
    mocks.chatForgeSessions.mockResolvedValue({
      sessions: [
        { session_id: 'sess_old1', title: '冷峻学术风', message_count: 2, knowledge_count: 1,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', progress: {} },
      ],
      total: 1,
    });
    render(<PersonaForgePage />);
    fireEvent.click(screen.getByText('历史会话'));
    await waitFor(() => expect(screen.getByTestId('session-list')).toBeTruthy());
    expect(screen.getByText('冷峻学术风')).toBeTruthy();

    // 切换：调用 state 并把消息清空后写入提示
    fireEvent.click(screen.getByText('冷峻学术风'));
    await waitFor(() => expect(mocks.chatForgeState).toHaveBeenCalledWith('sess_old1'));
    await waitFor(() => expect(screen.getByText(/已切到会话/)).toBeTruthy());

    // 删除：调用 DELETE 并从列表移除
    fireEvent.click(screen.getByText('历史会话'));
    await waitFor(() => expect(screen.getByTestId('session-list')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('删除会话 sess_old1'));
    await waitFor(() => expect(mocks.chatForgeDeleteSession).toHaveBeenCalledWith('sess_old1'));
    await waitFor(() => expect(screen.queryByText('冷峻学术风')).toBeNull());
  });

  it('知识库面板：列出 → 编辑保存 → 删除', async () => {
    mocks.chatForgeKnowledgeList.mockResolvedValue({
      items: [{ id: 'kb_1', source: 'ref.md', chars: 12, preview: '参考正文开头' }],
      total: 1,
    });
    mocks.chatForgeKnowledgeGet.mockResolvedValue({ id: 'kb_1', source: 'ref.md', content: '参考正文全文' });
    mocks.chatForgeKnowledgeUpdate.mockResolvedValue({ id: 'kb_1', source: 'ref2.md', content: '改后的正文' });
    mocks.chatForgeKnowledgeDelete.mockResolvedValue({ deleted: true, id: 'kb_1' });

    render(<PersonaForgePage />);
    fireEvent.click(screen.getByText('开始对话'));
    // 会话建立后空态按钮消失，等 sessionId 落盘即可
    await waitFor(() => expect(localStorage.getItem('clipwright.forgeSessionId')).toBeTruthy());

    // 打开管理面板
    fireEvent.click(screen.getByText('管理'));
    await waitFor(() => expect(screen.getByTestId('knowledge-panel')).toBeTruthy());
    expect(screen.getByText('ref.md')).toBeTruthy();

    // 编辑
    fireEvent.click(screen.getByLabelText('编辑 ref.md'));
    await waitFor(() => expect(mocks.chatForgeKnowledgeGet).toHaveBeenCalledWith('sess_abc123456', 'kb_1'));
    const textarea = await screen.findByDisplayValue('参考正文全文');
    fireEvent.change(textarea, { target: { value: '改后的正文' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(mocks.chatForgeKnowledgeUpdate).toHaveBeenCalledWith(
      'sess_abc123456', 'kb_1', { content: '改后的正文', source: 'ref.md' },
    ));

    // 删除
    fireEvent.click(screen.getByLabelText('删除 ref.md'));
    await waitFor(() => expect(mocks.chatForgeKnowledgeDelete).toHaveBeenCalledWith('sess_abc123456', 'kb_1'));
  });

  it('图片附件进入待发送队列，随消息发给后端并渲染缩略图', async () => {
    render(<PersonaForgePage />);
    fireEvent.click(screen.getByText('开始对话'));
    await waitFor(() => expect(localStorage.getItem('clipwright.forgeSessionId')).toBeTruthy());

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'ref.png', { type: 'image/png' });
    const input = screen.getByTestId('attachment-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => expect(screen.getByTestId('pending-attachments')).toBeTruthy());
    expect(screen.getByText('ref.png')).toBeTruthy();

    const chatInput = screen.getByPlaceholderText('描述这个人格的风格、语气、节奏…');
    fireEvent.change(chatInput, { target: { value: '参考这张图的风格' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(mocks.chatForgeMessage).toHaveBeenCalled());

    const [, message, attachments] = mocks.chatForgeMessage.mock.calls[0];
    expect(message).toBe('参考这张图的风格');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ type: 'image', name: 'ref.png', mime: 'image/png' });
    expect(String(attachments[0].data_url)).toMatch(/^data:image\/png;base64,/);

    // 气泡里出现缩略图，待发送队列被清空
    await waitFor(() => expect(screen.getByTestId('msg-attachments')).toBeTruthy());
    expect(screen.queryByTestId('pending-attachments')).toBeNull();
  });

  it('只有附件、没有文字时也能发送（消息体给出默认说明）', async () => {
    render(<PersonaForgePage />);
    fireEvent.click(screen.getByText('开始对话'));
    await waitFor(() => expect(localStorage.getItem('clipwright.forgeSessionId')).toBeTruthy());

    const file = new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [file] } });
    });
    await waitFor(() => expect(screen.getByTestId('pending-attachments')).toBeTruthy());

    const sendButton = screen.getByTestId('chat-send');
    expect((sendButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(sendButton);
    await waitFor(() => expect(mocks.chatForgeMessage).toHaveBeenCalled());
    expect(mocks.chatForgeMessage.mock.calls[0][1]).toBe('请参考我上传的附件');
  });

  it('超过 4 个附件在客户端就被拦下（toast 提示，不进队列）', async () => {
    render(<PersonaForgePage />);
    fireEvent.click(screen.getByText('开始对话'));
    await waitFor(() => expect(localStorage.getItem('clipwright.forgeSessionId')).toBeTruthy());

    const files = Array.from({ length: 6 }, (_, i) =>
      new File([new Uint8Array([1])], `f${i}.png`, { type: 'image/png' }));
    await act(async () => {
      fireEvent.change(screen.getByTestId('attachment-input'), { target: { files } });
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(String(mocks.toast.mock.calls[0][0])).toContain('最多');
  });
});
