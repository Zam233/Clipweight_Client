import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { personaApi } from '@/services/api';
import { Button, Badge } from '@/components/ui';
import { uid } from '@/lib/utils';
import type { ParameterLayer } from '@/types/persona';
import {
  ArrowLeft, Send, Sparkles, Bot, User, Check, Loader2, FileUp, Dna,
} from 'lucide-react';

interface ChatMsg { id: string; role: 'user' | 'assistant'; content: string; }
type Dimension = 'identity' | 'language' | 'rhythm' | 'visual' | 'audio' | 'constraints';
const DIMENSIONS: { key: Dimension; label: string; color: string }[] = [
  { key: 'identity', label: '身份', color: '#4F8CFF' },
  { key: 'language', label: '语言', color: '#A855F7' },
  { key: 'rhythm', label: '节奏', color: '#FBBF24' },
  { key: 'visual', label: '视觉', color: '#34D399' },
  { key: 'audio', label: '音频', color: '#F59E0B' },
  { key: 'constraints', label: '约束', color: '#FF6B6B' },
];

/**
 * PersonaForgePage — conversational persona creation. As the dialogue fills
 * each dimension, progress bars advance and a live persona draft assembles
 * in the side panel.
 */
export function PersonaForgePage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<Dimension, number>>({
    identity: 0, language: 0, rhythm: 0, visual: 0, audio: 0, constraints: 0,
  });
  const [draft, setDraft] = useState<Partial<ParameterLayer> | null>(null);
  const [personaName, setPersonaName] = useState('');
  const [kbBusy, setKbBusy] = useState(false);
  const [kbFile, setKbFile] = useState<{ name: string; total: number; current: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const kbClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (kbClearTimerRef.current) clearTimeout(kbClearTimerRef.current);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  const addMsg = (role: ChatMsg['role'], content: string) =>
    setMessages((m) => [...m, { id: uid('m'), role, content }]);

  const start = async () => {
    setBusy(true);
    addMsg('assistant', '你好！我是 PersonaForge。先描述一下你想打造的创作人格吧——比如「一个说话犀利、节奏快、爱用数据说话的科技评论人格」。');
    try {
      const res = await personaApi.chatForgeStart();
      setSessionId(res.session_id);
      if (res.persona_draft) setDraft(res.persona_draft);
      const prog = res.progress;
      if (prog) setProgress((p) => ({ ...p, ...normalizeProgress(prog) }));
    } catch {
      setSessionId(uid('forge')); // offline session
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    addMsg('user', text);
    setBusy(true);

    try {
      const res = sessionId
        ? await personaApi.chatForgeMessage(sessionId, text)
        : null;
      if (res?.persona_draft) setDraft(res.persona_draft);
      const prog = res?.progress;
      if (prog) {
        const scaled = normalizeProgress(prog);
        setProgress((p) => ({ ...p, ...scaled }));
      }
      addMsg('assistant', res?.reply ?? '收到，让我想想…');
    } catch {
      // Offline: simulate progressive persona building
      await new Promise((r) => setTimeout(r, 500));
      const filled = simulateProgress(progress, text);
      setProgress(filled.progress);
      setDraft(filled.draft);
      addMsg('assistant', filled.reply);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!personaName.trim()) return;
    setBusy(true);
    try {
      if (sessionId) await personaApi.chatForgeCommit(sessionId, personaName);
    } catch { /* offline */ }
    setBusy(false);
    navigate({ to: '/persona' });
  };

  const handleKnowledge = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sessionId) { e.target.value = ''; return; }
    const text = await file.text();
    const sections = splitByH1(text);
    setKbFile({ name: file.name, total: sections.length, current: 0 });
    setKbBusy(true);
    try {
      for (let i = 0; i < sections.length; i++) {
        setKbFile({ name: file.name, total: sections.length, current: i + 1 });
        const res = await personaApi.chatForgeKnowledge(
          sessionId,
          sections[i].content,
          file.name,
        );
        if (res.persona_draft) setDraft(res.persona_draft);
        const prog = res.progress;
        if (prog) {
          const scaled = normalizeProgress(prog);
          setProgress((p) => ({ ...p, ...scaled }));
        }
      }
      addMsg('assistant', `参考文档分析完成，共 ${sections.length} 段。`);
    } catch {
      addMsg('assistant', '参考文档上传失败，请重试。');
    } finally {
      setKbBusy(false);
      if (kbClearTimerRef.current) clearTimeout(kbClearTimerRef.current);
      kbClearTimerRef.current = setTimeout(() => setKbFile(null), 2000);
    }
    e.target.value = '';
  };

  const overall = Math.round(DIMENSIONS.reduce((s, d) => s + progress[d.key], 0) / DIMENSIONS.length);

  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-3 px-6 py-3.5 border-b border-outline-variant/25 shrink-0">
        <button onClick={() => navigate({ to: '/persona' })}
          className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
          <ArrowLeft className="w-4.5 h-4.5" />
        </button>
        <div className="w-8 h-8 rounded-cw-sm bg-primary-container flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-on-primary-container" />
        </div>
        <div>
          <h1 className="text-title-sm font-semibold text-on-surface leading-tight">PersonaForge · 对话创建</h1>
          <p className="text-caption text-on-surface-variant leading-tight">边聊边塑造你的创作人格</p>
        </div>
        <Badge variant="info" className="ml-auto font-mono">{overall}% 完成</Badge>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── chat column ── */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-outline-variant/25">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 rounded-cw-full bg-primary-container/40 border border-primary/30 flex items-center justify-center mb-4">
                  <Dna className="w-7 h-7 text-primary" />
                </div>
                <p className="text-title-sm font-semibold text-on-surface mb-1.5">打造你的数字分身</p>
                <p className="text-body-sm text-on-surface-variant max-w-[380px] leading-relaxed mb-5">
                  通过对话描述你的风格，PersonaForge 会从六个维度逐步构建人格参数。也可以上传参考文档让它分析你的作品。
                </p>
                <Button onClick={start}><Sparkles className="w-4 h-4" /> 开始对话</Button>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <span className="w-7 h-7 rounded-cw-full bg-primary-container flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-on-primary-container" />
                  </span>
                )}
                <div className={`max-w-[75%] rounded-cw-md px-3.5 py-2.5 text-body-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-primary-container text-on-primary-container rounded-br-cw-xs'
                    : 'bg-surface-container text-on-surface border border-outline-variant/20 rounded-bl-cw-xs'
                }`}>
                  {m.content}
                </div>
                {m.role === 'user' && (
                  <span className="w-7 h-7 rounded-cw-full bg-secondary-container flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5 text-secondary" />
                  </span>
                )}
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-label-sm text-on-surface-variant">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> 正在构建人格…
              </div>
            )}
          </div>

          {/* input */}
          {messages.length > 0 && (
            <div className="p-4 border-t border-outline-variant/25 shrink-0">
              <div className="flex gap-2">
                <label className="p-2.5 rounded-cw-sm bg-surface-container text-on-surface-variant hover:text-primary border border-outline-variant/30 transition-colors cursor-pointer" title="上传参考文档">
                  <FileUp className="w-4 h-4" />
                  <input type="file" className="hidden" accept=".md,.txt" onChange={handleKnowledge} disabled={kbBusy} />
                </label>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="描述这个人格的风格、语气、节奏…"
                  className="flex-1 bg-surface-container rounded-cw-sm px-3.5 py-2.5 text-body-sm text-on-surface
                    outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/50"
                />
                <Button size="icon" onClick={send} disabled={!input.trim() || busy}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── live draft panel ── */}
        <div className="w-[340px] shrink-0 flex flex-col overflow-y-auto p-5 space-y-5 bg-surface-container-low">
          <div>
            <h2 className="text-label font-medium text-on-surface-variant uppercase tracking-wide mb-3">维度完成度</h2>
            <div className="space-y-2.5">
              {DIMENSIONS.map((d) => (
                <div key={d.key}>
                  <div className="flex justify-between text-label-sm mb-1">
                    <span className="text-on-surface-variant">{d.label}</span>
                    <span className="font-mono text-on-surface-variant">{progress[d.key]}%</span>
                  </div>
                  <div className="h-1.5 bg-surface rounded-cw-full overflow-hidden">
                    <div className="h-full rounded-cw-full transition-all duration-long2"
                      style={{ width: `${progress[d.key]}%`, background: d.color }} />
                  </div>
                </div>
              ))}
              {kbFile && (
                <div>
                  <div className="flex justify-between text-label-sm mb-1">
                    <span className="text-on-surface-variant truncate max-w-[180px]">📖 {kbFile.name}</span>
                    <span className="font-mono text-on-surface-variant">{kbFile.current}/{kbFile.total}</span>
                  </div>
                  <div className="h-1.5 bg-surface rounded-cw-full overflow-hidden">
                    <div className="h-full rounded-cw-full transition-all duration-medium2 bg-track-audio animate-pulse"
                      style={{ width: `${(kbFile.current / kbFile.total) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* live draft preview */}
          <div>
            <h2 className="text-label font-medium text-on-surface-variant uppercase tracking-wide mb-2.5">人格草稿</h2>
            <div className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-3.5 space-y-2">
              {draft ? (
                <>
                  {draft.identity?.persona_name && (
                    <p className="text-body-sm font-semibold text-on-surface">{draft.identity.persona_name}</p>
                  )}
                  {draft.identity?.tone && (
                    <p className="text-label-sm text-on-surface-variant">语气：<span className="text-primary font-mono">{draft.identity.tone}</span></p>
                  )}
                  {draft.rhythm?.cut_density_tier && (
                    <p className="text-label-sm text-on-surface-variant">剪切密度：<span className="text-primary font-mono">{draft.rhythm.cut_density_tier}</span></p>
                  )}
                  {draft.visual?.animation_style && (
                    <p className="text-label-sm text-on-surface-variant">动画风格：<span className="text-primary">{draft.visual.animation_style}</span></p>
                  )}
                  {draft.language?.academic_density != null && (
                    <p className="text-label-sm text-on-surface-variant">学术密度：<span className="text-primary font-mono">{draft.language.academic_density}</span></p>
                  )}
                </>
              ) : (
                <p className="text-label-sm text-on-surface-variant/60">随着对话进行，人格草稿会在这里实时成形。</p>
              )}
            </div>
          </div>

          {/* commit */}
          <div className="mt-auto pt-3 border-t border-outline-variant/25 space-y-2.5">
            <input
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              placeholder="人格名称，如「老陈·数码毒舌」"
              className="w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
                outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/50"
            />
            <Button className="w-full" onClick={commit} disabled={overall < 40 || !personaName.trim() || busy}>
              <Check className="w-4 h-4" /> 保存人格
            </Button>
            {overall < 40 && (
              <p className="text-caption text-on-surface-variant/60 text-center">完成度达 40% 后可保存</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Offline simulation: each user message advances 1-2 dimensions. */
function simulateProgress(
  prev: Record<Dimension, number>,
  userText: string,
): { progress: Record<Dimension, number>; draft: Partial<ParameterLayer>; reply: string } {
  const order: Dimension[] = ['identity', 'language', 'rhythm', 'visual', 'audio', 'constraints'];
  const next = { ...prev };
  // advance the least-filled dimension(s)
  const sorted = [...order].sort((a, b) => next[a] - next[b]);
  const bump = sorted[0];
  next[bump] = Math.min(100, next[bump] + 34 + Math.round(Math.random() * 12));
  if (Math.random() > 0.5 && next[sorted[1]] < 100) {
    next[sorted[1]] = Math.min(100, next[sorted[1]] + 25);
  }

  const draft: Partial<ParameterLayer> = {
    identity: { persona_id: 'forging', persona_name: '新人格', version: '0.1.0', tone: 'critical', knowledge_domains: ['科技'] },
    language: next.language > 30 ? { max_sentence_length: 20, academic_density: 0.6, slang_ratio: 0.25 } : undefined,
    rhythm: next.rhythm > 30 ? { cut_density_tier: 'high', base_shot_duration_sec: 5 } : undefined,
    visual: next.visual > 30 ? { animation_style: '关键词标注', color_palette: { primary: '#1a1a2e', accent: '#e94560' } } : undefined,
    audio: next.audio > 30 ? { loudness_target_lufs: -15 } : undefined,
    constraints: next.constraints > 30 ? { max_duration_sec: 720 } : undefined,
  };

  const replies: Record<Dimension, string> = {
    identity: '明白了，这个人格的定位和语气我记下了。它主要聊哪些领域？',
    language: '好的，语言风格已捕捉——措辞密度和句式节奏我会按这个来。它的剪辑节奏偏快还是偏慢？',
    rhythm: '收到，节奏感很清晰。视觉上它偏好什么动画风格和配色？',
    visual: '视觉基调已定。音频方面呢——BGM 是铺垫型还是节奏骨架型？响度目标大概多少？',
    audio: '音频参数记好了。最后，有什么硬性约束吗？比如最长时长、是否必须标注来源。',
    constraints: '约束已记录。人格画像基本完整了，给它起个名字就可以保存啦。',
  };
  return { progress: next, draft, reply: replies[bump] };
}

const KB_CHUNK_LIMIT = 6000;

function normalizeProgress(prog: Record<string, number>): Record<string, number> {
  const vals = Object.values(prog).filter((v) => v > 0);
  if (vals.length === 0) return prog;
  if (vals.every((v) => v <= 1)) {
    const scaled: Record<string, number> = {};
    for (const [k, v] of Object.entries(prog)) {
      scaled[k] = Math.round(v * 100);
    }
    return scaled;
  }
  return prog;
}

function splitByH1(text: string): { heading: string; content: string }[] {
  if (text.length <= KB_CHUNK_LIMIT) return [{ heading: '', content: text }];
  const sections = text.split(/^# /m);
  const chunks: { heading: string; content: string }[] = [];
  for (const section of sections) {
    if (!section.trim()) continue;
    const lines = section.split('\n');
    const heading = lines[0].trim();
    const body = lines.slice(1).join('\n').trim();
    const chunkContent = heading ? `# ${heading}\n\n${body}` : body;
    chunks.push({
      heading: heading || `section_${chunks.length + 1}`,
      content: chunkContent.length > KB_CHUNK_LIMIT ? chunkContent.slice(0, KB_CHUNK_LIMIT) : chunkContent,
    });
  }
  return chunks.length ? chunks : [{ heading: '', content: text.slice(0, KB_CHUNK_LIMIT) }];
}
