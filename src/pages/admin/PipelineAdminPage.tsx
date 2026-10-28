import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ConsoleShell, ConsoleHeading, StatusPill } from './ConsoleShell';
import { pipelineApi } from '@/services/api';
import { TaskListSection } from '@/features/task/TaskListSection';
import { TypeConformancePanel } from '@/features/pipeline/TypeConformancePanel';
import { EvalPanel } from '@/features/pipeline/EvalPanel';
import { cn } from '@/lib/utils';
import {
  Activity, Gauge, Coins, Timer, ChevronDown, ChevronRight,
  RefreshCw, FileJson, Loader2, Layers, AlertTriangle, Cpu,
} from 'lucide-react';

interface Span { agent: string; start: number; dur: number; status: 'ok' | 'fail' | 'retry'; }
interface PipelineRun {
  id: string;
  topic: string;
  status: 'completed' | 'running' | 'failed';
  durationMs: number;
  agents: Span[];
  startedAt: string;
  llmCost?: number;
  /** V38 用量总账：token 按 Agent 汇总，render_sec 是渲染耗时（wall-clock） */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    calls?: number;
    render_sec?: number;
  };
}
interface TraceView { loading: boolean; events: unknown[] | null; error?: string; }

const AGENT_COLORS: Record<string, string> = {
  structure: '#4F8CFF', material: '#A855F7', edit: '#FBBF24',
  animation: '#FF6B6B', audio: '#34D399', quality: '#F59E0B', self_heal: '#00E5FF',
};

/**
 * PipelineAdminPage — observability console: aggregate stats, run queue, and
 * a Gantt-style span trace per run showing each Agent's wall time.
 *
 * 数据源：Task 列表（GET /api/task，主视图）+ 老管线历史（GET /api/pipeline/runs，**只读**回看）。
 * When the backend is offline we surface an error banner — never fake data.
 *
 * PRD B1（2026-10-29）：老管线的「重试」与「启动」都已在后端退役（`/api/pipeline/retry/*`、
 * `/api/pipeline/run-async` 在 `agent_mode!=on` 时返回 410）。页面上的重试按钮点了必然失败，
 * 属于假入口，已移除；顶部改为「历史只读」标记 + 新任务入口指引。
 */
export function PipelineAdminPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceView | null>(null);
  // Guard against stale in-flight trace responses when the user collapses/re-expands.
  const expandedRef = useRef<string | null>(null);
  // A10: 队列任务概览（running/pending/recovered）
  const [queueInfo, setQueueInfo] = useState<{ running: number; pending: number; recovered: number } | null>(null);
  // closeout B10：评估面板（golden 真跑报告）
  const [tab, setTab] = useState<'runs' | 'eval'>('runs');

  const loadRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const records = await pipelineApi.getRunRecords();
      setRuns(normalize(records));
    } catch {
      setRuns([]);
      setError('后端离线：无法获取实时运行记录。启动后端后点击「刷新」重试。');
    } finally {
      setLoading(false);
    }
    // A10: 队列状态（失败不影响主列表）
    try {
      const q = await pipelineApi.getTasks();
      setQueueInfo({ running: q.running, pending: q.pending, recovered: q.recovered.length });
    } catch { /* 离线 */ }
  };

  useEffect(() => { loadRuns(); }, []);

  const toggleExpand = async (id: string) => {
    const next = expanded === id ? null : id;
    expandedRef.current = next;
    setExpanded(next);
    setTrace(null);
    if (next) {
      setTrace({ loading: true, events: null });
      try {
        const events = await pipelineApi.getTraceJson(next);
        if (expandedRef.current !== next) return; // 展开状态已变化，丢弃过期响应
        setTrace({ loading: false, events: Array.isArray(events) ? events : [] });
      } catch {
        if (expandedRef.current !== next) return;
        setTrace({ loading: false, events: null, error: '追踪不可用（后端离线或该记录的 trace 已清除）。' });
      }
    }
  };

  const completed = runs.filter((r) => r.status === 'completed');
  const runsWithCost = runs.filter((r) => r.llmCost !== undefined);
  const totalCost = runsWithCost.reduce((s, r) => s + (r.llmCost ?? 0), 0);
  // V38：token 总账（后端 usage.total_tokens）；没有记录就显示 "—"，不编造
  const totalTokens = runs.reduce((sum, r) => sum + (r.usage?.total_tokens ?? 0), 0);
  const stats = {
    total: runs.length,
    successRate: runs.length ? Math.round((completed.length / runs.length) * 100) : 0,
    avgSec: completed.length ? (completed.reduce((s, r) => s + r.durationMs, 0) / completed.length / 1000).toFixed(1) : '0',
    // G9: 真实成本（后端记录 llm_cost）；不可得时显示 "—"，不造假值
    llmCost: runsWithCost.length > 0 ? totalCost.toFixed(2) : null,
    totalTokens: totalTokens > 0 ? totalTokens.toLocaleString() : null,
  };

  return (
    <ConsoleShell>
      <div className="flex items-start justify-between gap-4">
        <ConsoleHeading kicker="Observability / Execution" title="执行诊断"
          desc="主 Agent 任务与历史管线的执行诊断：Agent 耗时分布、阶段成败、LLM 成本。老管线已下线（只读保留历史记录）。" />
        <button onClick={loadRuns} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-cw-sm border border-outline-variant/30 bg-surface-container
            text-label-sm text-on-surface-variant hover:text-on-surface hover:border-outline/60 transition-colors disabled:opacity-50 cursor-pointer shrink-0">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          刷新
        </button>
      </div>

      {/* PRD B1：老管线已退役——这里的记录只读回看，新任务走 Task */}
      <div
        data-testid="legacy-readonly-banner"
        className="mb-5 max-w-[900px] rounded-cw-md border border-outline-variant/30 bg-surface-container px-4 py-3"
      >
        <p className="flex items-center gap-2 text-label-sm text-on-surface">
          <span className="rounded-cw-xs bg-outline-variant/20 px-1.5 py-0.5 font-mono text-caption text-on-surface-variant">
            历史只读
          </span>
          老 6 阶段管线已下线：这里只展示切换前的运行记录，<b className="font-medium">不能启动或重试</b>。
        </p>
        <p className="mt-1 text-caption text-on-surface-variant">
          新任务请走「新建制作」→ 需求确认 → 主 Agent 任务（
          <code className="font-mono">POST /api/requirements/proceed</code>
          {' '}或{' '}
          <code className="font-mono">POST /api/task</code>
          ）。
        </p>
        <button
          type="button"
          data-testid="goto-new-production"
          onClick={() => navigate({ to: '/' })}
          className="mt-2 rounded-cw-sm bg-primary/15 px-2.5 py-1 text-label-sm text-primary hover:bg-primary/25 cursor-pointer"
        >
          去「新建制作」开始新任务
        </button>
      </div>

      {/* 路线 C：任务列表（老 runs 视图仍保留，直到 C7 退役） */}
      <TaskListSection />

      <div className="mb-3 flex items-center gap-1" data-testid="admin-tabs">
        {(['runs', 'eval'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'rounded-cw-sm px-3 py-1 text-label-sm cursor-pointer',
              tab === key
                ? 'bg-primary/15 text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {key === 'runs' ? '运行记录' : '评估'}
          </button>
        ))}
      </div>

      {tab === 'eval' ? <EvalPanel /> : null}

      {error && (
        <div className="flex items-center justify-between mb-5 max-w-[900px] bg-error/10 border border-error/30 rounded-cw-md px-4 py-2.5">
          <span className="text-label-sm text-error flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" />{error}
          </span>
          <button onClick={loadRuns} className="text-label-sm text-error hover:text-error/80 cursor-pointer">重试</button>
        </div>
      )}

      {queueInfo && (
        <div className="flex items-center gap-4 mb-5 max-w-[900px] bg-surface-container border border-outline-variant/30 rounded-cw-md px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
            <Layers className="w-3.5 h-3.5 text-primary" /> 执行队列
          </span>
          <span className="flex items-center gap-1.5 text-label-sm">
            <span className="w-2 h-2 rounded-full bg-track-audio animate-pulse" />
            运行中 <b className="font-mono">{queueInfo.running}</b>
          </span>
          <span className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
            排队 <b className="font-mono">{queueInfo.pending}</b>
          </span>
          {queueInfo.recovered > 0 && (
            <span className="flex items-center gap-1.5 text-label-sm text-warning">
              <AlertTriangle className="w-3.5 h-3.5" />
              重启中断 {queueInfo.recovered} 项（<span className="font-mono">recovered</span>）
            </span>
          )}
        </div>
      )}

      {/* stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-7 max-w-[900px]">
        <StatCard icon={Activity} label="总执行" value={String(stats.total)} sub="runs" color="#4F8CFF" />
        <StatCard icon={Gauge} label="成功率" value={`${stats.successRate}%`} sub="pass rate" color="#34D399" />
        <StatCard icon={Timer} label="平均耗时" value={stats.avgSec} sub="seconds" color="#FBBF24" />
        <StatCard icon={Coins} label="LLM 成本" value={stats.llmCost ? `¥${stats.llmCost}` : '—'} sub="actual" color="#A855F7" />
        <StatCard
          icon={Cpu}
          label="LLM 用量"
          value={stats.totalTokens ? `${stats.totalTokens}` : '—'}
          sub={stats.totalTokens ? 'tokens（V38 入账）' : '暂无用量记录'}
          color="#00E5FF"
        />
      </div>

      {/* run queue with gantt traces */}
      <div className="space-y-3 max-w-[900px]">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-surface-container rounded-cw-md animate-pulse" />)
        ) : runs.length === 0 ? (
          <div className="bg-surface-container border border-dashed border-outline-variant/40 rounded-cw-md px-5 py-10 text-center">
            <p className="text-body-sm text-on-surface-variant">暂无老管线运行记录</p>
            <p className="text-caption text-on-surface-variant/60 mt-1 font-mono">
              老 6 阶段管线已下线：新创作都在上方「任务」列表里（GET /api/task）。
              这里只保留切换前历史记录的只读回看。
            </p>
          </div>
        ) : (
          runs.map((run) => {
            const isOpen = expanded === run.id;
            const total = run.durationMs || 1;
            return (
              <div key={run.id}
                className={cn('bg-surface-container border rounded-cw-md overflow-hidden transition-all duration-short3',
                  isOpen ? 'border-primary/40 shadow-lg shadow-primary/5' : 'border-outline-variant/30 hover:border-outline/60')}>
                {/* run header row */}
                <button onClick={() => toggleExpand(run.id)}
                  className="w-full flex items-center gap-3.5 px-5 py-3.5 text-left cursor-pointer">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-primary shrink-0" /> : <ChevronRight className="w-4 h-4 text-on-surface-variant shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-medium text-on-surface truncate">{run.topic}</p>
                    <p className="font-mono text-caption text-on-surface-variant mt-0.5">{run.id} · {run.startedAt}</p>
                    {run.usage?.total_tokens ? (
                      <p className="font-mono text-caption text-primary/80 mt-0.5" data-testid="run-usage">
                        {run.usage.total_tokens.toLocaleString()} tokens
                        {run.usage.calls ? ` · ${run.usage.calls} 次调用` : ''}
                        {run.usage.render_sec ? ` · 渲染 ${run.usage.render_sec}s` : ''}
                      </p>
                    ) : null}
                  </div>
                  <span className="font-mono text-caption text-on-surface-variant shrink-0">{(run.durationMs / 1000).toFixed(1)}s</span>
                  <StatusPill ok={run.status === 'completed'}
                    label={run.status === 'completed' ? 'DONE' : run.status === 'running' ? 'RUN' : 'FAIL'} />
                  {/* PRD B1：失败记录不再提供「重试」——后端 retry 已返回 410 */}
                </button>

                {/* gantt trace */}
                {isOpen && (
                  <div className="px-5 pb-4">
                    <div className="border-t border-outline-variant/20 pt-3 space-y-1.5">
                      {run.agents.map((span, i) => {
                        const left = (span.start / total) * 100;
                        const width = Math.max(1.5, (span.dur / total) * 100);
                        const color = AGENT_COLORS[span.agent] ?? '#4F8CFF';
                        return (
                          <div key={i} className="flex items-center gap-3 group">
                            <span className="font-mono text-caption text-on-surface-variant w-20 shrink-0 text-right">{span.agent}</span>
                            <div className="flex-1 h-5 bg-surface rounded-cw-xs relative overflow-hidden">
                              <span
                                className={cn('absolute top-0.5 bottom-0.5 rounded-[3px] flex items-center px-1.5 transition-all duration-medium2',
                                  span.status === 'fail' && 'ring-1 ring-error')}
                                style={{ left: `${left}%`, width: `${width}%`, background: `${color}CC` }}
                                title={`${span.agent}: ${span.dur}ms`}
                              >
                                <span className="font-mono text-caption text-white/90 whitespace-nowrap overflow-hidden">
                                  {span.dur >= 100 ? `${(span.dur / 1000).toFixed(1)}s` : `${span.dur}ms`}
                                </span>
                              </span>
                            </div>
                            {span.status === 'retry' && <span className="font-mono text-caption text-track-caption shrink-0">↻</span>}
                            {span.status === 'fail' && <span className="font-mono text-caption text-error shrink-0">✕</span>}
                          </div>
                        );
                      })}
                    </div>
                    {/* legend */}
                    <div className="flex flex-wrap gap-3 mt-3 pt-2.5 border-t border-outline-variant/15">
                      {Object.entries(AGENT_COLORS).slice(0, 6).map(([agent, color]) => (
                        <span key={agent} className="flex items-center gap-1.5 font-mono text-caption text-on-surface-variant">
                          <i className="w-2.5 h-2.5 rounded-[2px]" style={{ background: color }} /> {agent}
                        </span>
                      ))}
                    </div>

                    {/* trace JSON viewer */}
                    <div className="mt-3 pt-2.5 border-t border-outline-variant/15">
                      <div className="flex items-center gap-2 mb-2">
                        <FileJson className="w-3.5 h-3.5 text-primary" />
                        <span className="text-label text-on-surface-variant">事件追踪 (JSON)</span>
                        {trace?.loading && <Loader2 className="w-3 h-3 animate-spin text-on-surface-variant" />}
                      </div>
                      {trace?.loading ? (
                        <div className="flex items-center gap-2 text-caption text-on-surface-variant py-3 font-mono">
                          <Loader2 className="w-3 h-3 animate-spin" /> 读取 trace…
                        </div>
                      ) : trace?.error ? (
                        <p className="text-caption text-warning font-mono">{trace.error}</p>
                      ) : (
                        <>
                          {/* F-03：类型符合度（读 trace 里的 prompt_resolution 事件） */}
                          <TypeConformancePanel events={trace?.events} />
                          <pre className="mt-2 bg-surface rounded-cw-sm border border-outline-variant/30 px-3 py-2.5 font-mono text-caption
                          text-track-audio leading-relaxed max-h-72 overflow-auto whitespace-pre-wrap">
                          {JSON.stringify(trace?.events ?? [], null, 2)}
                        </pre>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </ConsoleShell>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof Activity; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div className="relative bg-surface-container border border-outline-variant/30 rounded-cw-md p-4 overflow-hidden
      hover:border-outline/60 hover:-translate-y-0.5 transition-all duration-short3 group">
      <span className="absolute top-0 left-0 w-full h-[3px]" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-label text-on-surface-variant">{label}</span>
        <span className="w-7 h-7 rounded-cw-xs flex items-center justify-center" style={{ background: `${color}1A`, color }}>
          <Icon className="w-3.5 h-3.5" />
        </span>
      </div>
      <p className="font-mono text-[26px] leading-none font-semibold text-on-surface">{value}</p>
      <p className="font-mono text-caption text-on-surface-variant/60 mt-1.5 uppercase tracking-wider">{sub}</p>
    </div>
  );
}

function normalize(data: unknown): PipelineRun[] {
  if (Array.isArray(data)) {
    return data.map((d, i) => {
      const o = d as Record<string, unknown>;
      const costRaw = (o as { llm_cost?: number | string }).llm_cost;
      const llmCost = typeof costRaw === 'number' ? costRaw
        : typeof costRaw === 'string' && costRaw !== '' ? Number(costRaw) : undefined;
      return {
        id: String(o.id ?? `pl_${i}`),
        topic: String(o.topic ?? '未命名'),
        status: (o.status as PipelineRun['status']) ?? 'completed',
        durationMs: Number(o.duration_ms ?? 0),
        startedAt: String(o.started_at ?? ''),
        agents: Array.isArray(o.agents) ? (o.agents as Span[]) : [],
        usage: (o.usage && typeof o.usage === 'object') ? (o.usage as PipelineRun['usage']) : undefined,
        llmCost: Number.isFinite(llmCost) ? llmCost : undefined,
      };
    });
  }
  return [];
}
