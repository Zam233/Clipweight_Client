import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConsoleShell, ConsoleHeading } from './ConsoleShell';
import { backendConfigApi } from '@/services/api';
import type { BackendConfigField, BackendConfigGroup, BackendConfigResponse } from '@/services/api';
import { toast } from '@/stores/toastStore';
import { ConfigValueInput } from '@/components/ConfigValueInput';
import { RenderOpsSection } from '@/features/settings/RenderOpsSection';
import { cn } from '@/lib/utils';
import { Loader2, RefreshCw, RotateCcw, Save, Search, KeyRound } from 'lucide-react';

/**
 * BackendConfigPage — 「后端配置」：把 .env 配置项搬到设置页管理。
 *
 * 优先级 store(settings.json) > 环境变量/.env > 默认值；secret 字段
 * 只显示掩码占位，输入非空才提交；requires_restart 字段带徽标提示。
 */

const INPUT_MIN_W = 'min-w-[220px]';

/** 修改 api_token / jwt 密钥后当前会话可能立即 401 */
const SESSION_SENSITIVE = new Set(['api_token', 'account_jwt_secret', 'account_verify_mode']);

function RestartBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-cw-xs font-mono text-caption
      bg-warning/10 text-warning border border-warning/30 shrink-0" title="该配置只在服务启动时读取，保存后需重启后端生效">
      需重启
    </span>
  );
}

function SourceBadge({ source }: { source: BackendConfigField['source'] }) {
  if (source === 'default') return null;
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-cw-xs font-mono text-caption border shrink-0',
      source === 'store'
        ? 'bg-primary-container/40 text-primary border-primary/30'
        : 'bg-surface-container/60 text-on-surface-variant border-outline-variant/30')}
      title={source === 'store' ? 'settings.json 覆盖值（可在本页清除）' : '来自环境变量/.env'}>
      {source === 'store' ? '已覆盖' : 'env'}
    </span>
  );
}

export function BackendConfigPage() {
  const [data, setData] = useState<BackendConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  /** 待保存修改；secret 字段仅在显式输入或点「清除」时进入 */
  const [edits, setEdits] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backendConfigApi.get();
      setData(res);
      setEdits({});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '读取配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const groups: BackendConfigGroup[] = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const match = (f: BackendConfigField) =>
      !q || f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
        || f.description.toLowerCase().includes(q);
    return data.groups
      .map((g) => ({ ...g, fields: g.fields.filter(match) }))
      .filter((g) => g.fields.length > 0);
  }, [data, query]);

  const fieldMap = useMemo(() => {
    const m: Record<string, BackendConfigField> = {};
    for (const g of data?.groups ?? []) for (const f of g.fields) m[f.key] = f;
    return m;
  }, [data]);

  const dirtyCount = Object.keys(edits).filter((k) => {
    const v = edits[k];
    const f = fieldMap[k];
    if (f?.secret && (v === '' || v === undefined)) return false;
    return true;
  }).length;

  const setEdit = (key: string, value: unknown) => setEdits((prev) => ({ ...prev, [key]: value }));

  const displayValue = (f: BackendConfigField): unknown => {
    if (f.key in edits) return edits[f.key];
    if (f.secret) return ''; // 明文不可见，输入框留空
    return f.value;
  };

  const save = async () => {
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(edits)) {
      const f = fieldMap[k];
      // secret 输入框留空 = 保持现状（只有「清除」按钮会显式提交 null）
      if (f?.secret && (v === '' || v === undefined)) continue;
      payload[k] = v;
    }
    if (Object.keys(payload).length === 0) {
      toast('没有可保存的修改', 'info');
      return;
    }
    setSaving(true);
    try {
      const res = await backendConfigApi.update(payload);
      const touchSensitive = Object.keys(payload).some((k) => SESSION_SENSITIVE.has(k));
      toast(`已保存 ${res.applied.length} 项、清除 ${res.cleared.length} 项配置`, 'success');
      for (const w of res.warnings) toast(w, 'info');
      if (touchSensitive) toast('API 令牌/鉴权配置已变更：当前会话可能需要重新登录', 'info');
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      toast(typeof detail === 'string' ? detail : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    setSaving(true);
    try {
      const res = await backendConfigApi.reset([]);
      toast(`已清除 ${res.cleared.length} 项覆盖，回退环境变量/默认值`, 'success');
      void load();
    } catch {
      toast('重置失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const clearField = (key: string) => setEdit(key, null);

  return (
    <ConsoleShell>
      <div className="px-6 py-5 max-w-[880px] mx-auto">
        <div className="flex items-start justify-between gap-4">
          <ConsoleHeading
            kicker="BACKEND CONFIG"
            title="后端配置"
            desc="运行时配置（优先级 settings.json > .env > 默认值）；标「需重启」的项保存后要重启后端"
          />
          <div className="flex items-center gap-2 shrink-0 mt-1">
            <button
              onClick={resetAll}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-cw-xs text-label-sm
                text-on-surface-variant hover:text-on-surface border border-outline-variant/30
                hover:border-outline-variant transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" /> 全部还原
            </button>
          </div>
        </div>

        {data && !data.has_encryption_key && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-cw-xs bg-error/10 border border-error/30 text-label-sm text-error">
            <KeyRound className="w-4 h-4 shrink-0" />
            未配置 CLIPWRIGHT_WEBHOOK_SECRET_KEY：密钥类（secret）字段无法在本页保存，请先在 .env 设置加密密钥
          </div>
        )}

        {/* PRD B8：渲染后端与产物清理（后端早有端点，前端此前无入口） */}
        <RenderOpsSection />

        <div className="relative mb-5">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索配置项（名称 / 说明）"
            className="w-full bg-surface rounded-cw-xs pl-8 pr-3 py-2 text-body-sm text-on-surface
              outline-none border border-outline-variant/30 focus:border-primary"
          />
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-on-surface-variant text-body-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载配置中…
          </div>
        )}

        {!loading && error && (
          <div className="py-12 text-center">
            <p className="text-body-sm text-error mb-3">{error}</p>
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-cw-xs text-label-sm
                border border-outline-variant/30 hover:border-primary transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> 重试
            </button>
          </div>
        )}

        {!loading && !error && groups.map((g) => (
          <section key={g.id} className="mb-6">
            <h2 className="font-mono text-label-sm tracking-[0.2em] text-on-surface-variant uppercase mb-2
              pb-1 border-b border-outline-variant/20">{g.label}</h2>
            <div className="divide-y divide-outline-variant/15">
              {g.fields.map((f) => (
                <div key={f.key} className="py-2.5 flex items-start gap-4">
                  <div className="w-[280px] shrink-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-label-sm text-on-surface">{f.label}</span>
                      {!f.hot && <RestartBadge />}
                      <SourceBadge source={f.source} />
                    </div>
                    <p className="font-mono text-caption text-on-surface-variant/70 mt-0.5">{f.key}</p>
                    {f.description && (
                      <p className="text-caption text-on-surface-variant/80 mt-0.5">{f.description}</p>
                    )}
                  </div>
                  <div className={cn('flex-1 flex items-center gap-2', INPUT_MIN_W)}>
                    {f.kind === 'enum' ? (
                      <select
                        value={String(displayValue(f) ?? '')}
                        disabled={saving}
                        onChange={(e) => setEdit(f.key, e.target.value)}
                        className="w-full max-w-[320px] bg-surface rounded-cw-xs px-2.5 py-1.5 text-body-sm text-on-surface
                          outline-none border border-outline-variant/30 focus:border-primary"
                      >
                        {f.choices.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <div className="w-full max-w-[320px]">
                        <ConfigValueInput
                          type={f.kind}
                          value={displayValue(f)}
                          disabled={saving}
                          placeholder={f.secret
                            ? (f.masked || (f.has_value ? '已设置（输入新值覆盖）' : ''))
                            : undefined}
                          onChange={(v) => setEdit(f.key, v)}
                        />
                      </div>
                    )}
                    {(f.source === 'store' || (f.secret && f.has_value)) && (
                      <button
                        onClick={() => clearField(f.key)}
                        disabled={saving}
                        title="清除覆盖/已存值，回退环境变量或默认值"
                        className="shrink-0 px-2 py-1 rounded-cw-xs text-caption text-on-surface-variant
                          hover:text-error border border-outline-variant/30 hover:border-error/50
                          transition-colors cursor-pointer disabled:opacity-50"
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {!loading && !error && dirtyCount > 0 && (
          <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 px-4 py-2.5
            rounded-cw-sm bg-surface-container-high border border-primary/40 shadow-lg">
            <span className="text-body-sm text-on-surface">{dirtyCount} 项待保存</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEdits({})}
                disabled={saving}
                className="px-3 py-1.5 rounded-cw-xs text-label-sm text-on-surface-variant
                  hover:text-on-surface transition-colors cursor-pointer"
              >
                放弃
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-cw-xs text-label-sm
                  bg-primary text-on-primary hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                保存
              </button>
            </div>
          </div>
        )}
      </div>
    </ConsoleShell>
  );
}
