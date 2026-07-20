import { useState, useEffect, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useProjectStore } from '@/stores/projectStore';
import { createEmptyTimeline } from '@/types/timeline';
import { pipelineApi, requirementsApi, personaApi } from '@/services/api';
import { Button, Badge } from '@/components/ui';
import { uid } from '@/lib/utils';
import type { PipelinePhase } from '@/types/pipeline';
import {
  Bot, Send, Sparkles, Check, X, FileText, ListChecks, Loader2, Zap,
} from 'lucide-react';

const PHASE_LABELS: Record<PipelinePhase, string> = {
  idle: '待命', structure: '结构 Agent', material: '素材 Agent', edit: '剪辑 Agent',
  animation: '动画 Agent', audio: '音效 Agent', quality: '质检 Agent',
  self_heal: '自愈', completed: '完成', failed: '失败',
};

const PHASE_ORDER: PipelinePhase[] = ['structure', 'material', 'edit', 'animation', 'audio', 'quality'];

/**
 * AgentPanel — the AI co-pilot. Two-stage requirements workflow + pipeline
 * execution with real-time SSE progress + agent timeline diff/accept.
 */
export function AgentPanel() {
  const [tab, setTab] = useState<'requirements' | 'pipeline'>('requirements');

  return (
    <div className="flex flex-col h-full bg-surface-container-low">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/30 shrink-0">
        <div className="w-6 h-6 rounded-cw-full bg-primary-container flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-on-primary-container" />
        </div>
        <span className="text-label font-medium text-on-surface-variant uppercase tracking-wide">
          Agent 副驾驶
        </span>
        <span className="ml-auto w-2 h-2 rounded-cw-full bg-track-audio animate-pulse" title="在线" />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-outline-variant/30 shrink-0">
        <button
          onClick={() => setTab('requirements')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-label font-medium border-b-2 transition-colors cursor-pointer ${
            tab === 'requirements' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <ListChecks className="w-3.5 h-3.5" />
          需求规划
        </button>
        <button
          onClick={() => setTab('pipeline')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-label font-medium border-b-2 transition-colors cursor-pointer ${
            tab === 'pipeline' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          生成管线
        </button>
      </div>

      <div className="flex-1 overflow-hidden min-h-0">
        {tab === 'requirements' ? <RequirementsView /> : <PipelineView />}
      </div>
    </div>
  );
}

// ── Requirements (two-stage pre-pipeline workflow) ─────
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

  const [topic, setTopic] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
      // Offline demo: synthesize a brief so the flow is demonstrable
      const brief = demoBrief(topic);
      setBrief(brief);
      setStatus('brief_ready');
      addMessage({
        id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(),
        content: '已为你生成创意简报，请审阅后确认。', creative_brief: brief,
      });
    } finally {
      setBusy(false);
    }
  };

  const sendChat = async (sessionId: string, message: string) => {
    addMessage({ id: uid('m'), role: 'user', content: message, timestamp: new Date().toISOString() });
    setBusy(true);
    try {
      const res = await requirementsApi.chat({ session_id: sessionId, message });
      const brief = res.creative_brief ?? null;
      const plan = res.production_plan ?? null;
      if (brief) { setBrief(brief); setStatus('brief_ready'); }
      if (plan) { setPlan(plan); setStatus('plan_ready'); }
      addMessage({
        id: uid('m'), role: 'assistant', content: res.reply ?? res.message ?? '已收到。',
        timestamp: new Date().toISOString(), creative_brief: brief, production_plan: plan,
      });
    } catch {
      addMessage({
        id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(),
        content: '（离线演示）已记录你的需求。连接后端后将由需求 Agent 实时响应。',
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmBrief = async () => {
    setStatus('planning');
    addMessage({ id: uid('m'), role: 'user', content: '确认创意简报，请生成制作规划书。', timestamp: new Date().toISOString() });
    setBusy(true);
    const sid = useAgentStore.getState().requirementsSessionId;
    if (sid) {
      await sendChat(sid, '创意简报已确认，请生成完整的制作规划书。');
    } else {
      // Offline demo plan
      await new Promise((r) => setTimeout(r, 600));
      const plan = { markdown: demoPlanMarkdown(topic) };
      setPlan(plan);
      setStatus('plan_ready');
      addMessage({
        id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(),
        content: '制作规划书已生成，请审阅。', production_plan: plan,
      });
    }
    setBusy(false);
  };

  const confirmPlan = async () => {
    setStatus('pipeline_running');
    const sid = useAgentStore.getState().requirementsSessionId;
    if (sid) {
      try {
        await requirementsApi.proceed(sid, useProjectStore.getState().personaId ?? 'default', 'knowledge_longform');
      } catch { /* offline */ }
    }
    addMessage({
      id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(),
      content: '已确认规划书并触发生产管线。请切换到「生成管线」标签查看实时进度。',
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <WelcomeCard />
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}

        {/* Creative brief card */}
        {creativeBrief && status === 'brief_ready' && (
          <BriefCard brief={creativeBrief} onConfirm={confirmBrief} busy={busy} />
        )}

        {/* Production plan card */}
        {productionPlan && status === 'plan_ready' && (
          <PlanCard markdown={productionPlan.markdown} onConfirm={confirmPlan} busy={busy} />
        )}

        {busy && (
          <div className="flex items-center gap-2 text-label-sm text-on-surface-variant">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
            需求 Agent 思考中…
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-outline-variant/30 shrink-0">
        {messages.length === 0 ? (
          <div className="flex gap-2">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && startSession()}
              placeholder="输入你的视频选题…"
              className="flex-1 bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
                outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/50"
            />
            <Button size="sm" onClick={startSession} disabled={!topic.trim() || busy}>
              <Sparkles className="w-3.5 h-3.5" />
              开始
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && input.trim()) {
                  const sid = useAgentStore.getState().requirementsSessionId;
                  const msg = input;
                  setInput('');
                  if (sid) sendChat(sid, msg);
                  else addMessage({ id: uid('m'), role: 'user', content: msg, timestamp: new Date().toISOString() });
                }
              }}
              placeholder="继续与需求 Agent 对话…"
              className="flex-1 bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
                outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/50"
            />
            <Button size="icon" onClick={() => {
              const sid = useAgentStore.getState().requirementsSessionId;
              if (input.trim() && sid) { const m = input; setInput(''); sendChat(sid, m); }
            }} disabled={!input.trim() || busy}>
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function WelcomeCard() {
  return (
    <div className="bg-agent-bubble/40 border border-primary-container/40 rounded-cw-md p-3">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="text-body-sm font-medium text-on-surface">需求 Agent</span>
      </div>
      <p className="text-label-sm text-on-surface-variant leading-relaxed">
        你好！我是需求 Agent。告诉我你的视频选题，我会先帮你梳理<b className="text-on-surface">创意简报</b>，
        确认后再生成完整的<b className="text-on-surface">制作规划书</b>，最后一键触发生产管线。
      </p>
    </div>
  );
}

function MessageBubble({ role, content }: { role: 'user' | 'assistant' | 'system'; content: string }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-cw-md px-3 py-2 text-body-sm leading-relaxed ${
          isUser
            ? 'bg-primary-container text-on-primary-container rounded-br-cw-xs'
            : 'bg-surface-container text-on-surface rounded-bl-cw-xs border border-outline-variant/20'
        }`}
      >
        {content}
      </div>
    </div>
  );
}

function BriefCard({ brief, onConfirm, busy }: { brief: NonNullable<ReturnType<typeof useAgentStore.getState>['creativeBrief']>; onConfirm: () => void; busy: boolean }) {
  return (
    <div className="bg-surface-container border border-primary/30 rounded-cw-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-primary/20">
        <FileText className="w-3.5 h-3.5 text-primary" />
        <span className="text-label font-medium text-primary">创意简报</span>
      </div>
      <div className="p-3 space-y-1.5 text-label-sm">
        <BriefRow k="标题" v={brief.title} />
        <BriefRow k="概述" v={brief.overview} />
        <BriefRow k="目标受众" v={brief.target_audience} />
        <BriefRow k="核心信息" v={brief.core_message} />
        <BriefRow k="风格方向" v={brief.style_direction} />
        <BriefRow k="时长估算" v={brief.duration_estimate} />
        {brief.key_elements.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {brief.key_elements.map((el, i) => <Badge key={i} variant="info">{el}</Badge>)}
          </div>
        )}
      </div>
      <div className="flex gap-2 px-3 pb-3">
        <Button size="sm" onClick={onConfirm} disabled={busy} className="flex-1">
          <Check className="w-3.5 h-3.5" />
          确认简报
        </Button>
      </div>
    </div>
  );
}

function BriefRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-on-surface-variant shrink-0 w-16">{k}</span>
      <span className="text-on-surface">{v}</span>
    </div>
  );
}

function PlanCard({ markdown, onConfirm, busy }: { markdown: string; onConfirm: () => void; busy: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lines = markdown.split('\n');
  const toc = lines.filter((l) => l.startsWith('#')).map((l) => l.replace(/^#+\s*/, ''));
  return (
    <div className="bg-surface-container border border-primary/30 rounded-cw-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-primary/20">
        <ListChecks className="w-3.5 h-3.5 text-primary" />
        <span className="text-label font-medium text-primary">制作规划书</span>
      </div>
      <div className="p-3">
        {/* TOC */}
        <div className="flex flex-wrap gap-1 mb-2">
          {toc.slice(0, 6).map((t, i) => <Badge key={i} variant="default">{t}</Badge>)}
        </div>
        <pre className={`text-label-sm font-mono text-on-surface-variant whitespace-pre-wrap leading-relaxed ${expanded ? '' : 'max-h-28 overflow-hidden'}`}>
          {markdown}
        </pre>
        <button onClick={() => setExpanded(!expanded)} className="text-label text-primary hover:underline mt-1 cursor-pointer">
          {expanded ? '收起' : '展开全文'}
        </button>
      </div>
      <div className="flex gap-2 px-3 pb-3">
        <Button size="sm" onClick={onConfirm} disabled={busy} className="flex-1">
          <Zap className="w-3.5 h-3.5" />
          确认并生产
        </Button>
      </div>
    </div>
  );
}

// ── Pipeline view ──────────────────────────────────────
function PipelineView() {
  const phase = useAgentStore((s) => s.phase);
  const progress = useAgentStore((s) => s.progress);
  const pipelineId = useAgentStore((s) => s.pipelineId);
  const agentTimeline = useAgentStore((s) => s.agentTimeline);
  const error = useAgentStore((s) => s.error);
  const updatePhase = useAgentStore((s) => s.updatePhase);
  const setPipelineId = useAgentStore((s) => s.setPipelineId);
  const setAgentTimeline = useAgentStore((s) => s.setAgentTimeline);
  const setError = useAgentStore((s) => s.setError);

  const [topic, setTopic] = useState('');
  const esRef = useRef<EventSource | null>(null);

  const runPipeline = async () => {
    setError(null);
    setAgentTimeline(null);
    updatePhase('structure', 5);
    try {
      const res = await pipelineApi.runAsync({
        persona_id: useProjectStore.getState().personaId ?? 'default',
        category_plugin_id: useProjectStore.getState().pluginId ?? 'knowledge_longform',
        topic: topic || '未命名选题',
        use_v2: true,
      });
      setPipelineId(res.pipeline_id);
      openSSE(res.pipeline_id);
    } catch {
      // Offline demo: simulate a pipeline run
      simulatePipeline();
    }
  };

  const openSSE = (pid: string) => {
    esRef.current?.close();
    const es = new EventSource(pipelineApi.getTraceStreamUrl(pid));
    esRef.current = es;
    es.addEventListener('agent_start', (e) => {
      const { agent_name } = JSON.parse((e as MessageEvent).data);
      updatePhase(normalizePhase(agent_name));
    });
    es.addEventListener('timeline_snapshot', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      if (data.timeline) setAgentTimeline(data.timeline);
    });
    es.addEventListener('agent_complete', (e) => {
      const { agent_name, result } = JSON.parse((e as MessageEvent).data);
      if (agent_name === 'edit_agent' && result?.timeline) setAgentTimeline(result.timeline);
    });
    es.addEventListener('pipeline_complete', () => { updatePhase('completed', 100); es.close(); });
    es.addEventListener('agent_error', (e) => {
      const { error: err } = JSON.parse((e as MessageEvent).data);
      setError(err ?? '管线执行出错'); updatePhase('failed'); es.close();
    });
    es.onerror = () => { es.close(); };
  };

  const simulatePipeline = () => {
    setPipelineId(uid('pl'));
    let i = 0;
    const step = () => {
      if (i >= PHASE_ORDER.length) {
        updatePhase('completed', 100);
        setAgentTimeline(demoTimeline());
        return;
      }
      updatePhase(PHASE_ORDER[i], Math.round(((i + 1) / PHASE_ORDER.length) * 90));
      i++;
      setTimeout(step, 700);
    };
    step();
  };

  const acceptTimeline = () => {
    if (agentTimeline) {
      useTimelineStore.getState().setTimeline(agentTimeline);
      useAgentStore.getState().resetPipeline();
    }
  };

  const running = pipelineId !== null && phase !== 'completed' && phase !== 'failed' && phase !== 'idle';

  useEffect(() => () => esRef.current?.close(), []);

  return (
    <div className="flex flex-col h-full p-3 space-y-3 overflow-y-auto">
      {/* Topic input */}
      <div>
        <label className="text-label text-on-surface-variant block mb-1.5">选题 / 指令</label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={2}
          placeholder="描述你要生成的视频…"
          className="w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
            outline-none border border-outline-variant/30 focus:border-primary resize-none placeholder:text-on-surface-variant/50"
        />
      </div>

      <Button onClick={runPipeline} disabled={running} className="w-full">
        {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        {running ? '管线执行中…' : '生成初稿'}
      </Button>

      {/* Phase progress */}
      {(running || phase === 'completed' || phase === 'failed') && (
        <div className="space-y-1.5">
          {PHASE_ORDER.map((p) => {
            const idx = PHASE_ORDER.indexOf(p);
            const curIdx = PHASE_ORDER.indexOf(phase as PipelinePhase);
            const done = phase === 'completed' || (curIdx > idx);
            const active = phase === p;
            return (
              <div key={p} className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded-cw-full flex items-center justify-center shrink-0 text-caption
                  ${done ? 'bg-track-audio text-black' : active ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>
                  {done ? <Check className="w-2.5 h-2.5" /> : active ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : idx + 1}
                </span>
                <span className={`text-label-sm ${active ? 'text-primary font-medium' : done ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                  {PHASE_LABELS[p]}
                </span>
                {active && (
                  <div className="flex-1 h-1 bg-surface-container rounded-cw-full overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-medium2 animate-pulse" style={{ width: `${progress % 100 || 50}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="bg-error/10 border border-error/30 rounded-cw-sm px-3 py-2 text-label-sm text-error">
          {error}
        </div>
      )}

      {/* Agent timeline diff / accept */}
      {agentTimeline && phase === 'completed' && (
        <div className="bg-surface-container border border-track-audio/40 rounded-cw-md p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-track-audio" />
            <span className="text-body-sm font-medium text-on-surface">初稿时间线已就绪</span>
          </div>
          <p className="text-label-sm text-on-surface-variant">
            {agentTimeline.tracks.length} 条轨道 · {agentTimeline.duration_sec.toFixed(1)}s ·
            共 {agentTimeline.tracks.reduce((n, t) => n + t.clips.length, 0)} 个片段
          </p>
          {/* Mini track preview */}
          <div className="space-y-1">
            {agentTimeline.tracks.slice(0, 4).map((t) => (
              <div key={t.id} className="flex items-center gap-1.5">
                <span className="text-caption text-on-surface-variant w-10 truncate">{t.kind}</span>
                <div className="flex-1 h-3 bg-surface rounded-cw-xs overflow-hidden flex">
                  {t.clips.map((c) => (
                    <div
                      key={c.id}
                      className="h-full opacity-80"
                      style={{
                        width: `${(c.duration_sec / (agentTimeline.duration_sec || 1)) * 100}%`,
                        background: '#4F8CFF',
                        marginLeft: `${(c.start_sec / (agentTimeline.duration_sec || 1)) * 100}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={acceptTimeline} className="flex-1">
              <Check className="w-3.5 h-3.5" />
              接受并载入时间轴
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAgentTimeline(null)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function normalizePhase(agentName: string): PipelinePhase {
  const n = agentName.toLowerCase();
  if (n.includes('structure')) return 'structure';
  if (n.includes('material')) return 'material';
  if (n.includes('edit')) return 'edit';
  if (n.includes('animation')) return 'animation';
  if (n.includes('audio')) return 'audio';
  if (n.includes('quality')) return 'quality';
  return 'structure';
}

// ── offline demo data ──────────────────────────────────
function demoBrief(topic: string) {
  return {
    title: `《${topic}》`,
    overview: `围绕「${topic}」展开的 3-5 分钟知识型视频，以问题驱动叙事。`,
    target_audience: '对该主题感兴趣的大众观众与入门学习者',
    core_message: `用 3 个关键论点把「${topic}」讲清楚、讲透。`,
    style_direction: '理性克制 + 信息密度高，硬切为主，关键词标注动画',
    structure_suggestion: '钩子 → 背景 → 论点×3 → 总结 → 引导互动',
    duration_estimate: '3-5 分钟',
    key_elements: ['数据可视化', '关键词标注', 'B-roll 穿插', '片尾引导'],
    special_requirements: [],
  };
}

function demoPlanMarkdown(topic: string) {
  return `# 制作规划书：${topic || '未命名选题'}

## 一、整体结构
- 00:00-00:20  钩子：抛出核心问题
- 00:20-01:00  背景铺垫
- 01:00-03:30  三个核心论点
- 03:30-04:00  总结与升华

## 二、场景列表
1. 开场钩子（快剪 + 大字幕）
2. 数据展示（MG 动画）
3. 论点一（B-roll + 旁白）
4. 论点二（对比图表）
5. 论点三（案例实拍）
6. 结尾引导（关注/三连）

## 三、动画与特效
- 关键词标注：琥珀色高亮
- 转场：硬切为主，重点处闪白
- 数据图表：缓入动画

## 四、音频设计
- BGM：低音量环境铺垫
- 旁白：清晰主声道，重点处停顿留白`;
}

function demoTimeline() {
  const tl = createEmptyTimeline(uid('tl'));
  tl.duration_sec = 240;
  const v = { id: uid('tr'), name: 'V1', kind: 'video' as const, index: 0, locked: false, muted: false, clips: [] as any[] };
  const a = { id: uid('tr'), name: 'A1', kind: 'audio' as const, index: 1, locked: false, muted: false, clips: [] as any[] };
  const t = { id: uid('tr'), name: 'T1', kind: 'text' as const, index: 2, locked: false, muted: false, clips: [] as any[] };
  let cursor = 0;
  const scenes = [20, 40, 50, 60, 45, 25];
  scenes.forEach((dur, i) => {
    v.clips.push({
      id: uid('clip'), kind: 'video', asset_id: `scene_${i + 1}.mp4`, track_id: v.id,
      start_sec: cursor, duration_sec: dur, source_offset_sec: 0, speed: 1, volume: 1,
      opacity: 1, keyframes: [], metadata: { title: `场景 ${i + 1}` },
    });
    t.clips.push({
      id: uid('clip'), kind: 'text', asset_id: '', track_id: t.id,
      start_sec: cursor, duration_sec: Math.min(dur, 8), source_offset_sec: 0, speed: 1,
      volume: 1, opacity: 1, text: `论点 ${i + 1}`, font_size: 56, font_color: '#FBBF24',
      keyframes: [], metadata: {},
    });
    cursor += dur;
  });
  a.clips.push({
    id: uid('clip'), kind: 'audio', asset_id: 'bgm.mp3', track_id: a.id,
    start_sec: 0, duration_sec: cursor, source_offset_sec: 0, speed: 1, volume: 0.3,
    opacity: 1, keyframes: [], metadata: { title: '背景音乐' },
  });
  tl.tracks = [v, a, t];
  tl.duration_sec = cursor;
  return tl;
}
