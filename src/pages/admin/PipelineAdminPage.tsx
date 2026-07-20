import { useEffect, useState } from 'react';
import { ConsoleShell, ConsoleHeading, StatusPill } from './ConsoleShell';
import { getApiClient } from '@/services/api';
import { cn } from '@/lib/utils';
import { Activity, Gauge, Coins, Timer, ChevronDown, ChevronRight } from 'lucide-react';

interface Span { agent: string; start: number; dur: number; status: 'ok' | 'fail' | 'retry'; }
interface PipelineRun {
  id: string;
  topic: string;
  status: 'completed' | 'running' | 'failed';
  durationMs: number;
  agents: Span[];
  startedAt: string;
}

const AGENT_COLORS: Record<string, string> = {
  structure: '#4F8CFF', material: '#A855F7', edit: '#FBBF24',
  animation: '#FF6B6B', audio: '#34D399', quality: '#F59E0B', self_heal: '#00E5FF',
};

/**
 * PipelineAdminPage — observability console: aggregate stats, run queue, and
 * a Gantt-style span trace per run showing each Agent's wall time.
 */
export function PipelineAdminPage() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await getApiClient().get('/api/pipeline/runs');
        if (alive) setRuns(normalize(data));
      } catch {
        if (alive) setRuns(DEMO_RUNS);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const completed = runs.filter((r) => r.status === 'completed');
  const stats = {
    total: runs.length,
    successRate: runs.length ? Math.round((completed.length / runs.length) * 100) : 0,
    avgSec: completed.length ? (completed.reduce((s, r) => s + r.durationMs, 0) / completed.length / 1000).toFixed(1) : '0',
    llmCost: (runs.length * 0.42).toFixed(2),
  };

  return (
    <ConsoleShell>
      <ConsoleHeading kicker="Observability / Pipeline" title="管线监控"
        desc="追踪每次管线执行的 Agent 耗时分布、成功率与 LLM 成本，定位慢节点与失败重试。" />

      {/* stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-7 max-w-[900px]">
        <StatCard icon={Activity} label="总执行" value={String(stats.total)} sub="runs" color="#4F8CFF" />
        <StatCard icon={Gauge} label="成功率" value={`${stats.successRate}%`} sub="pass rate" color="#34D399" />
        <StatCard icon={Timer} label="平均耗时" value={stats.avgSec} sub="seconds" color="#FBBF24" />
        <StatCard icon={Coins} label="LLM 成本" value={`¥${stats.llmCost}`} sub="estimated" color="#A855F7" />
      </div>

      {/* run queue with gantt traces */}
      <div className="space-y-3 max-w-[900px]">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-surface-container rounded-cw-md animate-pulse" />)
        ) : (
          runs.map((run) => {
            const isOpen = expanded === run.id;
            const total = run.durationMs || 1;
            return (
              <div key={run.id}
                className={cn('bg-surface-container border rounded-cw-md overflow-hidden transition-all duration-short3',
                  isOpen ? 'border-primary/40 shadow-lg shadow-primary/5' : 'border-outline-variant/30 hover:border-outline/60')}>
                {/* run header row */}
                <button onClick={() => setExpanded(isOpen ? null : run.id)}
                  className="w-full flex items-center gap-3.5 px-5 py-3.5 text-left cursor-pointer">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-primary shrink-0" /> : <ChevronRight className="w-4 h-4 text-on-surface-variant shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-medium text-on-surface truncate">{run.topic}</p>
                    <p className="font-mono text-caption text-on-surface-variant mt-0.5">{run.id} · {run.startedAt}</p>
                  </div>
                  <span className="font-mono text-caption text-on-surface-variant shrink-0">{(run.durationMs / 1000).toFixed(1)}s</span>
                  <StatusPill ok={run.status === 'completed'}
                    label={run.status === 'completed' ? 'DONE' : run.status === 'running' ? 'RUN' : 'FAIL'} />
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
      return {
        id: String(o.id ?? `pl_${i}`),
        topic: String(o.topic ?? '未命名'),
        status: (o.status as PipelineRun['status']) ?? 'completed',
        durationMs: Number(o.duration_ms ?? 0),
        startedAt: String(o.started_at ?? ''),
        agents: Array.isArray(o.agents) ? (o.agents as Span[]) : [],
      };
    });
  }
  return [];
}

const DEMO_RUNS: PipelineRun[] = [
  {
    id: 'pl_v2_9f3a1c', topic: '深度解析某品牌新手机的散热设计', status: 'completed',
    durationMs: 187000, startedAt: '14:32:08',
    agents: [
      { agent: 'structure', start: 0, dur: 21000, status: 'ok' },
      { agent: 'material', start: 21000, dur: 48000, status: 'ok' },
      { agent: 'edit', start: 69000, dur: 62000, status: 'ok' },
      { agent: 'animation', start: 131000, dur: 31000, status: 'ok' },
      { agent: 'audio', start: 162000, dur: 16000, status: 'ok' },
      { agent: 'quality', start: 178000, dur: 9000, status: 'ok' },
    ],
  },
  {
    id: 'pl_v2_7b22e0', topic: '量子计算到底是什么', status: 'completed',
    durationMs: 243000, startedAt: '13:58:41',
    agents: [
      { agent: 'structure', start: 0, dur: 25000, status: 'ok' },
      { agent: 'material', start: 25000, dur: 70000, status: 'ok' },
      { agent: 'edit', start: 95000, dur: 55000, status: 'retry' },
      { agent: 'animation', start: 150000, dur: 52000, status: 'ok' },
      { agent: 'audio', start: 202000, dur: 28000, status: 'ok' },
      { agent: 'quality', start: 230000, dur: 13000, status: 'ok' },
    ],
  },
  {
    id: 'pl_v2_c4d918', topic: '【鬼畜】老板语录 remix', status: 'failed',
    durationMs: 96000, startedAt: '13:12:19',
    agents: [
      { agent: 'structure', start: 0, dur: 18000, status: 'ok' },
      { agent: 'material', start: 18000, dur: 42000, status: 'ok' },
      { agent: 'edit', start: 60000, dur: 36000, status: 'fail' },
    ],
  },
];
