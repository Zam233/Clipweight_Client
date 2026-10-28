/**
 * 渲染后端与产物清理（PRD B8 / G6）。
 *
 * 后端 `GET /api/render/backends` 与 `DELETE /api/render/artifacts` 早就存在，
 * 但前端没有入口——排障时看不出"为什么回退到了本机"，过期成片也只能手工删。
 *
 * 纪律：清理是**破坏性**动作（真删 `renders/` 下的文件），必须二次确认并回显删了多少；
 * 默认只清 30 天以前，用户可改天数。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { renderApi } from '@/services/api';
import { Loader2, RefreshCw, Trash2, Cpu } from 'lucide-react';

interface BackendsState {
  backends: Array<Record<string, unknown>>;
  requested: string;
  effective: string;
  remote_render_url: boolean;
}

const INPUT = 'w-20 bg-surface rounded-cw-sm px-2 py-1 text-body-sm text-on-surface '
  + 'outline-none border border-outline-variant/30 focus:border-primary';

export function RenderOpsSection() {
  const [state, setState] = useState<BackendsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState('30');
  const [cleaning, setCleaning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await renderApi.getBackends());
    } catch (e) {
      setError((e as Error)?.message || '渲染后端加载失败');
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cleanup = async () => {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 0) {
      setError('天数必须是非负数字');
      return;
    }
    if (!window.confirm(`删除 ${n} 天以前的渲染产物？此操作不可撤销。`)) return;
    setCleaning(true);
    setError(null);
    try {
      const res = await renderApi.cleanupArtifacts(n);
      setNote(`已清理 ${res.removed} 个文件（早于 ${res.older_than_days} 天）`);
    } catch (e) {
      setError((e as Error)?.message || '清理失败');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <section className="mb-5 rounded-cw-md border border-outline-variant/30 bg-surface-container p-4" data-testid="render-ops">
      <div className="mb-2 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-primary" />
        <h3 className="text-label-sm text-on-surface">渲染后端</h3>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-caption text-on-surface-variant hover:text-on-surface cursor-pointer"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          刷新
        </button>
      </div>

      {error && (
        <p className="text-caption text-error" data-testid="render-ops-error">
          {error}
          <button type="button" className="ml-2 underline cursor-pointer" onClick={() => void load()}>重试</button>
        </p>
      )}

      {loading ? (
        <p className="text-caption text-on-surface-variant">加载中…</p>
      ) : state ? (
        <>
          <p className="mb-1 text-caption text-on-surface-variant" data-testid="render-effective">
            请求后端：<span className="font-mono text-on-surface">{state.requested || '（默认）'}</span>
            {' · '}实际生效：<span className="font-mono text-on-surface">{state.effective || '（未知）'}</span>
            {state.remote_render_url ? ' · 已配置远程渲染地址' : ' · 未配置远程渲染地址'}
          </p>
          {state.backends.length === 0 ? (
            <p className="text-caption text-on-surface-variant/60">后端没有返回任何渲染后端。</p>
          ) : (
            <ul className="space-y-0.5" data-testid="render-backends">
              {state.backends.map((b, i) => {
                const name = String(b.name ?? b.id ?? `backend_${i}`);
                const caps = b.capabilities ?? b.caps;
                const available = b.available ?? b.ready;
                return (
                  <li key={name} className="font-mono text-caption text-on-surface-variant">
                    {name}
                    {available !== undefined ? ` · ${available ? '可用' : '不可用'}` : ''}
                    {caps && typeof caps === 'object'
                      ? ` · ${Object.keys(caps as Record<string, unknown>).slice(0, 4).join('/')}`
                      : ''}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-outline-variant/20 pt-2">
        <span className="text-caption text-on-surface-variant">清理渲染产物：删除早于</span>
        <input className={INPUT} data-testid="artifact-days" inputMode="numeric"
          value={days} onChange={(e) => setDays(e.target.value)} />
        <span className="text-caption text-on-surface-variant">天的文件</span>
        <Button size="sm" variant="ghost" onClick={() => void cleanup()} disabled={cleaning}>
          {cleaning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          清理
        </Button>
        {note && <span className="text-caption text-primary" data-testid="render-cleanup-note">{note}</span>}
      </div>
    </section>
  );
}
