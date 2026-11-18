import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { typeForgeApi, typeMakerApi, type TypeForgeDetail, type TypeForgeSession } from '@/services/api';
import { Button } from '@/components/ui';
import { toast } from '@/stores/toastStore';
import { Plus, Send, Trash2, Sparkles, Check, Loader2, FileText } from 'lucide-react';
import type { TypeDefinition } from '@/services/api/typeMaker';

export function TypeForgePage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<TypeForgeSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TypeForgeDetail | null>(null);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [draft, setDraft] = useState<Partial<TypeDefinition>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [typeName, setTypeName] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadSessions = async () => {
    try { setSessions((await typeForgeApi.sessions()).sessions); } catch { toast('类型会话读取失败', 'error'); }
  };
  useEffect(() => { void loadSessions(); }, []);
  useEffect(() => { scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight }); }, [messages.length]);

  const apply = (d: TypeForgeDetail) => {
    setDetail(d); setSessionId(d.session_id); setMessages(d.messages ?? []); setDraft(d.draft ?? {});
    setTypeId(String(d.draft?.id ?? '')); setTypeName(String(d.draft?.name ?? ''));
  };

  const newSession = async () => {
    setBusy(true);
    try {
      const s = await typeForgeApi.start();
      setSessionId(s.session_id); setMessages([]); setDraft(s.draft ?? {});
      setTypeId(String(s.draft?.id ?? '')); setTypeName(String(s.draft?.name ?? ''));
      await loadSessions();
    } catch { toast('新类型会话创建失败', 'error'); } finally { setBusy(false); }
  };

  const openSession = async (sid: string) => {
    setBusy(true);
    try { apply(await typeForgeApi.detail(sid)); }
    catch { toast('会话读取失败', 'error'); } finally { setBusy(false); }
  };

  const send = async () => {
    if (!sessionId || !input.trim() || busy) return;
    const text = input.trim(); setInput(''); setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    try {
      const res = await typeForgeApi.message(sessionId, text);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
      setDraft(res.draft ?? {});
      if (res.draft?.id) setTypeId(String(res.draft.id));
      if (res.draft?.name) setTypeName(String(res.draft.name));
    } catch { toast('发送失败', 'error'); } finally { setBusy(false); }
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const text = await file.text();
    setInput((v) => (v ? `${v}\n\n${text}` : text));
  };

  const save = async () => {
    if (!sessionId || !typeId.trim() || !typeName.trim()) { toast('请填写类型 ID 和名称', 'error'); return; }
    setBusy(true);
    try {
      const definition = { ...draft, id: typeId.trim(), name: typeName.trim() } as Partial<TypeDefinition>;
      await typeMakerApi.validate(definition);
      await typeForgeApi.commit(sessionId, typeId.trim(), definition);
      toast('视频类型已创建', 'success');
      navigate({ to: '/settings/type-maker/$typeId', params: { typeId: typeId.trim() } });
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast(msg || '创建失败：请检查参数/Prompt', 'error');
    } finally { setBusy(false); }
  };

  const removeSession = async (sid: string) => {
    try { await typeForgeApi.remove(sid); if (sessionId === sid) { setSessionId(null); setMessages([]); setDraft({}); } await loadSessions(); }
    catch { toast('删除会话失败', 'error'); }
  };

  return (
    <div className="h-full flex overflow-hidden bg-surface">
      <aside className="w-[230px] shrink-0 border-r border-outline-variant/25 bg-surface-container-low flex flex-col">
        <div className="p-3 border-b"><Button className="w-full" size="sm" onClick={() => void newSession()} disabled={busy}><Plus className="w-4 h-4" /> 新建类型</Button></div>
        <div className="px-3 py-2 text-caption uppercase tracking-wide text-on-surface-variant">历史会话</div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.length === 0 && <p className="p-2 text-caption text-on-surface-variant/60">还没有会话</p>}
          {sessions.map((s) => (
            <div key={s.session_id} className="group flex items-center gap-1">
              <button onClick={() => void openSession(s.session_id)} className={`flex-1 text-left p-2 rounded-cw-xs ${sessionId === s.session_id ? 'bg-surface text-primary' : 'hover:bg-surface'}`}>
                <span className="block text-label-sm truncate">{s.title || '未命名类型'}</span>
                <span className="block text-caption text-on-surface-variant/60">{s.message_count} 条</span>
              </button>
              <button aria-label={`删除类型会话 ${s.session_id}`} onClick={() => void removeSession(s.session_id)} className="p-1 opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-error"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0 border-r border-outline-variant/25">
        <div className="px-5 py-3 border-b"><h1 className="text-title-sm font-semibold">TypeForge · AI 视频类型创作</h1><p className="text-caption text-on-surface-variant">描述你的视频品类，AI 生成参数与 Prompt</p></div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-3">
          {messages.length === 0 && <div className="h-full flex flex-col items-center justify-center text-center"><Sparkles className="w-8 h-8 text-primary mb-3" /><p className="font-medium">描述你想做的视频类型</p><p className="text-caption text-on-surface-variant max-w-[360px] mt-1">例如：3 分钟知识区快节奏解说，硬切为主，信息密度高。</p></div>}
          {messages.map((m, i) => <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[75%] rounded-cw-md px-3 py-2 text-body-sm ${m.role === 'user' ? 'bg-primary-container' : 'bg-surface-container border'}`}>{m.content}</div></div>)}
          {busy && <span className="text-caption text-on-surface-variant flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> 生成中…</span>}
        </div>
        <div className="p-3 border-t flex gap-2">
          <label title="上传文稿" className="p-2.5 rounded-cw-sm bg-surface-container border cursor-pointer"><FileText className="w-4 h-4" /><input type="file" className="hidden" accept=".txt,.md,.srt" onChange={upload} /></label>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder="描述视频类型、节奏、剪辑方式…" className="flex-1 resize-none bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm border outline-none focus:border-primary" />
          <Button size="icon" onClick={() => void send()} disabled={!input.trim() || busy || !sessionId}><Send className="w-4 h-4" /></Button>
        </div>
      </div>
      <aside className="w-[340px] shrink-0 p-5 overflow-y-auto bg-surface-container-low space-y-4">
        <h2 className="text-label font-medium uppercase text-on-surface-variant">类型草稿</h2>
        <input value={typeId} onChange={(e) => setTypeId(e.target.value)} placeholder="类型 ID（如 my_knowledge_fast）" className="w-full bg-surface rounded-cw-sm px-3 py-2 text-label-sm border" />
        <input value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="类型名称" className="w-full bg-surface rounded-cw-sm px-3 py-2 text-label-sm border" />
        <p className="text-body-sm text-on-surface-variant">{String(draft.description ?? '暂无描述')}</p>
        <div className="text-caption space-y-1">
          <p>镜头：{String((draft.shot_params as TypeDefinition['shot_params'] | undefined)?.min_shot_sec ?? '-')}–{String((draft.shot_params as TypeDefinition['shot_params'] | undefined)?.max_shot_sec ?? '-')}s</p>
          <p>转场：{String((draft.shot_params as TypeDefinition['shot_params'] | undefined)?.transition_type ?? '-')}</p>
          <p>Prompt 槽位：{Object.keys(draft.prompts ?? {}).length}/10</p>
        </div>
        <details className="bg-surface rounded-cw-sm border p-2"><summary className="text-label-sm cursor-pointer">完整草稿 JSON</summary><pre className="mt-2 text-caption overflow-auto max-h-64">{JSON.stringify(draft, null, 2)}</pre></details>
        <Button className="w-full" onClick={() => void save()} disabled={busy || !sessionId || !typeId.trim() || !typeName.trim()}><Check className="w-4 h-4" /> 保存类型</Button>
        {detail && <p className="text-caption text-on-surface-variant/60">会话 {detail.session_id}</p>}
      </aside>
    </div>
  );
}
