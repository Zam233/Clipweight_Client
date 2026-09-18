import { useEffect, useState } from 'react';
import { pluginApi } from '@/services/api';
import type { PluginContributionItem, PluginHealthResponse } from '@/services/api/project';
import { toast } from '@/stores/toastStore';
import { Button } from '@/components/ui';
import { ConfigValueInput } from '@/components/ConfigValueInput';
import { cn } from '@/lib/utils';
import type { PluginConfigField, PluginConfigResponse } from '@/types/api';
import {
  Puzzle, Power, Loader2, RefreshCw, Zap, Settings, X, Save, Trash2, Eye, Box,
  AlertTriangle, Activity, ShieldCheck, Link2, Wand2, GitBranch,
} from 'lucide-react';
import { PluginLayoutRenderer } from '@/features/plugins';
import { invalidatePluginSlots } from '@/features/plugins/usePluginSlots';
import type { UILayout } from '@/features/plugins/types';
import {
  normalizePluginList, attachPluginHealth, type PluginItem,
} from '@/features/plugins/pluginModel';

/**
 * PluginsPanel — 插件管理的**唯一实现**，覆盖 `/settings/plugins` 的全部能力。
 *
 * 之前有两处插件界面：独立管理页（完整）与首页「插件」tab（只列出名字，不能启停、
 * 看不到配置与错误）。两套实现意味着两套能力，用户在首页看到插件却什么都做不了。
 * 现在首页与管理页都渲染本组件。
 *
 * 覆盖的能力（全部对应真实端点）：
 * - 加载/卸载与**启停持久化**（enable/disable）、全部加载（load-all）、卸载删除
 * - 运行时配置读取/保存/恢复默认（含 secret 掩码的诚实提示）
 * - 插件 UI 定义预览（新旧两种 ui.json 形态都接受）
 * - 错误通道（读取 + 清空）
 * - **健康聚合**（P10）：overall / 每插件 issues / 签名校验 / 依赖 / Hook·Agent 计数 /
 *   风格解释器活跃 owner——这些「装了但没生效」的原因以前根本看不到
 * - **贡献清单**（A-6/D-1）：谁注册了什么（kind:id → owner），支持按 owner 过滤
 */
export function PluginsPanel() {
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);

  const [health, setHealth] = useState<PluginHealthResponse | null>(null);

  const [configId, setConfigId] = useState<string | null>(null);
  const [configFields, setConfigFields] = useState<Record<string, PluginConfigField>>({});
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // M12: 插件 UI 预览
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLayout, setPreviewLayout] = useState<UILayout | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // M7: 插件错误通道
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [pluginErrors, setPluginErrors] = useState<Awaited<ReturnType<typeof pluginApi.errors>>>([]);
  const [errorsLoading, setErrorsLoading] = useState(false);

  // P10: 健康详情 / 贡献清单
  const [healthOpen, setHealthOpen] = useState(false);
  const [contribOpen, setContribOpen] = useState(false);
  const [contributions, setContributions] = useState<PluginContributionItem[]>([]);
  const [contribOwner, setContribOwner] = useState<string>('');
  const [contribLoading, setContribLoading] = useState(false);

  const loadErrors = async () => {
    setErrorsLoading(true);
    try {
      setPluginErrors(await pluginApi.errors(100));
    } catch {
      setPluginErrors([]);
    } finally {
      setErrorsLoading(false);
    }
  };

  const clearErrors = async () => {
    try {
      await pluginApi.clearErrors();
      setPluginErrors([]);
    } catch { /* offline */ }
  };

  const loadContributions = async (owner = '') => {
    setContribLoading(true);
    try {
      const res = await pluginApi.contributions(owner ? { owner } : {});
      setContributions(Array.isArray(res?.contributions) ? res.contributions : []);
    } catch {
      setContributions([]);
    } finally {
      setContribLoading(false);
    }
  };

  const openPreview = async (p: PluginItem) => {
    setPreviewId(p.id);
    setPreviewLayout(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const ui = await pluginApi.getUI(p.id);
      // 兼容两种响应形态：旧格式顶层 widgets；新格式 slots[].layout.widgets
      const legacyWidgets = Array.isArray(ui?.widgets) ? ui!.widgets : [];
      const slotWidgets = ui?.slots?.flatMap((s) => s.layout?.widgets ?? []) ?? [];
      const widgets = legacyWidgets.length > 0 ? legacyWidgets : slotWidgets;
      if (widgets.length > 0) {
        setPreviewLayout({ title: ui?.title ?? ui?.slots?.[0]?.title ?? '插件 UI', widgets } as UILayout);
      } else {
        setPreviewError('该插件未定义 UI（ui.json 缺失或为空）');
      }
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : '读取插件 UI 失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [loaded, discovered, healthRes] = await Promise.allSettled([
        pluginApi.list(),
        pluginApi.discover(),
        pluginApi.health(),
      ]);
      const loadedList = loaded.status === 'fulfilled' ? normalizePluginList(loaded.value) : [];
      const discoveredIds = discovered.status === 'fulfilled' ? (discovered.value as string[]) : [];
      // 合并：已加载的 + 发现但未加载的
      const loadedIds = new Set(loadedList.map((p) => p.id));
      const unloadedPlugins: PluginItem[] = discoveredIds
        .filter((id) => !loadedIds.has(id))
        .map((id) => ({ id, name: id, kind: 'capability', loaded: false, description: '未加载' }));
      const merged = [...loadedList, ...unloadedPlugins];
      const healthData = healthRes.status === 'fulfilled' ? healthRes.value : null;
      setHealth(healthData);
      setPlugins(attachPluginHealth(merged, healthData?.plugins));
    } catch {
      setPlugins([]);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (p: PluginItem) => {
    setBusyId(p.id);
    try {
      // M8: 启停持久化 — enable/disable 落盘，重启后保持状态
      if (p.loaded) {
        await pluginApi.disable(p.id);
        setPlugins((ps) => ps.map((x) => (x.id === p.id ? { ...x, loaded: false } : x)));
      } else {
        await pluginApi.enable(p.id);
        // 批C：以后端实际状态为准——enable 加载失败会 502 并回退禁用态，
        // 旧实现吞错后无条件翻转开关，用户看到假 ACTIVE
        setPlugins((ps) => ps.map((x) => (x.id === p.id ? { ...x, loaded: true } : x)));
      }
      // B8：插件启停必须失效前端 Slot 缓存，否则已挂载的宿主 Slot 仍显示
      // 旧贡献（G7「禁用后 UI 同步消失」此前只在测试里成立）
      invalidatePluginSlots();
    } catch (e) {
      const anyE = e as { response?: { data?: { detail?: string } }; code?: string };
      const isNetwork = anyE?.code === 'ERR_NETWORK' || anyE?.code === 'ECONNABORTED';
      toast(isNetwork ? '后端离线，操作未生效' : (anyE?.response?.data?.detail ?? '操作失败，状态未变更'), 'error');
    }
    setBusyId(null);
  };

  const loadAll = async () => {
    setLoadingAll(true);
    try {
      await pluginApi.loadAll();
      await load(); // 批C：以服务端实际加载状态刷新列表（此前无条件全标 loaded）
    } catch {
      toast('后端离线，批量加载未执行', 'error');
    }
    setLoadingAll(false);
  };

  /** M8: 卸载删除——比「禁用」更进一步（移除落盘目录），需要确认。 */
  const removePlugin = async (p: PluginItem) => {
    if (!window.confirm(`确定删除插件「${p.name}」？这会从插件目录移除它，不只是禁用。`)) return;
    setBusyId(p.id);
    try {
      await pluginApi.remove(p.id);
      invalidatePluginSlots();
      await load();
      toast(`已删除插件 ${p.id}`);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast(detail ?? '删除失败（后端不可达或插件受保护）', 'error');
    }
    setBusyId(null);
  };

  const openConfig = async (p: PluginItem) => {
    setConfigId(p.id);
    setConfigFields({});
    setConfigError(null);
    setConfigLoading(true);
    try {
      const cfg = await pluginApi.getConfig(p.id) as unknown as PluginConfigResponse;
      setConfigFields(cfg.fields || {});
    } catch (e: unknown) {
      setConfigError(e instanceof Error ? e.message : '读取配置失败');
    } finally {
      setConfigLoading(false);
    }
  };

  const updateField = (key: string, value: unknown) => {
    setConfigFields((prev) => ({
      ...prev,
      [key]: { ...prev[key], value },
    }));
    setConfigError(null);
  };

  const saveConfig = async () => {
    if (!configId) return;
    // P1-10：secret 字段回显的是掩码（后端不出明文）——直接保存会把掩码存成密钥。
    // 后端掩码还原上线前，至少让用户知情确认。
    const masked = Object.values(configFields).some(
      (f) => f.secret && typeof f.value === 'string' && f.value.includes('****'),
    );
    if (masked && !window.confirm('密钥字段显示为掩码，直接保存会把掩码存为密钥导致其失效。如需更新请取消后重新粘贴完整密钥。确认继续保存？')) return;
    const yaml = buildConfigYaml(configFields);
    if (!yaml) return;
    setConfigSaving(true);
    setConfigError(null);
    try {
      await pluginApi.saveConfig(configId, yaml);
      closeConfig();
    } catch (e: unknown) {
      const resp = (e as { response?: { status?: number; data?: { detail?: { message?: string; errors?: string[] } | string } } }).response;
      if (resp?.status === 400) {
        const detail = resp.data?.detail;
        const errors = typeof detail === 'object' && detail !== null
          ? (detail as { errors?: string[] }).errors?.join('\n') || (detail as { message?: string }).message
          : String(detail || '');
        setConfigError(`校验失败:\n${errors}`);
      } else {
        setConfigError(e instanceof Error ? e.message : '保存失败');
      }
    } finally {
      setConfigSaving(false);
    }
  };

  const deleteConfig = async () => {
    if (!configId) return;
    setConfigSaving(true);
    setConfigError(null);
    try {
      await pluginApi.deleteConfig(configId);
      const cfg = await pluginApi.getConfig(configId) as unknown as PluginConfigResponse;
      setConfigFields(cfg.fields || {});
    } catch (e: unknown) {
      setConfigError(e instanceof Error ? e.message : '恢复默认失败');
    } finally {
      setConfigSaving(false);
    }
  };

  const closeConfig = () => {
    setConfigId(null);
    setConfigFields({});
    setConfigError(null);
  };

  const loadedCount = plugins.filter((p) => p.loaded).length;
  const overall = health?.overall ?? '';
  const overallTone = overall === 'ok' ? 'ok' : overall === 'error' ? 'error' : overall ? 'warn' : 'unknown';

  return (
    <>
      <div className="flex items-center gap-4 mb-6 bg-surface-container border border-outline-variant/30 rounded-cw-md px-5 py-3.5">
        <span className="w-10 h-10 rounded-cw-sm bg-primary-container flex items-center justify-center">
          <Puzzle className="w-5 h-5 text-on-primary-container" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-semibold text-on-surface">插件机架</p>
          <p className="font-mono text-caption text-on-surface-variant">
            {loadedCount}/{plugins.length} LOADED
            {health && (
              <>
                {' · '}
                <span className={cn(
                  overallTone === 'ok' ? 'text-track-audio'
                    : overallTone === 'error' ? 'text-error'
                      : overallTone === 'warn' ? 'text-warning' : 'text-on-surface-variant',
                )}>
                  HEALTH:{overall.toUpperCase()}
                </span>
                {health.errors_total > 0 && ` · ${health.errors_total} 错误`}
                {typeof health.prompts_registered === 'number' && ` · ${health.prompts_registered} prompt`}
              </>
            )}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> 刷新
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setHealthOpen(true); void load(); }}>
          <Activity className="w-3.5 h-3.5" /> 健康详情
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setContribOpen(true); void loadContributions(contribOwner); }}>
          <GitBranch className="w-3.5 h-3.5" /> 贡献清单
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setErrorsOpen(true); loadErrors(); }}>
          <AlertTriangle className="w-3.5 h-3.5" /> 错误通道
        </Button>
        <Button size="sm" onClick={loadAll} disabled={loadingAll}>
          {loadingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />} 全部加载
        </Button>
      </div>

      {/* C3：风格解释器是多注册按 priority 取活跃项——不显示出来，装了第二个插件
          也不知道自己没生效 */}
      {health?.style_interpreter && (health.style_interpreter.candidates?.length ?? 0) > 0 && (
        <div className="mb-5 max-w-[820px] bg-surface-container border border-outline-variant/30 rounded-cw-sm px-4 py-3">
          <p className="flex items-center gap-1.5 text-label-sm text-on-surface-variant mb-1">
            <Wand2 className="w-3.5 h-3.5 text-primary" /> 风格解释器
            <span className="font-mono text-caption">
              活跃：{health.style_interpreter.active || '（无）'}
            </span>
          </p>
          <p className="font-mono text-caption text-on-surface-variant/70">
            候选：{health.style_interpreter.candidates!.map((c) => `${c.owner}(p${c.priority})`).join(' · ')}
          </p>
        </div>
      )}

      <div className="space-y-2.5 max-w-[820px]">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-surface-container rounded-cw-md animate-pulse" />)
        ) : plugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center gap-2
            border border-dashed border-outline-variant/30 rounded-cw-md">
            <Puzzle className="w-8 h-8 text-on-surface-variant/40" />
            <p className="text-body-sm text-on-surface-variant">暂无插件</p>
            <p className="text-caption text-on-surface-variant/60">后端离线或插件目录为空。</p>
          </div>
        ) : (
          plugins.map((p, i) => (
            <div key={p.id}
              className={cn('relative flex items-center gap-4 bg-surface-container border rounded-cw-md px-5 py-4 overflow-hidden transition-all duration-short3 group hover:-translate-y-0.5',
                p.loaded ? 'border-track-audio/35 hover:shadow-lg hover:shadow-track-audio/5' : 'border-outline-variant/30 opacity-80')}
              style={{ animationDelay: `${i * 40}ms` }}>
              <span className={cn('absolute left-0 top-0 bottom-0 w-1 transition-colors duration-medium2',
                p.health?.status === 'error' ? 'bg-error'
                  : p.loaded ? 'bg-track-audio' : 'bg-outline-variant/40')} />

              <span className={cn('w-10 h-10 rounded-cw-sm flex items-center justify-center shrink-0 transition-colors',
                p.loaded ? 'bg-track-audio/15 text-track-audio' : 'bg-surface-container-high text-on-surface-variant')}>
                <Puzzle className="w-5 h-5" />
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <p className="font-mono text-body-sm font-semibold text-on-surface truncate">{p.id}</p>
                  {p.version && <span className="font-mono text-caption text-on-surface-variant shrink-0">v{p.version}</span>}
                  {p.kind && <span className="text-caption text-on-surface-variant/50 font-mono">{p.kind}</span>}
                  {p.agents && p.agents.length > 0 && (
                    <span className="font-mono text-caption text-primary/80 shrink-0"
                      title={p.agents.join(', ')}>
                      {p.agents.length} agent{p.agents.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {/* B2：贡献计数 + 零贡献/声明未注册告警（P12 后端字段落地到界面） */}
                  {typeof p.contributions?.length === 'number' && (
                    <span className="font-mono text-caption text-on-surface-variant/70 shrink-0"
                      title={p.contributions.map((c) => `${c.kind}:${c.id}`).join('\n')}>
                      {p.contributions.length} 贡献
                    </span>
                  )}
                  {/* P10：健康聚合里的签名与依赖状态 */}
                  {p.health?.signed === true && p.health.verified === false && (
                    <span className="font-mono text-caption text-error shrink-0 flex items-center gap-1"
                      title="manifest 带签名但校验失败">
                      <ShieldCheck className="w-3 h-3" /> 签名校验失败
                    </span>
                  )}
                  {p.health?.dependency_ok === false && (
                    <span className="font-mono text-caption text-warning shrink-0 flex items-center gap-1"
                      title={`缺少依赖：${(p.health.missing_dependencies ?? []).join(', ')}`}>
                      <Link2 className="w-3 h-3" /> 缺依赖
                    </span>
                  )}
                  {p.loaded && (p.health?.hooks ?? 0) > 0 && (
                    <span className="font-mono text-caption text-on-surface-variant/60 shrink-0"
                      title="已注册的 Hook 数">
                      {p.health!.hooks} hook
                    </span>
                  )}
                  {p.loaded && p.declaredOnly && p.declaredOnly.length > 0 && (
                    <span className="font-mono text-caption text-error shrink-0 flex items-center gap-1"
                      data-testid={`declared-only-${p.id}`}
                      title={`声明了但未注册（通常是缺少配置/密钥）：\n${p.declaredOnly.join('\n')}`}>
                      <AlertTriangle className="w-3 h-3" />
                      {p.declaredOnly.length} 项未生效
                    </span>
                  )}
                </div>
                {p.description && <p className="text-caption text-on-surface-variant truncate mt-0.5">{p.description}</p>}
                {p.health && p.health.issues.length > 0 && (
                  <p className="text-caption text-on-surface-variant/70 mt-0.5 truncate"
                    title={p.health.issues.join('；')}>
                    问题：{p.health.issues.join('；')}
                  </p>
                )}
              </div>

              <StatusPill ok={p.loaded} label={p.loaded ? 'ACTIVE' : 'OFF'} />

              {p.loaded && (
                <button onClick={() => openConfig(p)}
                  className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer shrink-0"
                  title="配置">
                  <Settings className="w-3.5 h-3.5" />
                </button>
              )}

              <button onClick={() => openPreview(p)}
                className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer shrink-0"
                title="UI 预览">
                <Eye className="w-3.5 h-3.5" />
              </button>

              <button onClick={() => removePlugin(p)} disabled={busyId === p.id}
                className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors cursor-pointer shrink-0"
                title="删除插件（从插件目录移除）">
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              <button onClick={() => toggle(p)} disabled={busyId === p.id}
                className={cn('relative w-12 h-[26px] rounded-cw-full transition-colors duration-short3 cursor-pointer shrink-0',
                  p.loaded ? 'bg-track-audio' : 'bg-outline-variant/50')}
                title={p.loaded ? '禁用（持久化）' : '启用（持久化）'}>
                {busyId === p.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white" />
                ) : (
                  <span className={cn('absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-all duration-short3 flex items-center justify-center',
                    p.loaded ? 'left-[26px]' : 'left-[3px]')}>
                    <Power className={cn('w-2.5 h-2.5', p.loaded ? 'text-track-audio' : 'text-on-surface-variant')} />
                  </span>
                )}
              </button>
            </div>
          ))
        )}
      </div>

      {configId && (
        <Modal onClose={closeConfig} title={`插件配置 · ${configId}`} maxWidth="max-w-lg">
          {configLoading ? (
            <div className="flex items-center gap-2 text-label-sm text-on-surface-variant py-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 读取配置…
            </div>
          ) : Object.keys(configFields).length === 0 ? (
            <p className="text-label-sm text-on-surface-variant text-center py-4">该插件暂无配置项。</p>
          ) : (
            <>
              <div className="space-y-3">
                {Object.entries(configFields).map(([key, field]) => (
                  <div key={key}>
                    <label className="block text-label font-medium text-on-surface-variant mb-1">
                      {field.label || key}
                      {field.description && (
                        <span className="block text-caption text-on-surface-variant/60 font-normal mt-0.5">{field.description}</span>
                      )}
                    </label>
                    <ConfigValueInput
                      type={field.type}
                      value={field.value}
                      onChange={(v) => updateField(key, v)}
                    />
                  </div>
                ))}
              </div>

              {configError && (
                <div className="bg-error/10 border border-error/30 rounded-cw-xs px-3 py-2 text-label-sm text-error whitespace-pre-wrap">{configError}</div>
              )}

              <div className="flex gap-2">
                <Button onClick={saveConfig} disabled={configSaving} className="flex-1">
                  {configSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  保存配置
                </Button>
                <Button variant="outline" onClick={deleteConfig} disabled={configSaving} className="flex-1">
                  <Trash2 className="w-4 h-4" />
                  恢复默认
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {healthOpen && (
        <Modal onClose={() => setHealthOpen(false)} title="插件健康详情" maxWidth="max-w-2xl"
          icon={<Activity className="w-4 h-4 text-primary" />}>
          {!health ? (
            <p className="text-label-sm text-on-surface-variant py-4">后端不可达，无健康数据。</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="总体" value={health.overall.toUpperCase()} />
                <Stat label="插件数" value={String(health.plugins.length)} />
                <Stat label="错误总数" value={String(health.errors_total)} />
              </div>
              <div className="space-y-2">
                {health.plugins.map((h) => (
                  <div key={h.plugin_id} className="bg-surface rounded-cw-xs border border-outline-variant/20 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-label-sm text-on-surface">{h.plugin_id}</span>
                      {h.version && <span className="font-mono text-caption text-on-surface-variant">v{h.version}</span>}
                      <span className={cn('font-mono text-caption px-1.5 rounded-cw-xs',
                        h.status === 'ok' ? 'bg-track-audio/15 text-track-audio'
                          : h.status === 'error' ? 'bg-error/15 text-error' : 'bg-warning/15 text-warning')}>
                        {h.status.toUpperCase()}
                      </span>
                      <span className="font-mono text-caption text-on-surface-variant/70 ml-auto">
                        {h.hooks} hook · {h.agents} agent
                        {h.signed === null ? '' : h.signed ? (h.verified ? ' · 签名OK' : ' · 签名失败') : ' · 未签名'}
                        {h.dependency_ok === null ? '' : h.dependency_ok ? ' · 依赖OK' : ' · 缺依赖'}
                      </span>
                    </div>
                    {h.issues.length > 0 && (
                      <p className="text-caption text-on-surface-variant/70 mt-1">· {h.issues.join('；')}</p>
                    )}
                    {h.missing_dependencies.length > 0 && (
                      <p className="font-mono text-caption text-warning/80 mt-0.5">
                        缺：{h.missing_dependencies.join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {health.style_interpreter && (
                <p className="font-mono text-caption text-on-surface-variant/70">
                  风格解释器活跃 owner：{health.style_interpreter.active || '（无）'}
                </p>
              )}
            </div>
          )}
        </Modal>
      )}

      {contribOpen && (
        <Modal onClose={() => setContribOpen(false)} title="插件贡献清单" maxWidth="max-w-2xl"
          icon={<GitBranch className="w-4 h-4 text-primary" />}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-caption text-on-surface-variant">按 owner 过滤</span>
            <input
              value={contribOwner}
              onChange={(e) => setContribOwner(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void loadContributions(contribOwner); }}
              placeholder="插件 id（留空=全部）"
              className="flex-1 bg-surface rounded-cw-xs px-2.5 py-1.5 text-label-sm font-mono text-on-surface
                outline-none border border-outline-variant/30 focus:border-primary"
            />
            <Button size="sm" variant="outline" onClick={() => loadContributions(contribOwner)} disabled={contribLoading}>
              <RefreshCw className={cn('w-3.5 h-3.5', contribLoading && 'animate-spin')} /> 查询
            </Button>
          </div>
          {contribLoading ? (
            <p className="text-label-sm text-on-surface-variant py-4">加载贡献…</p>
          ) : contributions.length === 0 ? (
            <p className="text-label-sm text-on-surface-variant/70 text-center py-6">没有匹配的贡献。</p>
          ) : (
            <ul className="space-y-1.5 max-h-[55vh] overflow-y-auto">
              {contributions.map((c, i) => (
                <li key={`${c.kind}:${c.id}:${i}`}
                  className="flex items-center gap-2 bg-surface rounded-cw-xs border border-outline-variant/20 px-3 py-1.5">
                  <span className="font-mono text-caption text-primary shrink-0">{c.kind}</span>
                  <span className="font-mono text-label-sm text-on-surface truncate flex-1">
                    {c.title || c.id}
                  </span>
                  {c.slot && <span className="font-mono text-caption text-on-surface-variant/60 shrink-0">{c.slot}</span>}
                  <span className="font-mono text-caption text-on-surface-variant shrink-0">{c.owner}</span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {errorsOpen && (
        <Modal onClose={() => setErrorsOpen(false)} title="插件错误通道" maxWidth="max-w-lg"
          icon={<AlertTriangle className="w-4 h-4 text-warning" />}
          headerExtra={(
            <Button size="sm" variant="outline" onClick={clearErrors} disabled={pluginErrors.length === 0}>
              <Trash2 className="w-3.5 h-3.5" /> 清空
            </Button>
          )}>
          {errorsLoading ? (
            <div className="flex items-center gap-2 text-label-sm text-on-surface-variant py-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载错误…
            </div>
          ) : pluginErrors.length === 0 ? (
            <p className="text-label-sm text-on-surface-variant/70 text-center py-6">暂无插件错误。</p>
          ) : (
            <ul className="space-y-2">
              {pluginErrors.map((e, i) => (
                <li key={i} className="bg-surface rounded-cw-xs border border-error/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-label-sm text-on-surface">{e.plugin_id}</span>
                    <span className="text-caption font-mono text-error/80">{e.phase}</span>
                    <span className="text-caption text-on-surface-variant/50 font-mono ml-auto">
                      {new Date(e.ts * 1000).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-label-sm text-on-surface mt-1">{e.message}</p>
                  {e.details && <p className="text-caption text-on-surface-variant/60 font-mono mt-1 break-all">{e.details}</p>}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {previewId && (
        <Modal onClose={() => setPreviewId(null)} title={`插件 UI 预览 · ${previewId}`} maxWidth="max-w-md"
          icon={<Box className="w-4 h-4 text-primary" />}>
          {previewLoading ? (
            <div className="flex items-center gap-2 text-label-sm text-on-surface-variant py-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载 UI…
            </div>
          ) : previewError ? (
            <p className="text-label-sm text-error py-4">{previewError}</p>
          ) : previewLayout ? (
            <div className="bg-surface rounded-cw-sm border border-outline-variant/20 p-3">
              <PluginLayoutRenderer layout={previewLayout} />
            </div>
          ) : null}
        </Modal>
      )}
    </>
  );
}

/** 统一的弹层外壳（配置/健康/贡献/错误/预览共用，避免五个几乎相同的 fixed 容器）。 */
function Modal({ title, icon, children, onClose, maxWidth = 'max-w-lg', headerExtra }: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: string;
  headerExtra?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className={cn('w-full max-h-[85vh] overflow-y-auto bg-surface-container border border-outline-variant/40 rounded-cw-lg p-5 space-y-4 shadow-xl', maxWidth)}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-title-sm font-semibold text-on-surface">
            {icon}{title}
          </h2>
          <div className="flex items-center gap-1">
            {headerExtra}
            <button onClick={onClose} className="p-1 rounded-cw-xs text-on-surface-variant hover:text-on-surface cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface rounded-cw-xs border border-outline-variant/20 px-3 py-2">
      <p className="font-mono text-title-sm text-on-surface">{value}</p>
      <p className="text-caption text-on-surface-variant">{label}</p>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-cw-full font-mono text-caption border shrink-0',
      ok ? 'bg-track-audio/10 text-track-audio border-track-audio/30' : 'bg-surface-container-high text-on-surface-variant border-outline-variant/30')}>
      <i className={cn('w-1.5 h-1.5 rounded-full', ok ? 'bg-track-audio animate-pulse' : 'bg-outline-variant')} />
      {label}
    </span>
  );
}

function buildConfigYaml(fields: Record<string, PluginConfigField>): string | null {
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;
  const lines = ['fields:'];
  for (const key of keys) {
    const f = fields[key];
    lines.push(`  ${key}:`);
    lines.push(`    type: ${f.type}`);
    lines.push(`    label: "${String(f.label).replace(/"/g, '\\"')}"`);
    if (f.description) lines.push(`    description: "${String(f.description).replace(/"/g, '\\"')}"`);
    // P1-10：secret 标记必须透传——丢失后后端不再加密该字段（明文落盘 + 明文回显）
    if (f.secret) lines.push('    secret: true');
    if (f.type === 'string') {
      lines.push(`    value: "${String(f.value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    } else if (f.type === 'int' || f.type === 'float') {
      lines.push(`    value: ${f.value ?? (f.type === 'int' ? 0 : 0.0)}`);
    } else if (f.type === 'bool') {
      lines.push(`    value: ${f.value ? 'true' : 'false'}`);
    } else {
      lines.push(`    value: ${JSON.stringify(f.value)}`);
    }
  }
  return lines.join('\n');
}
