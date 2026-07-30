import { useState, useEffect, useRef } from 'react';
import { useAgentStore, loadRequirementsDraft, clearRequirementsDraft } from '@/stores/agentStore';
import { useProjectStore } from '@/stores/projectStore';
import { Markdown } from '@/components/shared/Markdown';
import { TimelineDiffView } from './TimelineDiffView';
import { pipelineApi, requirementsApi } from '@/services/api';
import { Button } from '@/components/ui';
import { uid } from '@/lib/utils';
import type { PipelinePhase, LogEventType, LogEntry } from '@/types/pipeline';
import type { Timeline } from '@/types/timeline';
import {
  Bot, Send, Sparkles, Check, FileText, ListChecks, Loader2, Zap,
  MessageSquareText, Play, ChevronDown, ChevronRight,
} from 'lucide-react';

const PHASE_LABELS: Record<PipelinePhase, string> = {
  idle: '待命', structure: '结构', material: '素材', edit: '剪辑',
  animation: '动画', audio: '音效', quality: '质检',
  self_heal: '自愈', completed: '完成', failed: '失败',
};

const PHASE_ORDER: PipelinePhase[] = ['structure', 'material', 'edit', 'animation', 'audio', 'quality'];

const LOG_ICONS: Record<LogEventType, string> = {
  agent_start: '▶', agent_end: '✓', llm: '🤖', tool: '🔧',
  skill: '🧠', plugin: '🔌', info: '○', warning: '⚠',
  error: '✗', timeline_snapshot: '📊',
};

const LOG_COLORS: Record<LogEventType, string> = {
  agent_start: 'text-primary', agent_end: 'text-track-audio',
  llm: 'text-track-caption', tool: 'text-on-surface-variant/70',
  skill: 'text-tertiary', plugin: 'text-track-image',
  info: 'text-on-surface-variant/50', warning: 'text-track-text',
  error: 'text-error', timeline_snapshot: 'text-track-video',
};

export function AgentPanel() {
  const [tab, setTab] = useState<'requirements' | 'logs'>('requirements');
  const agentTimeline = useAgentStore((s) => s.agentTimeline);
  const setAgentTimeline = useAgentStore((s) => s.setAgentTimeline);

  return (
    <div className="flex flex-col h-full bg-surface-container-low">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/30 shrink-0">
        <div className="w-6 h-6 rounded-cw-full bg-primary-container flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-on-primary-container" />
        </div>
        <span className="text-label font-medium text-on-surface-variant uppercase tracking-wide">
          Agent 副驾驶
        </span>
        <span className="ml-auto w-2 h-2 rounded-cw-full bg-track-audio animate-pulse" title="在线" />
      </div>

      <div className="flex border-b border-outline-variant/30 shrink-0">
        <button onClick={() => setTab('requirements')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-label font-medium border-b-2 transition-colors cursor-pointer ${
            tab === 'requirements' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}>
          <MessageSquareText className="w-3.5 h-3.5" /> 需求对话
        </button>
        <button onClick={() => setTab('logs')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-label font-medium border-b-2 transition-colors cursor-pointer ${
            tab === 'logs' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}>
          <ListChecks className="w-3.5 h-3.5" /> 执行日志
        </button>
      </div>

      <div className="flex-1 overflow-hidden min-h-0">
        {tab === 'requirements' ? <RequirementsView /> : <LogPanel />}
      </div>

      <BottomBar />

      {agentTimeline && (
        <div className="fixed inset-0 z-[60] bg-surface flex flex-col">
          <TimelineDiffView agentTimeline={agentTimeline} onDone={() => setAgentTimeline(null)} />
        </div>
      )}
    </div>
  );
}

function RequirementsView() {
  const status = useAgentStore((s) => s.requirementsStatus);
  const messages = useAgentStore((s) => s.requirementsMessages);
  const creativeBrief = useAgentStore((s) => s.creativeBrief);
  const productionPlan = useAgentStore((s) => s.productionPlan);
  const addMessage = useAgentStore((s) => s.addRequirementsMessage);
  const setStatus = useAgentStore((s) => s.setRequirementsStatus);
  const setBrief = useAgentStore((s) => s.setCreativeBrief);
  const setPlan = useAgentStore((s) => s.setProductionPlan);
  const setSession = useAgentStore((s) => s.setRequirementsSession);
  const setPipelineId = useAgentStore((s) => s.setPipelineId);
  const updatePhase = useAgentStore((s) => s.updatePhase);
  const reviewMode = useAgentStore((s) => s.reviewMode);
  const setReviewMode = useAgentStore((s) => s.setReviewMode);
  const [topic, setTopic] = useState('');
  const [input, setInput] = useState('');
  const [manualBusy, setBusy] = useState(false);
  // Auto-start (from HomePage launch) runs in EditorPage via useRequirementsAutoStart;
  // reflect its busy flag here so the UI shows progress even though it's store-driven.
  const autoBusy = useAgentStore((s) => s.requirementsBusy);
  const busy = manualBusy || autoBusy;
  const [draftLoaded, setDraftLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draftLoaded) return;
    // Guard: if store already has messages (e.g. from auto-start or StrictMode re-mount),
    // skip draft loading to prevent duplication.
    if (useAgentStore.getState().requirementsMessages.length > 0) {
      setDraftLoaded(true);
      return;
    }
    const draft = loadRequirementsDraft();
    if (draft && draft.messages?.length > 0) {
      draft.messages.forEach((m) => addMessage(m));
      if (draft.brief) setBrief(draft.brief);
      if (draft.plan) setPlan(draft.plan);
      if (draft.status) setStatus(draft.status);
      if (draft.sessionId) setSession(draft.sessionId);
    }
    setDraftLoaded(true);
  }, [draftLoaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  const startSession = async () => {
    if (!topic.trim()) return;
    setBusy(true);
    setStatus('gathering');
    addMessage({ id: uid('m'), role: 'user', content: `选题：${topic}`, timestamp: new Date().toISOString() });
    try {
      const res = await requirementsApi.init({ topic });
      setSession(res.session_id);
      await sendChat(res.session_id, `我的选题是：${topic}。请帮我生成创意简报。`);
    } catch {
      const brief = demoBrief(topic);
      setBrief(brief);
      setStatus('brief_ready');
      addMessage({ id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(),
        content: '已为你生成创意简报，请审阅后确认。', creative_brief: brief });
    } finally { setBusy(false); }
  };

  const sendChat = async (sessionId: string, message: string) => {
    addMessage({ id: uid('m'), role: 'user', content: message, timestamp: new Date().toISOString() });
    setBusy(true);
    try {
      const res = await requirementsApi.chat({ session_id: sessionId, message });
      const brief = res.creative_brief ?? null;
      const plan = res.production_plan ?? null;
      const st = res.status as string | undefined;
      // Only reset brief during gathering/brief_ready; preserve it after confirmation
      if (brief && (st === 'gathering' || st === 'brief_ready')) { setBrief(brief); setStatus('brief_ready'); }
      if (plan) { setPlan(plan); setStatus('plan_ready'); }
      addMessage({ id: uid('m'), role: 'assistant', content: res.reply ?? res.message ?? '已收到。',
        timestamp: new Date().toISOString(),
        creative_brief: (st === 'gathering' || st === 'brief_ready') ? brief : null,
        production_plan: plan });
    } catch {
      addMessage({ id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(),
        content: '（离线演示）已记录你的需求。' });
    } finally { setBusy(false); }
  };

  const confirmBrief = async () => {
    setStatus('planning');
    const sid = useAgentStore.getState().requirementsSessionId;
    if (sid) {
      // Online: sendChat adds exactly ONE user bubble + reads reply/plan from backend
      await sendChat(sid, '确认，请生成完整的制作规划书。');
      return;
    }
    // Offline demo path: exactly ONE user + ONE assistant
    setBusy(true);
    addMessage({ id: uid('m'), role: 'user', content: '确认，请生成制作规划书。', timestamp: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 600));
    const plan = { markdown: demoPlanMarkdown(topic) };
    setPlan(plan);
    setStatus('plan_ready');
    addMessage({ id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(),
      content: '制作规划书已生成，请审阅。', production_plan: plan });
    setBusy(false);
  };

  const confirmPlan = async () => {
    const sid = useAgentStore.getState().requirementsSessionId;
    if (!sid) {
      // 离线演示：无会话，仅提示
      setStatus('pipeline_running');
      addMessage({ id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(),
        content: '已确认规划书。请在底部启动管线，切换到「执行日志」标签查看实时进度。' });
      return;
    }
    setStatus('pipeline_running');
    addMessage({ id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(),
      content: '已确认规划书，正在启动制作管线…' });
    try {
      const st = useProjectStore.getState();
      const res = await requirementsApi.proceed(
        sid,
        st.personaId ?? 'default',
        st.pluginId ?? 'knowledge_longform',
      ) as { pipeline_id?: string };
      if (res.pipeline_id) {
        // 设置 pipelineId + 运行相位，BottomBar 的 effect 会自动挂接 SSE 追踪
        setPipelineId(res.pipeline_id);
        updatePhase('structure', 5);
      }
    } catch {
      setStatus('plan_ready');
      addMessage({ id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(),
        content: '管线启动失败，请稍后重试。' });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="bg-agent-bubble/40 border border-primary-container/40 rounded-cw-md p-3">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-body-sm font-medium text-on-surface">需求 Agent</span>
            </div>
            <p className="text-label-sm text-on-surface-variant leading-relaxed">
              你好！我是需求 Agent。输入选题，我会先帮你梳理<b className="text-on-surface">创意简报</b>，
              确认后再生成完整的<b className="text-on-surface">制作规划书</b>，然后启动生产管线。
            </p>
            <div className="mt-3">
              <input value={topic} onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startSession()}
                placeholder="输入视频选题…" className="w-full bg-surface-container rounded-cw-xs px-3 py-2 text-body-sm text-on-surface
                  outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/50" />
              <Button size="sm" onClick={startSession} disabled={!topic.trim() || busy} className="mt-2 w-full">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                开始需求分析
              </Button>
              {loadRequirementsDraft() && (
                <button onClick={() => clearRequirementsDraft()} className="text-caption text-on-surface-variant/50 hover:text-error cursor-pointer mt-1.5 block w-full text-center">
                  清除已保存的会话草稿
                </button>
              )}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-cw-md px-3 py-2 text-body-sm leading-relaxed ${m.role === 'user'
              ? 'bg-primary-container text-on-primary-container rounded-br-cw-xs whitespace-pre-wrap'
              : 'bg-surface-container text-on-surface rounded-bl-cw-xs border border-outline-variant/20'}`}>
              {m.role === 'user' ? m.content : <Markdown text={m.content} />}
              {m.creative_brief && (
                <div className="mt-2 pt-2 border-t border-outline-variant/20">
                  <BriefCard brief={m.creative_brief} onConfirm={confirmBrief} busy={busy} onReview={() => setReviewMode('brief')} />
                </div>
              )}
              {m.production_plan && (
                <div className="mt-2 pt-2 border-t border-outline-variant/20">
                  <PlanCard markdown={m.production_plan.markdown_content || m.production_plan.markdown || ''} onConfirm={confirmPlan} busy={busy} onReview={() => setReviewMode('plan')} />
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-label-sm text-on-surface-variant px-3">
            <Loader2 className="w-3 h-3 animate-spin text-primary" /> 正在思考…
          </div>
        )}
      </div>

      {messages.length > 0 && status !== 'pipeline_running' && (
        <div className="p-3 border-t border-outline-variant/20 shrink-0">
          <div className="flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (busy) return; // 与发送按钮一致，避免并发重复发送
                const sid = useAgentStore.getState().requirementsSessionId;
                if (input.trim() && sid) { const m = input; setInput(''); sendChat(sid, m); }
              }}
              placeholder="继续与需求 Agent 对话…"
              className="flex-1 bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
                outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/50" />
            <Button size="icon" onClick={() => {
              const sid = useAgentStore.getState().requirementsSessionId;
              if (input.trim() && sid) { const m = input; setInput(''); sendChat(sid, m); }
            }}             disabled={!input.trim() || busy}>
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LogPanel() {
  const logEntries = useAgentStore((s) => s.logEntries);
  const toggleExpand = useAgentStore((s) => s.toggleLogExpand);
  const clearLogs = useAgentStore((s) => s.clearLogs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [grouped, setGrouped] = useState(true);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [logEntries.length]);

  const groups = grouped ? buildGroups(logEntries) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-outline-variant/20 shrink-0">
        <span className="text-caption text-on-surface-variant font-mono">
          {logEntries.length} 条
        </span>
        <button onClick={() => setGrouped(!grouped)}
          className="text-caption text-on-surface-variant hover:text-on-surface cursor-pointer ml-auto">
          {grouped ? '展开全部' : '分组'}
        </button>
        <button onClick={clearLogs}
          className="text-caption text-on-surface-variant hover:text-error cursor-pointer">
          清空
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 min-h-0 font-mono text-label-sm leading-relaxed">
        {logEntries.length === 0 && (
          <div className="text-center py-8 text-on-surface-variant/40 text-label-sm">等待操作…</div>
        )}
        {grouped && groups
          ? groups.map((g, gi) => <AgentGroup key={gi} group={g} onToggle={toggleExpand} />)
          : logEntries.map((e) => <LogLine key={e.id} entry={e} onToggle={toggleExpand} />)
        }
      </div>
    </div>
  );
}

function AgentGroup({ group, onToggle }: {
  group: { agent: string; entries: LogEntry[] };
  onToggle: (id: string) => void;
}) {
  const { agent, entries } = group;
  const [folded, setFolded] = useState(agent !== 'system');
  const types = entries.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {} as Record<string, number>);
  const typeSummary = Object.entries(types).slice(0, 4).map(([t, n]) => `${n}x ${t}`).join(' ');

  return (
    <div className="mb-1">
      <button onClick={() => setFolded(!folded)}
        className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-cw-xs hover:bg-surface-container/50 transition-colors cursor-pointer text-label-sm">
        {folded ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
        <span className="font-semibold text-on-surface">{agent}</span>
        <span className="text-on-surface-variant/50 ml-auto">{entries.length} 条</span>
        <span className="text-on-surface-variant/30 text-caption ml-1 truncate max-w-[120px]">{typeSummary}</span>
      </button>
      {!folded && (
        <div className="pl-4">
          {entries.map((e) => <LogLine key={e.id} entry={e} onToggle={onToggle} />)}
        </div>
      )}
    </div>
  );
}

function LogLine({ entry, onToggle }: { entry: LogEntry; onToggle: (id: string) => void }) {
  return (
    <div className="group">
      <button onClick={() => onToggle(entry.id)}
        className={`w-full text-left flex items-start gap-1 py-0.5 hover:bg-surface-container/40 rounded-cw-xs px-1 cursor-pointer ${LOG_COLORS[entry.type]}`}>
        <span className="shrink-0 w-4 text-center">{LOG_ICONS[entry.type]}</span>
        <span className="flex-1 truncate">{entry.summary}</span>
        {entry.detail && (
          <span className="text-on-surface-variant/30 text-caption shrink-0">{entry.expanded ? '▾' : '▸'}</span>
        )}
      </button>
      {entry.expanded && entry.detail && (
        <div className="pl-5 pr-1 pb-1">
          <pre className="text-caption text-on-surface-variant/60 bg-surface-container rounded-cw-xs p-2 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap">
            {JSON.stringify(entry.detail, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function BottomBar() {
  const phase = useAgentStore((s) => s.phase);
  const progress = useAgentStore((s) => s.progress);
  const pipelineId = useAgentStore((s) => s.pipelineId);
  const error = useAgentStore((s) => s.error);
  const pipelineSummary = useAgentStore((s) => s.pipelineSummary);
  const addLogEntry = useAgentStore((s) => s.addLogEntry);
  const setPipelineSummary = useAgentStore((s) => s.setPipelineSummary);
  const updatePhase = useAgentStore((s) => s.updatePhase);
  const setPipelineId = useAgentStore((s) => s.setPipelineId);
  const setError = useAgentStore((s) => s.setError);

  const [topic, setTopic] = useState('');
  const [launching, setLaunching] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const lastTimelineRef = useRef<Timeline | null>(null);
  const simTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const running = pipelineId !== null && phase !== 'completed' && phase !== 'failed' && phase !== 'idle';

  useEffect(() => {
    if (pipelineId && running && !esRef.current) {
      openSSE(pipelineId);
    }
  }, [pipelineId, running]);

  useEffect(() => () => {
    esRef.current?.close();
    simTimersRef.current.forEach((t) => clearTimeout(t));
    simTimersRef.current.clear();
  }, []);

  const openSSE = (pid: string) => {
    esRef.current?.close();
    const es = new EventSource(pipelineApi.getTraceStreamUrl(pid));
    esRef.current = es;

    const startTimes: Record<string, number> = {};
    let finished = false;
    // 每次挂接 SSE 前清空上一次运行残留的时间线，避免 finish 复用旧时间线（张冠李戴）
    lastTimelineRef.current = null;

    // 完成处理：ok=true 拉取最终时间线进入审阅；ok=false 标记失败并提示
    const finish = async (ok: boolean, errMsg?: string) => {
      if (finished) return;
      finished = true;
      if (ok) {
        updatePhase('completed', 100);
        // 优先用 SSE 快照；否则从 result 接口取最终时间线
        let tl = lastTimelineRef.current;
        if (!tl) {
          try {
            const result = await pipelineApi.getResult(pid) as { shared_data?: { final_timeline?: Timeline } };
            tl = result?.shared_data?.final_timeline ?? null;
          } catch { tl = null; }
        }
        if (tl) useAgentStore.getState().setAgentTimeline(tl);
      } else {
        updatePhase('failed');
        useAgentStore.getState().setError(errMsg || '管线执行失败');
        addLogEntry({ timestamp: Date.now(), agent: 'system', type: 'error', summary: errMsg || '管线执行失败' });
      }
      es.close();
      esRef.current = null;
    };

    // 后端 SSE 不带 event: 字段，所有事件都走默认 message，类型在 payload 的 type 中。
    es.onmessage = (e) => {
      let d: Record<string, unknown>;
      try {
        d = JSON.parse((e as MessageEvent).data);
      } catch { return; }
      const t = (d.type as string) || '';
      const name = (d.agent_name || d.agent || 'system') as string;

      switch (t) {
        case 'agent_start':
          startTimes[name] = Date.now();
          updatePhase(normalizePhase(name));
          addLogEntry({ timestamp: Date.now(), agent: name, type: 'agent_start', summary: `${name} 启动` });
          break;
        case 'agent_end':
        case 'agent_complete': {
          const dur = startTimes[name] ? ((Date.now() - startTimes[name]) / 1000).toFixed(1) + 's' : '';
          addLogEntry({ timestamp: Date.now(), agent: name, type: 'agent_end', summary: `${name} 完成${dur ? ` (${dur})` : ''}` });
          break;
        }
        case 'error':
          // 管线级失败（终态）→ 标记失败并结束
          addLogEntry({ timestamp: Date.now(), agent: name, type: 'error', summary: (d.error || d.summary || `${name} 失败`) as string });
          void finish(false, (d.error || d.summary || '管线执行失败') as string);
          break;
        case 'agent_error':
          // 单个 Agent 错误（管线可能自愈恢复）→ 仅记录
          addLogEntry({ timestamp: Date.now(), agent: name, type: 'error', summary: (d.error || d.summary || `${name} 失败`) as string });
          break;
        case 'timeline_snapshot': {
          // 时间线存放在 detail 字段（非 timeline）
          const tl = (d.detail || d.timeline) as Timeline | undefined;
          if (tl) {
            lastTimelineRef.current = tl;
            addLogEntry({ timestamp: Date.now(), agent: name, type: 'timeline_snapshot',
              summary: `时间线: ${tl.tracks?.length || 0}轨, ${tl.duration_sec?.toFixed(0) || 0}s` });
          }
          break;
        }
        case 'done':
        case 'pipeline_complete':
          void finish(true);
          break;
        case 'llm':
        case 'tool':
        case 'skill':
        case 'plugin':
        case 'info':
        case 'warning':
          addLogEntry({
            timestamp: Date.now(),
            agent: (d.agent as string) || 'system',
            type: t as LogEventType,
            summary: (d.summary || d.message || '') as string,
            detail: (d.detail as Record<string, unknown>) || null,
          });
          break;
        default:
          break;
      }
    };

    es.onerror = () => {
      // 后端在 done/error 后会主动关闭流；若尚未完成才视为异常中断
      if (!finished) {
        addLogEntry({ timestamp: Date.now(), agent: 'system', type: 'warning', summary: 'SSE 连接中断' });
      }
      es.close();
      esRef.current = null;
    };
  };

  const launch = async () => {
    setError(null);
    updatePhase('structure', 5);
    setLaunching(true);
    addLogEntry({ timestamp: Date.now(), agent: 'system', type: 'info', summary: `管线启动: ${topic || '未命名选题'}` });
    try {
      const st = useProjectStore.getState();
      const res = await pipelineApi.runAsync({
        persona_id: st.personaId ?? 'default',
        category_plugin_id: st.pluginId ?? 'knowledge_longform',
        topic: topic || '未命名选题',
        use_v2: true,
        extra_params: {
          script_text: st.scriptText || undefined,
          audio_duration_sec: st.audioDurationSec || undefined,
          split_mode: st.splitMode || undefined,
          video_mode: st.videoMode || undefined,
          audio_path: st.audioPath || undefined,
          auto_dub: st.autoDub,
          voice_id: st.voiceId || undefined,
          creative_brief: useAgentStore.getState().creativeBrief ?? undefined,
          production_plan: useAgentStore.getState().productionPlan ?? undefined,
        },
      });
      setPipelineId(res.pipeline_id);
      openSSE(res.pipeline_id);
    } catch {
      simulatePipeline();
    } finally {
      setLaunching(false);
    }
  };

  const simulatePipeline = () => {
    setPipelineId(uid('pl'));
    let i = 0;
    const schedule = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        simTimersRef.current.delete(t);
        fn();
      }, ms);
      simTimersRef.current.add(t);
    };
    const step = () => {
      if (i >= PHASE_ORDER.length) {
        updatePhase('completed', 100);
        addLogEntry({ timestamp: Date.now(), agent: 'system', type: 'info', summary: '管线完成（演示模式）' });
        return;
      }
      const p = PHASE_ORDER[i];
      addLogEntry({ timestamp: Date.now(), agent: PHASE_LABELS[p], type: 'agent_start', summary: `${PHASE_LABELS[p]} 启动` });
      schedule(() => {
        addLogEntry({ timestamp: Date.now(), agent: PHASE_LABELS[p], type: 'agent_end', summary: `${PHASE_LABELS[p]} 完成 (0.7s)` });
      }, 600);
      updatePhase(p, Math.round(((i + 1) / PHASE_ORDER.length) * 90));
      i++;
      schedule(step, 700);
    };
    step();
  };

  return (
    <div className="border-t border-outline-variant/20 shrink-0 bg-surface-container-low">
      {running && (
        <div className="px-3 pt-2 space-y-0.5">
          {PHASE_ORDER.map((p) => {
            const idx = PHASE_ORDER.indexOf(p);
            const curIdx = PHASE_ORDER.indexOf(phase as never);
            const done = (phase as string) === 'completed' || (curIdx > idx);
            const active = (phase as string) === p;
            return (
              <div key={p} className="flex items-center gap-1.5">
                <span className={`w-3.5 h-3.5 rounded-cw-full flex items-center justify-center shrink-0 text-caption ${
                  done ? 'bg-track-audio text-black' : active ? 'bg-primary' : 'bg-surface-container text-on-surface-variant/50'
                }`}>
                  {done ? <Check className="w-2 h-2" /> : active ? <Loader2 className="w-2 h-2 animate-spin" /> : ''}
                </span>
                <span className={`text-caption ${active ? 'text-primary font-semibold' : done ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
                  {PHASE_LABELS[p]}
                </span>
                {active && (
                  <div className="flex-1 h-0.5 bg-surface-container rounded-cw-full overflow-hidden">
                    <div className="h-full bg-primary animate-pulse" style={{ width: `${progress % 100 || 50}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="px-3 py-1.5 text-caption text-error">{error}</div>
      )}

      {pipelineSummary && (
        <div className="px-3 py-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-caption font-mono text-on-surface-variant">
          <span>{pipelineSummary.totalTokens} tokens</span>
          <span>{pipelineSummary.totalCost}</span>
          <span>{pipelineSummary.materialCount} 素材</span>
          {pipelineSummary.selfHealCount > 0 && <span>{pipelineSummary.selfHealCount}× 自愈</span>}
          {pipelineSummary.timelineStats && (
            <span>{pipelineSummary.timelineStats.tracks}轨 {pipelineSummary.timelineStats.clips}clip {pipelineSummary.timelineStats.durationSec}s</span>
          )}
        </div>
      )}

      <div className="p-2 flex items-center gap-2">
        <input value={topic} onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && launch()}
          placeholder="选题 / 指令…"
          className="flex-1 bg-surface-container rounded-cw-xs px-2.5 py-1.5 text-body-sm text-on-surface
            outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/50" />
        <Button size="sm" onClick={launch} disabled={launching || running}>
          {launching || running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {running ? '运行中' : '启动'}
        </Button>
      </div>
    </div>
  );
}

function BriefCard({ brief, onConfirm, busy, onReview }: { brief: NonNullable<ReturnType<typeof useAgentStore.getState>['creativeBrief']>; onConfirm: () => void; busy: boolean; onReview?: () => void }) {
  return (
    <div className="bg-surface-container border border-primary/30 rounded-cw-md overflow-hidden text-left">
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-primary/20">
        <FileText className="w-3.5 h-3.5 text-primary" />
        <span className="text-label font-medium text-primary">创意简报</span>
      </div>
      <div className="p-3 space-y-1 text-label-sm">
        <span className="block"><span className="text-on-surface-variant">标题：</span>{brief.title}</span>
        <span className="block"><span className="text-on-surface-variant">概述：</span>{brief.overview}</span>
        <span className="block"><span className="text-on-surface-variant">目标受众：</span>{brief.target_audience}</span>
        <span className="block"><span className="text-on-surface-variant">核心信息：</span>{brief.core_message}</span>
        {brief.style_direction && (
          <span className="block"><span className="text-on-surface-variant">风格方向：</span>{brief.style_direction}</span>
        )}
        {brief.structure_suggestion && (
          <span className="block"><span className="text-on-surface-variant">结构建议：</span>{brief.structure_suggestion}</span>
        )}
        <span className="block"><span className="text-on-surface-variant">时长预估：</span>{brief.duration_estimate}</span>
        {brief.key_elements?.length > 0 && (
          <span className="block"><span className="text-on-surface-variant">关键元素：</span>{brief.key_elements.join('、')}</span>
        )}
        {brief.special_requirements?.length > 0 && (
          <span className="block"><span className="text-on-surface-variant">特殊要求：</span>{brief.special_requirements.join('、')}</span>
        )}
        {brief.production_plan && (
          <span className="block"><span className="text-on-surface-variant">制作方案：</span>{brief.production_plan}</span>
        )}
        {brief.reference_style && (
          <span className="block"><span className="text-on-surface-variant">参考风格：</span>{brief.reference_style}</span>
        )}
        {brief.bgm_requirement && (
          <span className="block"><span className="text-on-surface-variant">BGM需求：</span>{brief.bgm_requirement}</span>
        )}
        {brief.era_background && (
          <span className="block"><span className="text-on-surface-variant">年代背景：</span>{brief.era_background}</span>
        )}
        {brief.material_requirements && (
          <div className="mt-1 pt-1 border-t border-outline-variant/10">
            {brief.material_requirements.type && (
              <span className="block"><span className="text-on-surface-variant">素材类型：</span>{brief.material_requirements.type}</span>
            )}
            {brief.material_requirements.source && (
              <span className="block"><span className="text-on-surface-variant">推荐来源：</span>{brief.material_requirements.source}</span>
            )}
            {brief.material_requirements.preference && (
              <span className="block"><span className="text-on-surface-variant">素材偏好：</span>{brief.material_requirements.preference}</span>
            )}
          </div>
        )}
        {brief.animation_style && (
          <div className="mt-1 pt-1 border-t border-outline-variant/10">
            {brief.animation_style.style && (
              <span className="block"><span className="text-on-surface-variant">动画风格：</span>{brief.animation_style.style}</span>
            )}
            {brief.animation_style.tone && (
              <span className="block"><span className="text-on-surface-variant">色调倾向：</span>{brief.animation_style.tone}</span>
            )}
          </div>
        )}
        {brief.asset_ratio && (
          <span className="block"><span className="text-on-surface-variant">素材/动画占比：</span>实拍 {brief.asset_ratio.footage} · MG {brief.asset_ratio.mg}</span>
        )}
      </div>
      <div className="flex gap-2 px-3 pb-3">
        {onReview && (
          <Button size="sm" variant="outline" onClick={onReview} className="flex-1">
            <FileText className="w-3.5 h-3.5" /> 审阅
          </Button>
        )}
        <Button size="sm" onClick={onConfirm} disabled={busy} className="flex-1">
          <Check className="w-3.5 h-3.5" /> 确认简报
        </Button>
      </div>
    </div>
  );
}

function PlanCard({ markdown, onConfirm, busy, onReview }: { markdown?: string; onConfirm: () => void; busy: boolean; onReview?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-surface-container border border-primary/30 rounded-cw-md overflow-hidden text-left">
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-primary/20">
        <ListChecks className="w-3.5 h-3.5 text-primary" />
        <span className="text-label font-medium text-primary">制作规划书</span>
      </div>
      <div className="p-3">
        <div className={`${expanded ? 'max-h-[300px] overflow-y-auto' : 'max-h-24 overflow-hidden'} transition-all`}>
          <Markdown text={markdown || ''} />
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-label text-primary hover:underline mt-1.5 cursor-pointer">
          {expanded ? '收起' : '展开全文'}
        </button>
      </div>
      <div className="flex gap-2 px-3 pb-3">
        {onReview && (
          <Button size="sm" variant="outline" onClick={onReview} className="flex-1">
            <FileText className="w-3.5 h-3.5" /> 审阅
          </Button>
        )}
        <Button size="sm" onClick={onConfirm} disabled={busy} className="flex-1">
          <Zap className="w-3.5 h-3.5" /> 确认并启动管线
        </Button>
      </div>
    </div>
  );
}

function buildGroups(entries: ReturnType<typeof useAgentStore.getState>['logEntries']) {
  const groups: { agent: string; entries: typeof entries }[] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.agent === e.agent) {
      last.entries.push(e);
    } else {
      groups.push({ agent: e.agent, entries: [e] });
    }
  }
  return groups;
}

function normalizePhase(name: string): PipelinePhase {
  const n = name.toLowerCase();
  if (n.includes('structure')) return 'structure';
  if (n.includes('material')) return 'material';
  if (n.includes('edit')) return 'edit';
  if (n.includes('animation')) return 'animation';
  if (n.includes('audio')) return 'audio';
  if (n.includes('quality')) return 'quality';
  if (n.includes('self_heal') || n.includes('heal')) return 'self_heal';
  return 'structure';
}

export function demoBrief(topic: string) {
  return {
    title: `《${topic}》`, overview: `围绕「${topic}」展开的知识型视频，以问题驱动叙事。`,
    target_audience: '对该主题感兴趣的大众观众',
    core_message: `用 3 个关键论点把「${topic}」讲清楚。`,
    style_direction: '理性克制 + 信息密度高',
    structure_suggestion: '钩子 → 背景 → 论点×3 → 总结',
    duration_estimate: '3-5 分钟',
    key_elements: ['数据可视化', '关键词标注', 'B-roll 穿插'],
    special_requirements: [],
  };
}

function demoPlanMarkdown(topic: string) {
  return `# 制作规划书：${topic || '未命名选题'}\n\n## 一、整体结构\n- 00:00-00:20  钩子\n- 00:20-01:00  背景\n- 01:00-03:30  三个核心论点\n- 03:30-04:00  总结\n\n## 二、场景列表\n1. 开场钩子\n2. 数据展示\n3. 论点一\n4. 论点二\n5. 论点三\n6. 结尾引导`;
}
