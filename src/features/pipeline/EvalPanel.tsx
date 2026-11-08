/**
 * 评估面板（closeout B10 的可视化）。
 *
 * 数据源：`GET /api/eval/reports`（列表）+ `/api/eval/reports/{name}`（全文），
 * 报告由 `python -m clipwright.services.golden_eval` 真跑生成。
 *
 * 面板只做三件事：**看均值、看离散度、看哪一次没跑完**。
 * 不在这里"算成功"——成功率的口径在后端，前端不重复解释。
 */
import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { evalApi, type EvalReportPayload, type EvalReportSummary } from '@/services/api';
import { cn } from '@/lib/utils';

function pct(v?: number | null): string {
  if (typeof v !== 'number') return '—';
  return `${Math.round(v * 100)}%`;
}

function num(v?: number | null, digits = 2): string {
  if (typeof v !== 'number') return '—';
  return v.toFixed(digits);
}

const METRIC_LABELS: Record<string, string> = {
  success_rate: '成功率',
  avg_turns: '平均回合',
  avg_tool_calls: '平均工具调用',
  cost_avg_usd: '平均成本(USD)',
  avg_duration_ms: '平均耗时(ms)',
  replan_rate: '重规划率',
};

export function EvalPanel() {
  const [items, setItems] = useState<EvalReportSummary[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [payload, setPayload] = useState<EvalReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PRD B9：首屏走 /api/eval/latest（404 = 正常空态，与"接口挂了"分开）
  const [latestEmpty, setLatestEmpty] = useState(false);
  const [latestName, setLatestName] = useState('');

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLatestEmpty(false);
    try {
      // 先给首屏：最近一份（没有就是 404 → null）
      const latest = await evalApi.latest();
      if (latest) {
        setLatestName(latest.name);
        setPayload(latest.payload);
        setLatestEmpty(false);
      } else {
        setLatestEmpty(true);
      }
      const res = await evalApi.listReports();
      setItems(res.items || []);
      if (!latest && res.items?.length) setSelected(res.items[0].name);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  useEffect(() => {
    if (!selected) {
      // 没选具体报告时保留 latest 的首屏 payload（别把它清掉）；
      // 只有连 latest 都没有时才清空。
      if (!latestName) setPayload(null);
      return undefined;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await evalApi.getReport(selected);
        if (alive) setPayload(res.payload);
      } catch {
        if (alive) setPayload(null);
      }
    })();
    return () => { alive = false; };
  }, [selected, latestName]);

  const metrics = payload?.metrics || {};
  const runs = payload?.raw_runs || [];

  return (
    <div className="mb-6" data-testid="eval-panel">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-label-sm text-on-surface-variant flex items-center gap-2">
          <Activity className="h-3.5 w-3.5" />
          golden 评估（真跑）：均值 / 离散度 / 每次结果
        </p>
        <button
          type="button"
          onClick={() => void loadList()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-cw-sm border border-outline-variant/40 px-2 py-1 text-label-sm text-on-surface-variant hover:border-outline/60 hover:text-on-surface disabled:opacity-50 cursor-pointer"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-2 rounded-cw-md border border-error/30 bg-error/10 px-3 py-2 text-label-sm text-error">
          {error}
        </div>
      )}

      {!items.length && !loading ? (
        <div
          className="rounded-cw-md border border-dashed border-outline-variant/40 px-4 py-6 text-center"
          data-testid="eval-empty"
        >
          <p className="text-body-sm text-on-surface-variant">
            {latestEmpty ? '还没有跑过评估（最近一份报告不存在）' : '还没有评估报告'}
          </p>
          <p className="mt-1 text-caption text-on-surface-variant/60">
            这是正常空态，不是接口故障。生成一份报告：
          </p>
          <p className="mt-1 font-mono text-caption text-on-surface-variant/60">
            python -m clipwright.services.golden_eval --topic g04_meme_burst --runs 3
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <ul className="max-h-[260px] space-y-1 overflow-auto" data-testid="eval-report-list">
            {items.map((it) => (
              <li key={it.name}>
                <button
                  type="button"
                  onClick={() => setSelected(it.name)}
                  className={cn(
                    'w-full rounded-cw-sm px-2 py-1.5 text-left text-caption',
                    selected === it.name
                      ? 'bg-primary/10 text-on-surface'
                      : 'text-on-surface-variant hover:bg-surface-container/60',
                  )}
                >
                  <span className="block truncate">{it.topic || it.name}</span>
                  <span className="block text-on-surface-variant/60">
                    {it.runs ?? 0} 次 · 成功 {pct(it.success_rate_mean)} · 波动{' '}
                    {num(it.success_rate_spread, 2)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="min-w-0" data-testid="eval-report-detail">
            {payload ? (
              <>
                <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {Object.keys(METRIC_LABELS).map((key) => {
                    const m = metrics[key];
                    if (!m || !m.n) return null;
                    return (
                      <div key={key} className="rounded-cw-sm border border-outline-variant/30 px-2 py-1.5">
                        <p className="text-caption text-on-surface-variant/70">{METRIC_LABELS[key]}</p>
                        <p className="text-body-sm text-on-surface">
                          {key === 'success_rate' ? pct(m.mean) : num(m.mean, key === 'avg_duration_ms' ? 0 : 2)}
                        </p>
                        <p className="text-caption text-on-surface-variant/50">
                          {m.min} ~ {m.max}（离散 {m.spread}）
                        </p>
                      </div>
                    );
                  })}
                </div>

                {(payload.warnings || []).length > 0 && (
                  <div className="mb-2 flex items-start gap-2 rounded-cw-md border border-warning/30 bg-warning/10 px-3 py-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" />
                    <ul className="text-caption text-warning/90">
                      {(payload.warnings || []).map((w) => <li key={w}>{w}</li>)}
                    </ul>
                  </div>
                )}

                <table className="w-full text-caption" data-testid="eval-run-rows">
                  <thead>
                    <tr className="text-on-surface-variant/70">
                      <th className="text-left font-normal">#</th>
                      <th className="text-left font-normal">状态</th>
                      <th className="text-left font-normal">收尾原因</th>
                      <th className="text-right font-normal">回合</th>
                      <th className="text-right font-normal">工具</th>
                      <th className="text-right font-normal">成本</th>
                      <th className="text-right font-normal">耗时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r, i) => (
                      <tr key={r.task_id || i} className="border-t border-outline-variant/20">
                        <td className="py-1">{i + 1}</td>
                        <td className={cn('py-1', r.status === 'done' ? 'text-primary' : 'text-error')}>
                          {r.status}
                        </td>
                        <td className="truncate py-1 text-on-surface-variant/80">{r.finish_reason || '—'}</td>
                        <td className="py-1 text-right">{r.turns ?? '—'}</td>
                        <td className="py-1 text-right">{r.tool_calls ?? '—'}</td>
                        <td className="py-1 text-right">{num(r.cost_usd, 3)}</td>
                        <td className="py-1 text-right">{num(r.wall_sec, 1)}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="text-caption text-on-surface-variant/60">选一份报告查看详情</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
