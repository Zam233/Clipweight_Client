import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { personaApi } from '@/services/api';
import { Button, Badge } from '@/components/ui';
import { uid } from '@/lib/utils';
import { toast } from '@/stores/toastStore';
import type { ParameterLayer, Persona } from '@/types/persona';
import {
  ArrowLeft, Send, Sparkles, Bot, User, Check, Loader2, Dna,
  FileText, MessageCircleQuestion, Wand2, RotateCcw, ExternalLink,
  ImagePlus, Trash2, Pencil, History, X, Plus,
} from 'lucide-react';

/** 会话内附带的图片（data URL，前端可直接渲染缩略图） */
interface ChatAttachment {
  type: 'image' | 'file'; name: string; mime: string;
  data_url?: string; id?: string; storage_ref?: string;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 本轮随消息上传的附件（只用于渲染，后端也已存一份） */
  attachments?: ChatAttachment[];
}

/** 会话状态浮层里的知识条目 */
interface KnowledgeItem { id: string; source: string; chars: number; preview: string }

/** 会话列表条目 */
interface ForgeSessionItem {
  session_id: string;
  title: string;
  message_count: number;
  knowledge_count: number;
  created_at: string;
  updated_at: string;
  progress: Record<string, number>;
}

/** 会话 id 的本地持久化键（历史欠账：原先刷新即丢会话） */
const FORGE_SESSION_KEY = 'clipwright.forgeSessionId';
/** 前端侧的附件上限（与后端 ChatForge.MAX_ATTACHMENTS / MAX_ATTACHMENT_CHARS 对齐） */
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const KB_CHUNK_LIMIT = 6000;
type Dimension = 'identity' | 'language' | 'rhythm' | 'visual' | 'audio' | 'constraints';
const DIMENSIONS: { key: Dimension; label: string; color: string }[] = [
  { key: 'identity', label: '身份', color: '#4F8CFF' },
  { key: 'language', label: '语言', color: '#A855F7' },
  { key: 'rhythm', label: '节奏', color: '#FBBF24' },
  { key: 'visual', label: '视觉', color: '#34D399' },
  { key: 'audio', label: '音频', color: '#F59E0B' },
  { key: 'constraints', label: '约束', color: '#FF6B6B' },
];

/** GET /api/persona/forge/chat/state/{session} 的响应结构 */
interface ChatForgeStateResp {
  session_id?: string;
  message_count?: number;
  persona_draft?: unknown;
  knowledge_base_count?: number;
}

/**
 * PersonaForgePage — conversational persona creation + extended forge modes.
 * - chat: 对话式创建（含会话状态恢复）
 * - prompt: 从自然语言提示词生成（POST /from-prompt）
 * - script: 从脚本/口播文本生成（POST /from-script）
 * - dialogue: 引导问答生成（POST /dialogue/generate-questions + /dialogue/build）
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
  const [promptDraft, setPromptDraft] = useState('');
  const [sessionRevision, setSessionRevision] = useState(0);
  const [patchOpen, setPatchOpen] = useState(false);
  const [patchTone, setPatchTone] = useState('');
  const [patchAcademic, setPatchAcademic] = useState('');
  const [patchSaving, setPatchSaving] = useState(false);
  const [visionPromptDraft, setVisionPromptDraft] = useState('');
  const [personaName, setPersonaName] = useState('');
  const [kbBusy, setKbBusy] = useState(false);
  const [kbFile, setKbFile] = useState<{ name: string; total: number; current: number } | null>(null);
  const [restoreId, setRestoreId] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState('');
  // 待发送附件（图片/文件）与知识库面板 / 会话列表面板
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [editingKb, setEditingKb] = useState<{ id: string; source: string; content: string } | null>(null);
  const [kbPanelOpen, setKbPanelOpen] = useState(false);
  const [sessions, setSessions] = useState<ForgeSessionItem[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const kbClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 会话 id 持久化（历史欠账：原先刷新/离开即丢，只能靠手抄 id 恢复）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FORGE_SESSION_KEY);
      if (saved) {
        setRestoreId(saved);
        setRestoreMsg(`上次会话 ${saved.slice(0, 12)}（点击「恢复会话」继续）`);
      }
    } catch { /* 隐私模式：忽略 */ }
  }, []);

  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem(FORGE_SESSION_KEY, sessionId);
    } catch { /* ignore */ }
  }, [sessionId]);

  /** 拉取知识库条目（面板打开时 / 增删改后） */
  const refreshKnowledge = async (sid: string | null = sessionId) => {
    if (!sid) return;
    try {
      const res = await personaApi.chatForgeKnowledgeList(sid);
      setKnowledge(res.items ?? []);
      setKbPanelOpen(true);
    } catch {
      toast('知识库读取失败：后端不可达', 'error');
    }
  };

  /** 拉取会话列表（历史欠账：后端原先没有列表端点） */
  const refreshSessions = async () => {
    try {
      const res = await personaApi.chatForgeSessions('mine');
      setSessions(res.sessions ?? []);
      setSessionsOpen(true);
    } catch {
      toast('会话列表读取失败：后端不可达', 'error');
    }
  };

  useEffect(() => { void refreshSessions(); }, []);

  // 挂载时若 URL 带 ?session= 则自动恢复后端会话状态（GET /state/{session}）
  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get('session');
    if (!sid) return;
    let alive = true;
    (async () => {
      setRestoreBusy(true);
      try {
        const detail = await personaApi.chatForgeDetail(sid);
        if (!alive) return;
        await applySessionDetail(detail, true);
        setRestoreMsg(`会话 ${detail.session_id} 已恢复`);
      } catch {
        if (alive) setRestoreMsg('恢复失败：会话不存在或后端不可达');
      } finally {
        if (alive) setRestoreBusy(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => () => {
    if (kbClearTimerRef.current) clearTimeout(kbClearTimerRef.current);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  const addMsg = (role: ChatMsg['role'], content: string, attachments?: ChatAttachment[]) =>
    setMessages((m) => [...m, { id: uid('m'), role, content, ...(attachments?.length ? { attachments } : {}) }]);

  /** 用详情接口恢复真实消息/草稿/Prompt；replace=true 时重建消息列表。 */
  const applySessionDetail = async (
    detail: Awaited<ReturnType<typeof personaApi.chatForgeDetail>>,
    replace: boolean,
  ) => {
    setSessionId(detail.session_id);
    setSessionRevision(Number((detail as { revision?: number }).revision ?? 0));
    if (detail.persona_draft) {
      setDraft(detail.persona_draft as Partial<ParameterLayer>);
      setProgress(estimateProgressFromDraft(detail.persona_draft));
    }
    setPromptDraft(detail.prompt_draft ?? '');
    setVisionPromptDraft(detail.vision_prompt_draft ?? '');
    if (replace) {
      const mapped = await Promise.all((detail.messages ?? []).map(async (m) => {
        const attachments = await Promise.all((m.attachments ?? []).map(async (a) => {
          let url = a.data_url;
          if (!url && a.id) {
            try { url = await personaApi.chatForgeAttachment(detail.session_id, a.id); } catch { url = undefined; }
          }
          return { ...a, name: a.name ?? '', mime: a.mime ?? '', data_url: url };
        }));
        return {
          id: uid('m'), role: m.role, content: m.content,
          ...(attachments.length ? { attachments } : {}),
        };
      }));
      setMessages(mapped);
    }
  };

  const handleRestore = async () => {
    const sid = restoreId.trim();
    if (!sid || restoreBusy) return;
    setRestoreBusy(true);
    setRestoreMsg('');
    try {
      const detail = await personaApi.chatForgeDetail(sid);
      await applySessionDetail(detail, true);
      setRestoreMsg(`会话 ${detail.session_id} 已恢复`);
    } catch {
      setRestoreMsg('恢复失败：会话不存在或后端不可达');
    } finally {
      setRestoreBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setMessages([]);
    setDraft(null);
    setPromptDraft('');
    addMsg('assistant', '你好！我是 PersonaForge。先描述一下你想打造的创作人格吧——比如「一个说话犀利、节奏快、爱用数据说话的科技评论人格」。');
    try {
      const res = await personaApi.chatForgeStart();
      setSessionId(res.session_id);
      if (res.persona_draft) setDraft(res.persona_draft);
      const prog = res.progress;
      if (prog) setProgress((p) => ({ ...p, ...normalizeProgress(prog) }));
    } catch {
      setMessages([]);
      toast('会话启动失败：后端未连接或请求被拒绝', 'error');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;
    const outgoing = attachments
      .filter((a): a is ChatAttachment & { data_url: string } => Boolean(a.data_url))
      .map((a) => ({ type: a.type, name: a.name, mime: a.mime, data_url: a.data_url }));
    setInput('');
    setAttachments([]);
    addMsg('user', text || '（见附件）', outgoing);
    setBusy(true);

    // 流式：先插入一个空的助手气泡，增量文本往里追加（不必等完整 JSON）
    const streamMsgId = uid('m');
    let streamed = '';
    setMessages((m) => [...m, { id: streamMsgId, role: 'assistant', content: '' }]);
    const appendDelta = (delta: string) => {
      streamed += delta;
      setMessages((m) => m.map((msg) => (msg.id === streamMsgId ? { ...msg, content: streamed } : msg)));
    };

    try {
      if (!sessionId) throw new Error('no session');
      await personaApi.chatForgeMessageStream(sessionId, text || '请参考我上传的附件', {
        onDelta: appendDelta,
        onDone: (state) => {
          if (state?.persona_draft) setDraft(state.persona_draft);
          if (state?.reply) {
            streamed = state.reply;
            setMessages((m) => m.map((msg) => (msg.id === streamMsgId ? { ...msg, content: state.reply! } : msg)));
          }
          const prog = state?.progress;
          if (prog) {
            const scaled = normalizeProgress(prog);
            setProgress((p) => ({ ...p, ...scaled }));
          }
          void personaApi.chatForgeDetail(sessionId).then((d) => {
            setPromptDraft(d.prompt_draft ?? '');
            setVisionPromptDraft(d.vision_prompt_draft ?? '');
          }).catch(() => {});
        },
        onError: (detail, partial) => {
          // 中断时保留已产出的文本，并说明原因（不让用户白等）
          const shown = partial || streamed;
          setMessages((m) => m.map((msg) => (msg.id === streamMsgId
            ? { ...msg, content: shown ? `${shown}\n\n（流式生成中断：${detail}）` : `流式生成失败：${detail}` }
            : msg)));
          toast(`流式生成中断：${detail}`, 'error');
        },
      }, outgoing.length > 0 ? outgoing : undefined);
    } catch {
      // 流式不可用（老后端 / 网络异常）→ 回退到同步接口，界面行为与从前一致
      try {
        const res = await personaApi.chatForgeMessage(
          sessionId ?? '', text || '请参考我上传的附件',
          outgoing.length > 0 ? outgoing : undefined,
        );
        if (res?.persona_draft) setDraft(res.persona_draft);
        const prog = res?.progress;
        if (prog) setProgress((p) => ({ ...p, ...normalizeProgress(prog) }));
        void personaApi.chatForgeDetail(sessionId ?? '').then((d) => {
          setPromptDraft(d.prompt_draft ?? '');
          setVisionPromptDraft(d.vision_prompt_draft ?? '');
        }).catch(() => {});
        const reply = res?.reply ?? '收到，让我想想…';
        setMessages((m) => m.map((msg) => (msg.id === streamMsgId ? { ...msg, content: reply } : msg)));
      } catch {
        setMessages((m) => m.map((msg) => (msg.id === streamMsgId
          ? { ...msg, content: '发送失败：后端未连接或请求被拒绝。内容已保留，请重试。' }
          : msg)));
        toast('发送失败：后端未连接或请求被拒绝', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  /** 上传文稿（原“从脚本文稿生成”入口）：把正文载入输入框，随对话发送。 */
  const handleScriptFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      setInput((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
      toast(`已载入文稿「${file.name}」，确认后发送`, 'success');
    } catch {
      toast('文稿读取失败', 'error');
    }
  };

  /** 选择图片/文件 → 读成 data URL 放进待发送队列（客户端先做与后端一致的限额校验） */
  const handleAttachFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const next: ChatAttachment[] = [];
    for (const file of files) {
      if (attachments.length + next.length >= MAX_ATTACHMENTS) {
        toast(`单条消息最多 ${MAX_ATTACHMENTS} 个附件`, 'error');
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast(`${file.name} 超过 ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB 上限`, 'error');
        continue;
      }
      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (!dataUrl) {
        toast(`${file.name} 读取失败`, 'error');
        continue;
      }
      next.push({
        type: file.type.startsWith('image/') ? 'image' : 'file',
        name: file.name,
        mime: file.type,
        data_url: dataUrl,
      });
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
  };

  /** 打开一条知识的编辑器（取全文） */
  const openKnowledgeEditor = async (kbId: string, source: string) => {
    if (!sessionId) return;
    try {
      const doc = await personaApi.chatForgeKnowledgeGet(sessionId, kbId);
      setEditingKb({ id: kbId, source: doc.source ?? source, content: doc.content ?? '' });
    } catch {
      toast('知识内容读取失败', 'error');
    }
  };

  /** 保存知识编辑（只改存储上下文，重分析需另发消息让模型处理） */
  const saveKnowledgeEdit = async () => {
    if (!sessionId || !editingKb) return;
    try {
      await personaApi.chatForgeKnowledgeUpdate(sessionId, editingKb.id, {
        content: editingKb.content, source: editingKb.source,
      });
      setEditingKb(null);
      await refreshKnowledge(sessionId);
      toast('知识条目已更新（未重跑模型；如需重新分析请再发一条消息）', 'success');
    } catch {
      toast('保存失败', 'error');
    }
  };

  const removeKnowledge = async (kbId: string) => {
    if (!sessionId) return;
    try {
      await personaApi.chatForgeKnowledgeDelete(sessionId, kbId);
      await refreshKnowledge(sessionId);
    } catch {
      toast('删除失败', 'error');
    }
  };

  /** 切换/恢复某个历史会话（会话列表点击） */
  const switchSession = async (sid: string) => {
    setSessionsOpen(false);
    setRestoreId(sid);
    setRestoreBusy(true);
    try {
      const detail = await personaApi.chatForgeDetail(sid);
      await applySessionDetail(detail, true);
      void refreshKnowledge(detail.session_id);
    } catch {
      toast('该会话不存在或后端不可达', 'error');
    } finally {
      setRestoreBusy(false);
    }
  };

  /** 删除历史会话（连同后端落盘文件） */
  const deleteSession = async (sid: string) => {
    try {
      await personaApi.chatForgeDeleteSession(sid);
      setSessions((list) => list.filter((s) => s.session_id !== sid));
      if (sessionId === sid) {
        setSessionId(null);
        setMessages([]);
      }
      toast('会话已删除', 'success');
    } catch {
      toast('删除失败', 'error');
    }
  };

  const commit = async () => {
    if (!personaName.trim()) return;
    setBusy(true);
    try {
      if (sessionId) await personaApi.chatForgeCommit(sessionId, personaName, {
        expectedRevision: sessionRevision,
        idempotencyKey: `forge-${sessionId}`,
      });
      toast('人格已保存', 'success');
      navigate({ to: '/persona' });
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) toast('保存冲突：草稿已被修改，请刷新会话后重试', 'error');
      else toast('保存失败 — 后端未连接或请求被拒绝', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleKnowledge = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!sessionId) {
      toast('请先开始对话再上传参考文档', 'error');
      e.target.value = '';
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      toast('文件读取失败', 'error');
      e.target.value = '';
      return;
    }
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
      e.target.value = '';
    }
  };

  const saveDraftPatch = async () => {
    if (!sessionId || patchSaving) return;
    setPatchSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (patchTone.trim()) patch.identity = { tone: patchTone.trim() };
      if (patchAcademic !== '') patch.language = { academic_density: Number(patchAcademic) };
      const res = await personaApi.chatForgePatch(sessionId, patch, sessionRevision);
      if (res.persona_draft) setDraft(res.persona_draft as Partial<ParameterLayer>);
      if (res.revision != null) setSessionRevision(res.revision);
      setPatchOpen(false);
      toast('草稿已修订', 'success');
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      toast(status === 409 ? '草稿冲突，请重新载入会话' : '草稿保存失败', 'error');
    } finally { setPatchSaving(false); }
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
          <h1 className="text-title-sm font-semibold text-on-surface leading-tight">PersonaForge · AI 人格构建</h1>
          <p className="text-caption text-on-surface-variant leading-tight">通过对话与文稿上传塑造创作人格</p>
        </div>
        <Badge variant="info" className="ml-auto font-mono">{overall}% 完成</Badge>
      </div>

      <div className="flex flex-1 overflow-hidden">
          {/* ── 左侧会话管理 ── */}
          <aside className="w-[240px] shrink-0 border-r border-outline-variant/25 bg-surface-container-low flex flex-col" data-testid="forge-sidebar">
            <div className="p-3 border-b border-outline-variant/20">
              <Button className="w-full" size="sm" onClick={() => void start()} disabled={busy}>
                <Plus className="w-4 h-4" /> 新建人格
              </Button>
            </div>
            <div className="px-3 py-2 text-caption uppercase tracking-wide text-on-surface-variant">历史会话</div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
              {sessions.length === 0 && <p className="px-2 py-2 text-caption text-on-surface-variant/60">还没有会话</p>}
              {sessions.map((sess) => (
                <div key={sess.session_id} className="group flex items-center gap-1">
                  <button onClick={() => void switchSession(sess.session_id)}
                    className={`flex-1 text-left px-2 py-2 rounded-cw-xs transition-colors cursor-pointer ${sessionId === sess.session_id ? 'bg-surface text-primary' : 'text-on-surface hover:bg-surface'}`}>
                    <span className="block text-label-sm truncate">{sess.title || '(未命名会话)'}</span>
                    <span className="block text-caption text-on-surface-variant/60 truncate">{sess.message_count} 条 · {new Date(sess.updated_at).toLocaleDateString('zh-CN')}</span>
                  </button>
                  <button onClick={() => void deleteSession(sess.session_id)} aria-label={`删除会话 ${sess.session_id}`}
                    className="p-1 text-on-surface-variant/50 hover:text-error cursor-pointer opacity-0 group-hover:opacity-100">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </aside>
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
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5" data-testid="msg-attachments">
                        {m.attachments.map((a, i) => (
                          a.type === 'image' ? (
                            <img
                              key={`${m.id}-att-${i}`}
                              src={a.data_url}
                              alt={a.name}
                              className="w-20 h-20 object-cover rounded-cw-xs border border-outline-variant/30"
                            />
                          ) : (
                            <span key={`${m.id}-att-${i}`}
                              className="flex items-center gap-1 px-2 py-1 rounded-cw-xs bg-surface/40 text-caption">
                              <FileText className="w-3 h-3" /> {a.name}
                            </span>
                          )
                        ))}
                      </div>
                    )}
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
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2" data-testid="pending-attachments">
                    {attachments.map((a, i) => (
                      <span key={`pending-${i}`}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-cw-xs bg-surface-container border border-outline-variant/30 text-caption">
                        {a.type === 'image'
                          ? <img src={a.data_url} alt={a.name} className="w-6 h-6 object-cover rounded-[3px]" />
                          : <FileText className="w-3.5 h-3.5" />}
                        <span className="max-w-[120px] truncate text-on-surface">{a.name}</span>
                        <button
                          onClick={() => setAttachments((list) => list.filter((_, idx) => idx !== i))}
                          className="text-on-surface-variant hover:text-error cursor-pointer"
                          aria-label={`移除附件 ${a.name}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  {/* 图片/文件附件：随消息一起发给后端（模型看不到图 → 视觉能力开启时先做分析） */}
                  <label className="p-2.5 rounded-cw-sm bg-surface-container text-on-surface-variant hover:text-primary border border-outline-variant/30 transition-colors cursor-pointer" title="上传文稿">
                    <FileText className="w-4 h-4" />
                    <input type="file" className="hidden" accept=".txt,.md,.srt" onChange={handleScriptFile} data-testid="script-upload" />
                  </label>
                  <label className="p-2.5 rounded-cw-sm bg-surface-container text-on-surface-variant hover:text-primary border border-outline-variant/30 transition-colors cursor-pointer" title="附带图片（最多 4 张）">
                    <ImagePlus className="w-4 h-4" />
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,.txt,.md,.json"
                      multiple
                      onChange={handleAttachFiles}
                      data-testid="attachment-input"
                    />
                  </label>
                  <textarea
                    value={input}
                    rows={2}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="描述这个人格的风格、语气、节奏…（可粘贴文稿）"
                    className="flex-1 resize-none bg-surface-container rounded-cw-sm px-3.5 py-2.5 text-body-sm text-on-surface
                      outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/50"
                  />
                  <Button size="icon" onClick={send} data-testid="chat-send"
                    disabled={(!input.trim() && attachments.length === 0) || busy}>
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

            {/* 知识库管理（历史欠账：原先只能追加，不能列出/编辑/删除） */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-label font-medium text-on-surface-variant uppercase tracking-wide">参考文档</h2>
                <button
                  onClick={() => (kbPanelOpen ? setKbPanelOpen(false) : void refreshKnowledge())}
                  disabled={!sessionId}
                  className="text-caption text-primary disabled:opacity-40 hover:underline cursor-pointer"
                >
                  {kbPanelOpen ? '收起' : '管理'}
                </button>
              </div>
              {kbPanelOpen && (
                <div className="space-y-1.5" data-testid="knowledge-panel">
                  {knowledge.length === 0 && (
                    <p className="text-caption text-on-surface-variant/60">还没有参考文档（点上方 📄 上传）</p>
                  )}
                  {knowledge.map((k) => (
                    <div key={k.id} className="flex items-start gap-1.5 px-2 py-1.5 rounded-cw-xs bg-surface-container border border-outline-variant/25">
                      {editingKb?.id === k.id ? (
                        <div className="flex-1 space-y-1.5">
                          <input
                            value={editingKb.source}
                            onChange={(e) => setEditingKb({ ...editingKb, source: e.target.value })}
                            className="w-full bg-surface rounded-cw-xs px-2 py-1 text-caption text-on-surface border border-outline-variant/30 outline-none focus:border-primary"
                          />
                          <textarea
                            value={editingKb.content}
                            onChange={(e) => setEditingKb({ ...editingKb, content: e.target.value })}
                            rows={5}
                            className="w-full bg-surface rounded-cw-xs px-2 py-1 text-caption text-on-surface border border-outline-variant/30 outline-none focus:border-primary resize-y"
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={saveKnowledgeEdit}>保存</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingKb(null)}>取消</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <p className="text-label-sm text-on-surface truncate">{k.source}</p>
                            <p className="text-caption text-on-surface-variant/70 truncate">{k.preview}</p>
                            <p className="text-caption text-on-surface-variant/50 font-mono">{k.chars} 字</p>
                          </div>
                          <button
                            onClick={() => void openKnowledgeEditor(k.id, k.source)}
                            aria-label={`编辑 ${k.source}`}
                            className="p-1 rounded-cw-xs text-on-surface-variant hover:text-primary cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => void removeKnowledge(k.id)}
                            aria-label={`删除 ${k.source}`}
                            className="p-1 rounded-cw-xs text-on-surface-variant hover:text-error cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
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

            {/* 人工修订草稿（PATCH draft） */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-label font-medium text-on-surface-variant uppercase tracking-wide">手动修订</h2>
                <button onClick={() => setPatchOpen((v) => !v)} disabled={!sessionId}
                  className="text-caption text-primary disabled:opacity-40 hover:underline cursor-pointer">
                  {patchOpen ? '收起' : '修改参数'}
                </button>
              </div>
              {patchOpen && (
                <div className="space-y-2 bg-surface-container border border-outline-variant/30 rounded-cw-md p-3">
                  <input value={patchTone} onChange={(e) => setPatchTone(e.target.value)}
                    placeholder="语调，如 sharp / warm_storyteller"
                    className="w-full bg-surface rounded-cw-xs px-2 py-1.5 text-caption text-on-surface border border-outline-variant/30 outline-none focus:border-primary" />
                  <input value={patchAcademic} onChange={(e) => setPatchAcademic(e.target.value)}
                    type="number" min={0} max={1} step={0.05} placeholder="学术密度 0-1"
                    className="w-full bg-surface rounded-cw-xs px-2 py-1.5 text-caption text-on-surface border border-outline-variant/30 outline-none focus:border-primary" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveDraftPatch} disabled={patchSaving}>{patchSaving ? '保存中…' : '保存修订'}</Button>
                    <Button size="sm" variant="outline" onClick={() => setPatchOpen(false)}>取消</Button>
                  </div>
                </div>
              )}
            </div>

            {/* Prompt 草稿：对话过程中可见，保存后写入 persona prompt/vision_prompt */}
            {(promptDraft || visionPromptDraft) && (
              <div>
                <h2 className="text-label font-medium text-on-surface-variant uppercase tracking-wide mb-2.5">Prompt 草稿</h2>
                <div className="space-y-2" data-testid="forge-prompt-draft">
                  {promptDraft && (
                    <details className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-3">
                      <summary className="text-label-sm text-on-surface cursor-pointer">系统 Prompt（{promptDraft.length} 字）</summary>
                      <pre className="mt-2 whitespace-pre-wrap text-caption text-on-surface-variant max-h-40 overflow-y-auto">{promptDraft}</pre>
                    </details>
                  )}
                  {visionPromptDraft && (
                    <details className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-3">
                      <summary className="text-label-sm text-on-surface cursor-pointer">视觉 Prompt（{visionPromptDraft.length} 字）</summary>
                      <pre className="mt-2 whitespace-pre-wrap text-caption text-on-surface-variant max-h-40 overflow-y-auto">{visionPromptDraft}</pre>
                    </details>
                  )}
                </div>
              </div>
            )}

            {/* commit */}
            <div className="mt-auto pt-3 border-t border-outline-variant/25 space-y-2.5">
              <input
                value={personaName}
                onChange={(e) => setPersonaName(e.target.value)}
                placeholder="人格名称，如「老陈·数码毒舌」"
                className="w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
                  outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/50"
              />
              <Button className="w-full" onClick={commit} disabled={!personaName.trim() || busy}>
                <Check className="w-4 h-4" /> 保存人格
              </Button>
            </div>
          </div>
        </div>
    </div>
  );
}

function estimateProgressFromDraft(draft: unknown): Record<Dimension, number> {
  const out: Record<Dimension, number> = { identity: 0, language: 0, rhythm: 0, visual: 0, audio: 0, constraints: 0 };
  if (!draft || typeof draft !== 'object') return out;
  const d = draft as Record<string, unknown>;
  const dims: [Dimension, unknown][] = [
    ['identity', d.identity], ['language', d.language], ['rhythm', d.rhythm],
    ['visual', d.visual], ['audio', d.audio], ['constraints', d.constraints],
  ];
  for (const [key, val] of dims) if (dimensionHasSignal(val)) out[key] = 100;
  return out;
}

function dimensionHasSignal(val: unknown): boolean {
  if (!val || typeof val !== 'object') return false;
  return Object.values(val as Record<string, unknown>).some((v) => {
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.length > 0;
    if (v && typeof v === 'object') return Object.keys(v as object).length > 0;
    return v != null;
  });
}

function normalizeProgress(prog: Record<string, number>): Record<string, number> {
  const vals = Object.values(prog).filter((v) => v > 0);
  if (vals.length === 0) return prog;
  const scaled: Record<string, number> = {};
  for (const [k, v] of Object.entries(prog)) scaled[k] = v <= 1 ? Math.round(v * 100) : v;
  return scaled;
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
    chunks.push({ heading: heading || `section_${chunks.length + 1}`, content: chunkContent.slice(0, KB_CHUNK_LIMIT) });
  }
  return chunks.length ? chunks : [{ heading: '', content: text.slice(0, KB_CHUNK_LIMIT) }];
}

