import { useState } from 'react';
import { Button } from '@/components/ui';
import { chatForgeApi, type ChatPromptMessage } from '@/services/api/chatForge';

interface Props {
  /** 当前工程上下文（歌曲/类型/已填提示词/素材摘要），开屏注入。 */
  context: Record<string, unknown>;
  /** 用户点「填入提示词区」时回填（含 avoid）。 */
  onApply: (payload: { prompt: string; avoid: string[]; sessionId: string }) => void;
  onClose: () => void;
}

/**
 * ChatForge 抽屉（PRD §II.12 R3/R4）。
 *
 * 只做两件事：**陪聊磨提示词**、**把结论蒸馏成 prompt + avoid 并回填**。
 * 不做"对话即出片"，也不允许在对话里改时间线（R6）。
 */
export function ChatForgeDrawer({ context, onApply, onClose }: Props) {
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<ChatPromptMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<{ prompt: string; avoid: string[]; degraded: boolean; rationale: string } | null>(null);

  const ensureSession = async (): Promise<string | null> => {
    if (sessionId) return sessionId;
    try {
      const session = await chatForgeApi.startPromptSession(context);
      setSessionId(session.session_id);
      return session.session_id;
    } catch {
      return null;
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setNotice('');
    const nextMessages: ChatPromptMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    try {
      const sid = await ensureSession();
      if (!sid) {
        // R5：对话服务不可用时不假装成功，也不阻塞手填
        setNotice('对话服务不可用，可继续手填提示词');
        return;
      }
      const reply = await chatForgeApi.message(sid, text);
      setMessages([...nextMessages, { role: 'assistant', content: reply.reply ?? '' }]);
    } catch {
      setNotice('发送失败：对话服务不可达');
    } finally {
      setBusy(false);
    }
  };

  const distill = async () => {
    if (!messages.length) {
      setNotice('先聊两句再蒸馏');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await chatForgeApi.commitPrompt(messages, { sessionId });
      setDraft({
        prompt: result.prompt,
        avoid: result.avoid,
        degraded: result.degraded,
        rationale: result.rationale,
      });
    } catch {
      setNotice('蒸馏失败：可手动填写提示词');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="w-full max-w-md h-full bg-surface-container border-l border-outline-variant/40 p-4 flex flex-col"
        onClick={(event) => event.stopPropagation()}
        aria-label="对话打磨提示词"
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-title-sm font-semibold text-on-surface">对话打磨提示词</h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface cursor-pointer caption">
            关闭
          </button>
        </div>
        <p className="font-mono text-caption text-on-surface-variant mb-3">
          聊完点「蒸馏为提示词」，结论可回填到提示词区
        </p>

        {notice && (
          <div className="bg-warning/10 border border-warning/30 rounded-cw-xs px-2.5 py-1.5 mb-3">
            <span className="font-mono text-caption text-warning">{notice}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 mb-3" data-testid="chatforge-messages">
          {messages.length === 0 && (
            <p className="font-mono text-caption text-on-surface-variant">
              例：我想要一支版画质感的 MV，三墨套印，不要花哨转场
            </p>
          )}
          {messages.map((message, index) => (
            <div
              key={index}
              className={
                message.role === 'user'
                  ? 'bg-primary/10 border border-primary/30 rounded-cw-xs px-2.5 py-1.5 ml-6'
                  : 'bg-surface rounded-cw-xs px-2.5 py-1.5 mr-6'
              }
            >
              <span className="font-mono text-caption text-on-surface-variant">{message.role}</span>
              <p className="text-label-sm text-on-surface mt-0.5 whitespace-pre-wrap">{message.content}</p>
            </div>
          ))}
        </div>

        {draft && (
          <div className="border border-outline-variant/40 rounded-cw-sm p-2.5 mb-3 space-y-2">
            <p className="text-label text-on-surface-variant">蒸馏结果</p>
            <p className="text-label-sm text-on-surface whitespace-pre-wrap">{draft.prompt || '（空）'}</p>
            {draft.avoid.length > 0 && (
              <p className="font-mono text-caption text-warning">避免：{draft.avoid.join('；')}</p>
            )}
            {draft.degraded && (
              <p className="font-mono text-caption text-on-surface-variant">规则兜底（未用 LLM）</p>
            )}
            <Button
              size="sm"
              onClick={() => {
                onApply({ prompt: draft.prompt, avoid: draft.avoid, sessionId });
                onClose();
              }}
            >
              填入提示词区
            </Button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            aria-label="chatforge-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void send();
            }}
            placeholder="说说你想要什么片子"
            className="flex-1 bg-surface rounded-cw-xs px-2.5 py-2 text-label-sm text-on-surface border border-outline-variant/40 focus:border-primary outline-none"
          />
          <Button size="sm" onClick={send} disabled={busy}>
            {busy ? '…' : '发送'}
          </Button>
          <Button size="sm" variant="outline" onClick={distill} disabled={busy}>
            蒸馏为提示词
          </Button>
        </div>
      </aside>
    </div>
  );
}

export default ChatForgeDrawer;
