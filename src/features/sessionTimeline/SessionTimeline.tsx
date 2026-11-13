/**
 * 会话时间线视图（session-timeline PRD §6，2026-10-31）。
 *
 * 一条流承载一轮会话里的**所有**东西：思考、正文、工具/技能/子 agent、简报、规划书、
 * 提问/回答、产物、降级、阶段进度。
 *
 * 渲染侧只有三件职责：
 * 1. **按 seq 顺序**铺开（顺序来自服务端，组件绝不排序）；
 * 2. **窗口化**（首屏最近 N 条 + 滚到顶自动加载更早）；
 * 3. **条目级折叠**（只有仍在流式中的思考默认展开，历史默认折叠且尊重手动展开）。
 *
 * 正文气泡与简报/规划书卡片由调用方注入（`renderContent` / `renderReport` / `renderPlan`），
 * 否则 Markdown、简报卡、规划书卡、时间戳这些"本来就有的东西"会被新面板悄悄丢掉。
 */

import React from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';

import { cn } from '@/lib/utils';
import { asText, textList } from '@/lib/render';
import { handleArtifactClick } from '@/features/copilot/artifactOpen';
import {
  EMPTY_BUCKET,
  itemsOf,
  useSessionTimelineStore,
  type SessionLinkState,
} from '@/stores/sessionTimelineStore';
import {
  isBriefItem,
  itemObject,
  itemText,
  type SessionTimelineItem,
} from '@/features/sessionTimeline/types';
import {
  loadEarlier,
  useRetrySessionTimeline,
  useSessionTimeline,
} from '@/features/sessionTimeline/useSessionTimeline';

const WINDOW = 120;

const ORIGIN_CN: Record<string, string> = {
  main: '主 agent', subagent: '子 agent', skill: '技能', internal: '内部',
};

// T-04：中文界面里不直接吐内部枚举。原始值留进 title，便于排查而不干扰阅读。
const STATUS_CN: Record<string, string> = {
  pending: '待处理', approved: '已授权', rejected: '已拒绝', denied: '已拒绝',
  ok: '成功', done: '完成', success: '成功', error: '出错', failed: '失败',
  dry_run: '试运行', running: '进行中', streaming: '进行中', interrupted: '中断',
  skipped: '跳过', cancelled: '已取消', timeout: '超时',
};
const RISK_CN: Record<string, string> = {
  low: '低风险', medium: '中风险', high: '高风险', critical: '极高风险',
};
const TYPE_CN: Record<string, string> = {
  thinking: '思考', content: '正文', tool: '工具', skill: '技能',
  subagent: '子 agent', report: '汇报', plan: '规划书', question: '提问',
  answer: '回答', approval: '授权', degradation: '降级', stage: '阶段', artifact: '产物',
};

/** 统一状态映射：未知值显示「其他」，title 里保留原始枚举值。 */
function enumLabel(raw: unknown, table: Record<string, string>): { label: string; raw: string } {
  const original = asText(raw);
  const known = Object.prototype.hasOwnProperty.call(table, original);
  return { label: known ? table[original] : '其他', raw: original };
}

function StateBadge({ item }: { item: SessionTimelineItem }) {
  if (item.state === 'streaming') {
    return <span className="text-caption text-on-surface-variant/70">进行中…</span>;
  }
  if (item.state === 'failed') {
    return <span className="text-caption text-error">失败</span>;
  }
  if (item.state === 'interrupted') {
    return (
      <span className="text-caption text-warning" title="进程中断，内容只到上一次落盘">
        中断
      </span>
    );
  }
  return null;
}

function ThinkingRow({ item }: { item: SessionTimelineItem }) {
  // T-08：只有当前仍在流式中的思考默认展开；历史思考默认折叠。
  // `manual` 用 state 记住用户手动展开/折叠，条目状态随后变化也不抢这个选择。
  const [manual, setManual] = React.useState<boolean | null>(null);
  const open = manual ?? (item.state === 'streaming');
  const text = itemText(item);
  const truncated = !!(item.meta?.truncated || item.state === 'interrupted');
  return (
    <div className="px-2 py-1" data-testid="session-item-thinking" data-seq={item.seq}>
      <button
        type="button"
        className="flex items-center gap-1 text-caption text-on-surface-variant hover:text-on-surface"
        onClick={() => setManual((v) => !(v ?? (item.state === 'streaming')))}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        思考（{text.length.toLocaleString()} 字）
        {item.state === 'streaming' ? ' · 进行中' : ''}
      </button>
      {open && (
        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-cw-sm bg-surface-container p-2 text-caption text-on-surface-variant">
          {text}
        </pre>
      )}
      {truncated && (
        <div className="mt-0.5 text-caption text-warning/80">
          {item.state === 'interrupted'
            ? '本轮中断，内容截到上一次落盘'
            : `思考过长已截断（原文 ${Number(item.meta?.chars_full ?? 0).toLocaleString()} 字）`}
        </div>
      )}
    </div>
  );
}

// T-03：按条目 id 记提交结果（组件内 state，切会话不串），提交成功即撤掉整组按钮。
type SubmittedMap = Record<string, string>;
type OnSubmitted = (id: string, note: string) => void;

function ApprovalRow({ item, submittedNote, onSubmitted }: {
  item: SessionTimelineItem;
  submittedNote?: string;
  onSubmitted: OnSubmitted;
}) {
  const taskId = typeof item.meta?.task_id === 'string' ? item.meta.task_id : '';
  const status = enumLabel(
    item.meta?.status ?? (item.state === 'streaming' ? 'pending' : 'done'), STATUS_CN);
  const tool = asText(item.meta?.tool);
  const riskRaw = asText(item.meta?.risk);
  const risk = enumLabel(riskRaw, RISK_CN);
  const approvalId = typeof item.meta?.approval_id === 'string' ? item.meta.approval_id : '';
  const locked = !!submittedNote;
  return (
    <div className="flex flex-wrap items-baseline gap-2 px-2 py-0.5 text-caption"
      data-testid="session-item-approval" data-seq={item.seq}>
      <span className="text-warning">授权</span>
      <span className="text-on-surface-variant">{tool}</span>
      <span className="text-on-surface-variant/80" title={status.raw}>{status.label}</span>
      {riskRaw && <span className="text-on-surface-variant/60" title={riskRaw}>{risk.label}</span>}
      {locked
        ? <span className="text-on-surface-variant/80">{submittedNote}</span>
        : (approvalId && taskId &&
          <ApprovalButtons taskId={taskId} approvalId={approvalId} risk={riskRaw}
            onSubmitted={(note) => onSubmitted(`approval:${approvalId}`, note)} />)}
    </div>
  );
}

function ApprovalButtons({ taskId, approvalId, risk, onSubmitted }: {
  taskId: string; approvalId: string; risk: string;
  onSubmitted: (note: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');
  const submit = async (approve: boolean) => {
    if (busy) return;
    const highRisk = risk === 'high' || risk === 'critical';
    if (approve && highRisk && !window.confirm(`这条操作被判定为 ${risk} 风险，确认授权？`)) return;
    setBusy(true);
    try {
      const { supervisorApi } = await import('@/services/api');
      if (approve) await supervisorApi.approveExec(taskId, approvalId, highRisk, risk === 'critical');
      else await supervisorApi.rejectExec(taskId, approvalId);
      // 提交成功即锁定该条目的所有按钮，只留结果（T-03）
      onSubmitted(approve ? '已授权' : '已拒绝');
      return;
    } catch (e) {
      setNote(`提交失败：${(e as Error)?.message || '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" disabled={busy}
        data-approval-approve={approvalId}
        className="rounded-cw-xs border border-primary/40 px-1.5 text-primary hover:bg-primary/10 disabled:opacity-50"
        onClick={() => void submit(true)}>授权</button>
      <button type="button" disabled={busy}
        data-approval-reject={approvalId}
        className="rounded-cw-xs border border-error/40 px-1.5 text-error hover:bg-error/10 disabled:opacity-50"
        onClick={() => void submit(false)}>拒绝</button>
      {note && <span className="text-on-surface-variant/80">{note}</span>}
    </>
  );
}

/** 问题条目上的作答入口（选项 + 可选自由文本）。提交走 requirementsApi.answer。 */
function QuestionActions({
  questionId, options, allowFreeText, onAnswer, submittedNote, onSubmitted,
}: {
  questionId: string;
  options: { id?: string; label?: string; detail?: string }[];
  allowFreeText: boolean;
  onAnswer?: (a: { questionId: string; optionId?: string | null; text?: string | null }) => Promise<void>;
  submittedNote?: string;
  onSubmitted: OnSubmitted;
}) {
  const [busy, setBusy] = React.useState(false);
  const [freeText, setFreeText] = React.useState('');
  const [note, setNote] = React.useState('');
  // 提交结果按条目 id 存在父组件：本组件重挂载（窗口化 / 折叠）也仍锁定
  const done = !!submittedNote;
  if (!onAnswer || !questionId) return null;

  const submit = async (optionId?: string | null, text?: string | null) => {
    if (busy || done) return;
    setBusy(true);
    try {
      await onAnswer({ questionId, optionId: optionId ?? null, text: text ?? null });
      // 提交成功即锁定整组按钮，只留结果（T-03）
      onSubmitted(`question:${questionId}`, '已提交');
      return;
    } catch (e) {
      setNote(`提交失败：${(e as Error)?.message || '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5"
      data-testid="session-question-actions">
      {done
        ? <span className="text-on-surface-variant/80">{submittedNote}</span>
        : <>
      {options.map((opt) => {
        const id = asText(opt.id);
        return (
          <button
            key={id || asText(opt.label)}
            type="button"
            disabled={busy}
            data-question-option={id}
            title={asText(opt.detail)}
            className="rounded-cw-xs border border-primary/40 px-2 py-0.5 text-primary hover:bg-primary/10 disabled:opacity-50"
            onClick={() => void submit(id, null)}
          >
            {asText(opt.label) || id}
          </button>
        );
      })}
      {allowFreeText && (
        <>
          <input
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="自己说…"
            data-testid="session-question-free-text"
            className="w-40 rounded-cw-xs border border-outline-variant/40 bg-surface-container px-2 py-0.5 text-caption text-on-surface outline-none focus:border-primary"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && freeText.trim()) {
                void submit(null, freeText.trim());
              }
            }}
          />
          <button
            type="button"
            disabled={busy || !freeText.trim()}
            data-testid="session-question-submit"
            className="rounded-cw-xs border border-outline-variant/40 px-2 py-0.5 text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
            onClick={() => void submit(null, freeText.trim())}
          >
            提交
          </button>
        </>
      )}
      </>}
      {note && !done && <span className="text-on-surface-variant/80">{note}</span>}
    </div>
  );
}

function Row({
  item, answeredQids, onAnswer, submitted, onSubmitted,
}: {
  item: SessionTimelineItem;
  answeredQids: Set<string>;
  onAnswer?: (a: { questionId: string; optionId?: string | null; text?: string | null }) => Promise<void>;
  submitted: SubmittedMap;
  onSubmitted: OnSubmitted;
}) {
  switch (item.type) {
    case 'thinking':
      return <ThinkingRow item={item} />;
    case 'tool':
    case 'skill':
    case 'subagent': {
      const originRaw = asText(item.meta?.event_type);
      const isSkill = item.type === 'skill' || asText(item.meta?.kind) === 'skill';
      const origin = isSkill ? 'skill'
        : item.type === 'subagent' ? 'subagent'
          : originRaw === 'subagent_tool' ? 'subagent' : 'main';
      const label = (asText(item.meta?.skill)
        || asText(item.meta?.tool ?? item.meta?.agent)
        || itemText(item)).replace(/^skill:/, '');
      const status = enumLabel(item.meta?.status ?? item.state, STATUS_CN);
      const ms = typeof item.meta?.duration_ms === 'number' ? item.meta.duration_ms : undefined;
      const errText = asText(item.meta?.error);
      return (
        <div className="flex items-baseline gap-2 px-2 py-0.5 text-caption"
          data-testid="session-item-tool" data-seq={item.seq} data-origin={origin}>
          <Wrench className="h-3 w-3 shrink-0 text-on-surface-variant/60" />
          {isSkill && <span className="shrink-0 rounded-cw-xs bg-primary/15 px-1 text-primary">技能</span>}
          <span className="w-14 shrink-0 text-on-surface-variant/60">
            {ORIGIN_CN[origin] ?? origin}
          </span>
          <span className="w-40 shrink-0 truncate font-mono text-on-surface-variant">{label}</span>
          <span className={item.state === 'failed' ? 'text-error' : 'text-primary'}
            title={status.raw}>{status.label}</span>
          {typeof ms === 'number' && <span className="text-on-surface-variant/60">{ms}ms</span>}
          {errText && <span className="truncate text-error/80">{errText}</span>}
        </div>
      );
    }
    case 'stage':
    case 'degradation': {
      const label = asText(item.meta?.stage ?? item.meta?.kind ?? item.meta?.event_type
        ?? item.type);
      const summary = itemText(item) || asText(item.meta?.message);
      const status = enumLabel(item.meta?.status ?? item.state, STATUS_CN);
      return (
        <div className="flex items-baseline gap-2 px-2 py-0.5 text-caption"
          data-testid="session-item-stage" data-seq={item.seq}>
          <span className={cn(
            'rounded-cw-xs px-1',
            item.type === 'degradation'
              ? 'bg-warning/15 text-warning'
              : 'bg-surface-container text-on-surface-variant',
          )}>
            {item.type === 'degradation' ? '降级' : label}
          </span>
          <span className="text-on-surface-variant/80" title={status.raw}>{status.label}</span>
          {summary && <span className="truncate text-on-surface-variant/70">{summary}</span>}
        </div>
      );
    }
    case 'approval':
      return <ApprovalRow item={item}
        submittedNote={submitted[`approval:${asText(item.meta?.approval_id)}`]}
        onSubmitted={onSubmitted} />;
    case 'question': {
      const obj = itemObject(item);
      const qid = asText(item.meta?.question_id ?? obj.question_id);
      const question = asText(item.meta?.question ?? obj.question) || itemText(item);
      const submittedNote = submitted[`question:${qid}`];
      // 本地提交由 QuestionActions 自己按 id 锁定并留「已提交」；服务端 answer 到达后
      // answeredQids 继续兜底（整组入口让位给「已答」）。
      const answered = qid ? answeredQids.has(qid) : false;
      const options = Array.isArray(obj.options) ? obj.options : [];
      const allowFreeText = obj.allow_free_text === true
        || item.meta?.allow_free_text === true;
      return (
        <div className="px-2 py-1 text-caption" data-testid="session-item-question"
          data-seq={item.seq} data-answered={answered ? '1' : '0'}>
          <div>
            <span className="mr-1 text-warning">{answered ? '已答' : '待答'}</span>
            <span className="text-on-surface">{question}</span>
          </div>
          {/* 条目上直接能拍板：不再逼用户去面板下方的旧问题卡（T3.3） */}
          {!answered && (
            <QuestionActions
              questionId={qid}
              options={options}
              allowFreeText={allowFreeText}
              onAnswer={onAnswer}
              submittedNote={submittedNote}
              onSubmitted={onSubmitted}
            />
          )}
        </div>
      );
    }
    case 'answer': {
      const text = itemText(item);
      return (
        <div className="px-2 py-0.5 text-caption" data-testid="session-item-answer"
          data-seq={item.seq}>
          <span className="mr-1 text-primary">已答</span>
          <span className="text-on-surface-variant/80">{text}</span>
        </div>
      );
    }
    case 'artifact': {
      const path = typeof item.meta?.path === 'string' ? item.meta.path : '';
      const label = asText(item.meta?.title ?? item.meta?.artifact) || itemText(item);
      return (
        <div className="flex items-baseline gap-2 px-2 py-0.5 text-caption"
          data-testid="session-item-artifact" data-seq={item.seq}>
          <span className="rounded-cw-xs bg-surface-container px-1 text-on-surface-variant">产物</span>
          {path ? (
            // 直接点击 → 应用内新开标签；Ctrl/⌘+点击 → 系统默认程序打开
            <button type="button"
              title="点击在应用内打开；Ctrl/⌘+点击用系统默认程序打开"
              data-artifact-path={path}
              className="max-w-full truncate text-on-surface underline decoration-dotted hover:text-primary"
              onClick={(e) => { void handleArtifactClick(e, path); }}>
              {label || path.split(/[\\/]/).pop()}
            </button>
          ) : <span className="text-on-surface">{label}</span>}
          {path && (
            <span className="max-w-[45%] truncate font-mono text-caption text-on-surface-variant/50"
              title={path}>
              {path.split(/[\\/]/).slice(-2).join('/')}
            </span>
          )}
        </div>
      );
    }
    default: {
      // content / report / plan 之外的兜底：宁可平铺，也不要"条目消失"
      const text = itemText(item);
      const type = enumLabel(item.type, TYPE_CN);
      return (
        <div className="px-2 py-0.5 text-caption text-on-surface-variant/70"
          data-testid="session-item-log" data-seq={item.seq} data-type={item.type}>
          <span className="mr-1 font-mono" title={type.raw}>{type.label}</span>
          {text}
        </div>
      );
    }
  }
}

const LINK_CN: Record<SessionLinkState, string> = {
  idle: '', loading: '同步中…', live: '', retry: '重连中…', down: '实时流已断开',
};

/** 四支空态：把"同步中 / 旧会话已迁移 / 真没记录 / 接口坏了"分开说（T2） */
function EmptyState({
  link, error, backfilled, onRetry,
}: {
  link: SessionLinkState; error: string; backfilled: number; onRetry: () => void;
}) {
  // 1) 还在同步 / 重连中：绝不能落到"这个会话还没有记录"（T-06）
  if (link === 'retry') {
    return <span data-empty="retry">正在重连…</span>;
  }
  if (link === 'loading' || link === 'idle') {
    return <span data-empty="loading">正在同步会话记录…</span>;
  }
  // 2) 接口/实时流坏了——必须说清楚，不能说是"没有内容"
  if (link === 'down') {
    return (
      <span data-empty="error">
        时间线不可用{error ? `（${error}）` : ''}，
        <button type="button" className="ml-1 text-primary underline"
          data-testid="session-timeline-retry" onClick={onRetry}>
          重试
        </button>
      </span>
    );
  }
  // 3) 旧会话刚被迁移：说出"迁了多少、更早的为什么没有"
  if (backfilled > 0) {
    return (
      <span data-empty="backfilled">
        已从历史消息迁移 {backfilled} 条记录（更早的已随会话压缩，无法恢复）。
      </span>
    );
  }
  // 4) 真没记录
  return <span data-empty="empty">这个会话还没有记录：发一条消息就会有内容。</span>;
}

export interface SessionTimelineProps {
  sessionId: string;
  className?: string;
  /** 正文条目（`content`）的渲染：用户气泡/助手 Markdown 都由调用方决定 */
  renderContent?: (item: SessionTimelineItem) => React.ReactNode;
  /** 创意简报卡（`report`） */
  renderReport?: (item: SessionTimelineItem) => React.ReactNode;
  /** 规划书卡（`plan`） */
  renderPlan?: (item: SessionTimelineItem) => React.ReactNode;
  /** 本轮是否在跑（决定是否显示忙碌行） */
  busy?: boolean;
  /** 忙碌行文案（"正在思考…"/"正在生成制作规划书…"） */
  busyLabel?: string;
  /** 思考能力说明（模型不提供 / 流式回退）：只在没有 thinking 条目时显示 */
  reasoningNote?: string;
  /** 问题条目上的作答回调 */
  onAnswerQuestion?: (
    a: { questionId: string; optionId?: string | null; text?: string | null },
  ) => Promise<void>;
}

export function SessionTimeline({
  sessionId, className, renderContent, renderReport, renderPlan,
  busy, busyLabel, reasoningNote, onAnswerQuestion,
}: SessionTimelineProps) {
  useSessionTimeline(sessionId);
  const retry = useRetrySessionTimeline(sessionId);
  const bucket = useSessionTimelineStore((s) => s.bySession[sessionId] ?? EMPTY_BUCKET);
  const link = useSessionTimelineStore((s) => s.link[sessionId] ?? 'idle');
  const error = useSessionTimelineStore((s) => s.lastError[sessionId] ?? '');
  const backfilled = useSessionTimelineStore((s) => s.backfilled[sessionId] ?? 0);
  const hasMore = useSessionTimelineStore((s) => s.hasMore[sessionId] ?? false);
  const items = React.useMemo(() => itemsOf(bucket), [bucket]);
  // 哪些问题已经被答过：看有没有同 question_id 的 answer 条目（服务端写的，不靠本地状态）
  const answeredQids = React.useMemo(() => {
    const set = new Set<string>();
    for (const i of items) {
      if (i.type !== 'answer') continue;
      const qid = asText(i.meta?.question_id);
      if (qid) set.add(qid);
    }
    return set;
  }, [items]);

  // T-02：同一条流式条目（thinking delta 合并）长度不变，但内容会一直长；
  // 用最后一条的"seq + 状态 + 长度 + 文本尾段"做指纹，内容变化也触发跟随。
  const lastFingerprint = React.useMemo(() => {
    const last = items[items.length - 1];
    if (!last) return '';
    const text = itemText(last);
    return `${last.seq}:${last.state}:${text.length}:${text.slice(-64)}`;
  }, [items]);
  const headSeq = items.length ? items[0].seq : 0;

  const [visible, setVisible] = React.useState(WINDOW);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  // T-03：按条目 id 记提交结果，成功后立即锁定；服务端 answer 到达由 answeredQids 兜底
  const [submitted, setSubmitted] = React.useState<SubmittedMap>({});
  const onSubmitted = React.useCallback<OnSubmitted>((id, note) => {
    setSubmitted((prev) => (prev[id] ? prev : { ...prev, [id]: note }));
  }, []);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const stickBottom = React.useRef(true);
  // T-01：同步 in-flight ref（state 的 loadingOlder 是异步的，挡不住同一批 scroll 事件）
  const earlierInFlight = React.useRef(false);
  const prependAnchor = React.useRef<{ height: number; top: number; headSeq: number } | null>(null);

  // 跟随最新：用户本来就在底部（或首屏）时滚到底；主动上滑看历史时不打扰
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items.length, visible, lastFingerprint]);

  // T-01：历史记录插到顶部后，浏览器不会自动保持视觉位置 —— 用加载前的
  // scrollHeight 差值把 scrollTop 补回去。只在"触发了 loadEarlier"的场景挂锚点。
  React.useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    if (!anchor || headSeq === anchor.headSeq) return;   // 还没有更早条目插入
    const el = scrollerRef.current;
    prependAnchor.current = null;
    if (!el) return;
    const delta = el.scrollHeight - anchor.height;
    if (delta > 0) el.scrollTop = anchor.top + delta;
  }, [headSeq, items.length]);

  const requestEarlier = React.useCallback(() => {
    if (earlierInFlight.current || !hasMore) return;
    earlierInFlight.current = true;
    const el = scrollerRef.current;
    if (el) {
      prependAnchor.current = {
        height: el.scrollHeight, top: el.scrollTop, headSeq,
      };
    }
    setLoadingOlder(true);
    void loadEarlier(sessionId)
      .then((added) => {
        // 服务端没有更早记录（或全是重复条目）时别把锚点留到下一次无关的追加
        if (!added) prependAnchor.current = null;
      })
      .finally(() => {
        earlierInFlight.current = false;
        setLoadingOlder(false);
      });
  }, [hasMore, headSeq, sessionId]);

  const onScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop > 24) return;
    setVisible((v) => (v < 4000 ? v + WINDOW : v));
    requestEarlier();
  }, [requestEarlier]);

  if (!items.length) {
    return (
      <div className={cn('px-3 py-6 text-center text-caption text-on-surface-variant/60', className)}
        data-testid="session-timeline-empty">
        <EmptyState link={link} error={error} backfilled={backfilled} onRetry={retry} />
      </div>
    );
  }

  const shown = items.slice(Math.max(0, items.length - visible));
  const hidden = items.length - shown.length;

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className={cn('h-full min-h-0 overflow-y-auto text-body-sm', className)}
      data-testid="session-timeline"
      data-total={items.length}
      data-rendered={shown.length}
      data-latest-seq={items[items.length - 1]?.seq ?? 0}
    >
      {LINK_CN[link] && (
        <div className="px-2 py-0.5 text-caption text-on-surface-variant/60"
          data-testid="session-timeline-link">{LINK_CN[link]}</div>
      )}
      {(hidden > 0 || hasMore) && (
        <button
          type="button"
          data-testid="session-load-earlier"
          className="mb-1 px-2 text-caption text-primary hover:underline"
          onClick={() => {
            setVisible((v) => v + WINDOW);
            requestEarlier();
          }}
        >
          {loadingOlder ? '加载中…'
            : hidden <= 0 ? '加载更早记录'
              : `加载更早（还有 ${hidden} 条${hasMore ? '，服务端仍有更早记录' : ''}）`}
        </button>
      )}
      {shown.map((item) => {
        const key = `${sessionId}:${item.seq}`;
        if (item.type === 'content' && renderContent) {
          return <React.Fragment key={key}>{renderContent(item)}</React.Fragment>;
        }
        // 调用方可能对同类型条目"认不出来"（例如内核汇报卡 vs 创意简报）→ 返回空，
        // 这时必须落回默认渲染，不能把条目吞掉。
        if (item.type === 'report' && renderReport) {
          const custom = renderReport(item);
          if (custom) return <React.Fragment key={key}>{custom}</React.Fragment>;
        }
        if (item.type === 'plan' && renderPlan) {
          const custom = renderPlan(item);
          if (custom) return <React.Fragment key={key}>{custom}</React.Fragment>;
        }
        if (item.type === 'report' || item.type === 'plan') {
          // 默认视图：简报/规划书给摘要卡，内核汇报给 bullets —— 绝不静默丢失
          const obj = itemObject(item);
          const title = asText(item.meta?.title ?? obj.title);
          const bullets = textList(obj.bullets ?? item.meta?.bullets);
          return (
            <div key={key} className="px-2 py-1" data-testid={`session-item-${item.type}`}
              data-seq={item.seq}>
              <div className="text-caption text-on-surface-variant/70">
                {item.type === 'report'
                  ? (isBriefItem(item) ? '创意简报' : '主 agent 汇报')
                  : '规划书'}
                {item.type === 'plan' && typeof item.meta?.scene_count === 'number'
                  ? ` · ${item.meta.scene_count} 场景` : ''}
              </div>
              {title && <div className="text-body-sm text-on-surface">{title}</div>}
              {bullets.length > 0 && (
                <ul className="mt-0.5 list-disc pl-4 text-caption text-on-surface-variant">
                  {bullets.map((b, i) => <li key={`${item.seq}-b${i}`}>{b}</li>)}
                </ul>
              )}
            </div>
          );
        }
        return (
          <div key={key}>
            <Row item={item} answeredQids={answeredQids} onAnswer={onAnswerQuestion}
              submitted={submitted} onSubmitted={onSubmitted} />
            <StateBadge item={item} />
          </div>
        );
      })}
      {/* 忙碌行：用户发出去到首个条目到达之间不能毫无反应（T3.1）。
          只在"本轮还没有流式条目"时出现，避免和真实的思考/正文条目重复。 */}
      {busy && !items.some((i) => i.state === 'streaming') && (
        <div className="flex items-center gap-2 px-2 py-1 text-caption text-on-surface-variant"
          data-testid="session-busy-row">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          <span>{busyLabel || '正在处理…'}</span>
          {reasoningNote && (
            <span className="text-on-surface-variant/60"
              data-testid="session-reasoning-note">· {reasoningNote}</span>
          )}
        </div>
      )}
    </div>
  );
}





