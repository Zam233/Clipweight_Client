import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConsoleShell, ConsoleHeading } from './ConsoleShell';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  providersApi, providersForKind, buildSourcePayload, KIND_ROLES, ROLE_LABELS,
  validateGeneration, GENERATION_LIMITS,
  type AvailableProviders, type ProviderKind, type ProviderModel, type ProviderRole,
  type ProviderSource, type RoleBindings, type ModelGeneration,
} from '@/services/api/providers';
import {
  Plus, Trash2, RefreshCw, Loader2, Save, KeyRound, Star, StarOff, Pencil, Check, X, Activity, SlidersHorizontal,
} from 'lucide-react';

const TABS: { kind: ProviderKind; label: string; hint: string }[] = [
  { kind: 'llm', label: 'LLM', hint: '主 / Flash / 视觉 LLM 都在此配置，角色在工程文件中分配' },
  { kind: 'embedding', label: '嵌入 Embedding', hint: '知识库向量化（RAG 检索）' },
  { kind: 'rerank', label: '重排序 Rerank', hint: '检索结果精排' },
  { kind: 'tts', label: '语音 TTS', hint: '音色克隆与语音合成' },
];

interface HeaderRow { key: string; value: string }

interface FormState {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  timeoutSec: string;
  proxy: string;
  headers: HeaderRow[];
  keys: string[];
  models: ProviderModel[];
}

const EMPTY_FORM: FormState = {
  id: '', name: '', provider: '', baseUrl: '', timeoutSec: '',
  proxy: '', headers: [], keys: [''], models: [],
};

function toForm(src: ProviderSource): FormState {
  return {
    id: src.id,
    name: src.name ?? '',
    provider: src.provider ?? '',
    baseUrl: src.base_url ?? '',
    timeoutSec: src.timeout_sec ? String(src.timeout_sec) : '',
    proxy: src.proxy ?? '',
    headers: Object.entries(src.headers ?? {}).map(([key, value]) => ({ key, value: String(value) })),
    // 掩码回显：后端只给掩码，编辑时原样回传即「保留旧值」
    keys: (src.api_keys_masked?.length ? src.api_keys_masked : ['']).slice(),
    models: (src.models ?? []).map((m) => ({ ...m })),
  };
}

/**
 * ProvidersPage — 「模型提供商」控制台（对齐 AstronBot 的信息结构）。
 *
 * 顶部 tab = 源类型（LLM / 嵌入 / 重排序 / 语音）；左侧 = 该类型的源列表；
 * 右侧 = 源设置（ID / API Key 多条 / Base URL / 超时 / 代理 / 自定义请求头）
 * + 模型清单（获取 / 自定义 / 启用 / 编辑 / 删除）+ 角色分配。
 * provider 下拉选项来自 `/api/providers/available`（门面驱动，含插件贡献）。
 */
export function ProvidersPage() {
  const [kind, setKind] = useState<ProviderKind>('llm');
  const [sources, setSources] = useState<ProviderSource[]>([]);
  const [roles, setRoles] = useState<RoleBindings>({});
  const [available, setAvailable] = useState<AvailableProviders | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [editingModel, setEditingModel] = useState('');
  /** B4：正在编辑生成参数的模型 id（空 = 全部收起） */
  const [editingGeneration, setEditingGeneration] = useState('');
  const [newModel, setNewModel] = useState('');

  const reload = useCallback(async () => {
    setBusy('load');
    setError('');
    try {
      const [list, avail] = await Promise.all([providersApi.list(), providersApi.available()]);
      setSources(list.sources);
      setRoles(list.roles);
      setAvailable(avail);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const kindSources = useMemo(
    () => sources.filter((s) => (s.kind ?? 'llm') === kind),
    [sources, kind],
  );
  const providerOptions = useMemo(() => providersForKind(available, kind), [available, kind]);
  const kindRoles = KIND_ROLES[kind];

  const selectSource = (src: ProviderSource) => {
    setSelectedId(src.id);
    setForm(toForm(src));
    setNotice('');
    setError('');
  };

  const startNew = () => {
    setSelectedId('');
    setForm({ ...EMPTY_FORM, provider: providerOptions[0] ?? '', keys: [''] });
    setNotice('新源：填写后点「保存」创建');
    setError('');
  };

  const save = async () => {
    if (!form.name.trim()) { setError('请填写源 ID / 名称'); return; }
    setBusy('save');
    setError('');
    try {
      const payload = buildSourcePayload({
        name: form.name, kind, provider: form.provider,
        baseUrl: form.baseUrl, timeoutSec: form.timeoutSec, proxy: form.proxy,
        headers: form.headers, keys: form.keys,
      });
      const saved = selectedId
        ? await providersApi.update(selectedId, payload)
        : await providersApi.create(payload);
      if (form.models.length) await providersApi.setModels(saved.id, form.models);
      setNotice(`已保存：${saved.name}`);
      setSelectedId(saved.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy('');
    }
  };

  const removeSource = async () => {
    if (!selectedId) return;
    setBusy('remove');
    try {
      await providersApi.remove(selectedId);
      setSelectedId('');
      setForm(EMPTY_FORM);
      setNotice('源已删除（引用它的角色已解绑）');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy('');
    }
  };

  const fetchModels = async () => {
    if (!selectedId) { setError('请先保存源，再获取模型列表'); return; }
    setBusy('fetch');
    setError('');
    try {
      const { models, note } = await providersApi.fetchModels(selectedId);
      if (models.length) {
        setForm((f) => ({ ...f, models }));
        setNotice(`已获取 ${models.length} 个模型`);
      } else {
        setNotice(note ?? 'provider 未返回模型列表，可添加自定义模型');
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取模型列表失败');
    } finally {
      setBusy('');
    }
  };

  const addCustomModel = async () => {
    const id = newModel.trim();
    if (!id) return;
    if (!selectedId) { setError('请先保存源，再添加模型'); return; }
    setBusy('model');
    try {
      const updated = await providersApi.upsertModel(selectedId, { id, name: id, enabled: true });
      setForm((f) => ({ ...f, models: updated.models ?? f.models }));
      setNewModel('');
      setNotice(`已添加模型：${id}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加模型失败');
    } finally {
      setBusy('');
    }
  };

  const toggleModel = async (model: ProviderModel) => {
    if (!selectedId) return;
    const next = !(model.enabled ?? true);
    setForm((f) => ({
      ...f,
      models: f.models.map((m) => (m.id === model.id ? { ...m, enabled: next } : m)),
    }));
    try {
      const updated = await providersApi.upsertModel(selectedId, { ...model, enabled: next });
      setForm((f) => ({ ...f, models: updated.models ?? f.models }));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新模型失败');
    }
  };

  const renameModel = async (model: ProviderModel, name: string) => {
    if (!selectedId) return;
    setEditingModel('');
    try {
      const updated = await providersApi.upsertModel(selectedId, { ...model, name });
      setForm((f) => ({ ...f, models: updated.models ?? f.models }));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重命名失败');
    }
  };

  /** B4：逐模型生成参数编辑（空串 = 不提交该键；非法值 inline 报错且不落库） */
  const [genDraft, setGenDraft] = useState<Record<string, Partial<Record<keyof ModelGeneration, string>>>>({});
  const [genErrors, setGenErrors] = useState<Record<string, string>>({});

  const saveGeneration = async (model: ProviderModel) => {
    if (!selectedId) return;
    const draft = genDraft[model.id] ?? {};
    const { value, errors } = validateGeneration(draft);
    if (Object.keys(errors).length) {
      setGenErrors((e) => ({
        ...e,
        [model.id]: Object.values(errors).join('；'),
      }));
      return;
    }
    setGenErrors((e) => { const next = { ...e }; delete next[model.id]; return next; });
    setBusy(`gen-${model.id}`);
    try {
      const updated = await providersApi.upsertModel(selectedId, {
        ...model,
        generation: value,
      });
      setForm((f) => ({ ...f, models: updated.models ?? f.models }));
      setEditingGeneration('');
      await reload();
    } catch (e) {
      setGenErrors((prev) => ({
        ...prev,
        [model.id]: e instanceof Error ? e.message : '保存生成参数失败',
      }));
    } finally {
      setBusy('');
    }
  };

  const removeModel = async (modelId: string) => {
    if (!selectedId) return;
    try {
      const updated = await providersApi.deleteModel(selectedId, modelId);
      setForm((f) => ({ ...f, models: updated.models ?? f.models }));
      setNotice(`已删除模型：${modelId}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除模型失败');
    }
  };

  const bindRole = async (role: ProviderRole, sourceId: string, model?: string) => {
    setBusy(`role-${role}`);
    setError('');
    try {
      const src = sources.find((s) => s.id === sourceId);
      const enabled = (src?.models ?? []).filter((m) => m.enabled ?? true);
      // B2：模型可选——不传时退回该源第一个启用模型（此前无选择入口）
      const chosen = model ?? enabled[0]?.id ?? '';
      await providersApi.setRole(role, sourceId, chosen);
      setNotice(sourceId
        ? `${ROLE_LABELS[role]} → ${src?.name ?? sourceId}（模型 ${chosen || '未指定'}）`
        : `${ROLE_LABELS[role]} 已解绑`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '角色绑定失败');
    } finally {
      setBusy('');
    }
  };

  const testSource = async () => {
    if (!selectedId) { setError('请先保存源，再测试'); return; }
    setBusy('test');
    setError('');
    try {
      const result = await providersApi.testSource(selectedId);
      setNotice(result.ok
        ? `测试通过（${result.latencyMs ?? '-'}ms）：${result.detail}`
        : `测试未通过：${result.detail}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '测试失败');
    } finally {
      setBusy('');
    }
  };

  const setHeader = (i: number, patch: Partial<HeaderRow>) => {
    setForm((f) => ({ ...f, headers: f.headers.map((h, idx) => (idx === i ? { ...h, ...patch } : h)) }));
  };

  return (
    <ConsoleShell>
      <ConsoleHeading kicker="Settings / Providers" title="模型提供商"
        desc="按源管理凭据与模型清单，再把源绑定到角色。工程文件按角色引用模型，源里改密钥无需改工程。" />

      {/* 顶部 tab：源类型 */}
      <div className="flex items-center gap-1 mb-4 border-b border-outline-variant/25">
        {TABS.map((t) => (
          <button key={t.kind} type="button" onClick={() => { setKind(t.kind); startNew(); }}
            className={cn(
              'px-4 py-2 text-body-sm border-b-2 -mb-px transition-colors duration-short3',
              kind === t.kind
                ? 'border-primary text-on-surface font-medium'
                : 'border-transparent text-on-surface-variant hover:text-on-surface',
            )}>
            {t.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void reload()} disabled={busy === 'load'}>
            {busy === 'load' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            刷新
          </Button>
          <Button size="sm" variant="outline" onClick={startNew}>
            <Plus className="w-3.5 h-3.5" /> 新建源
          </Button>
        </span>
      </div>

      <p className="text-caption text-on-surface-variant mb-4" data-testid="tab-hint">
        {TABS.find((t) => t.kind === kind)?.hint}
      </p>

      {(notice || error) && (
        <div className={cn(
          'mb-3 px-3 py-2 rounded-cw-xs text-caption border',
          error ? 'border-error/40 text-error bg-error/5' : 'border-primary/30 text-primary bg-primary/5',
        )} role={error ? 'alert' : 'status'}>
          {error || notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* 左侧：提供商源列表 */}
        <aside className="bg-surface-container border border-outline-variant/30 rounded-cw-md overflow-hidden">
          <div className="px-3 py-2 border-b border-outline-variant/25 font-mono text-label-sm text-on-surface-variant tracking-wider">
            提供商源 ({kindSources.length})
          </div>
          <ul data-testid="source-list">
            {kindSources.length === 0 && (
              <li className="px-3 py-4 text-caption text-on-surface-variant/70">该类型暂无源</li>
            )}
            {kindSources.map((src) => {
              const boundRoles = kindRoles.filter((r) => roles[r]?.source_id === src.id);
              return (
                <li key={src.id}>
                  <button type="button" onClick={() => selectSource(src)} data-testid={`source-${src.id}`}
                    className={cn(
                      'w-full text-left px-3 py-2.5 border-b border-outline-variant/15 transition-colors duration-short3',
                      selectedId === src.id ? 'bg-primary/10' : 'hover:bg-surface-container-high',
                    )}>
                    <span className="flex items-center gap-2">
                      <span className="text-body-sm text-on-surface truncate">{src.name}</span>
                      {src.has_keys && <KeyRound className="w-3 h-3 text-track-audio shrink-0" aria-label="已配置密钥" />}
                    </span>
                    <span className="block font-mono text-caption text-on-surface-variant/70 mt-0.5">
                      {src.provider} · {src.key_count ?? 0} key(s) · {(src.models ?? []).length} model(s)
                    </span>
                    {boundRoles.length > 0 && (
                      <span className="block text-caption text-primary mt-0.5">
                        {boundRoles.map((r) => ROLE_LABELS[r]).join(' / ')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* 右侧：源设置 + 模型清单 + 角色 */}
        <div className="space-y-4">
          <section className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-4">
            <h3 className="text-body-sm font-semibold text-on-surface mb-3">源设置</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="ID（源名称）">
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="deepseek" data-testid="f-name" className={INPUT} />
              </Field>
              <Field label="提供商">
                <select value={form.provider} data-testid="f-provider"
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                  className={INPUT}>
                  {providerOptions.length === 0 && <option value="">（无可选提供商）</option>}
                  {providerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="API Base URL">
                <input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder="https://api.deepseek.com" data-testid="f-base-url" className={INPUT} />
              </Field>
              <Field label="超时时间（秒）">
                <input value={form.timeoutSec} onChange={(e) => setForm((f) => ({ ...f, timeoutSec: e.target.value }))}
                  placeholder="120" data-testid="f-timeout" className={INPUT} />
              </Field>
              <Field label="代理地址">
                <input value={form.proxy} onChange={(e) => setForm((f) => ({ ...f, proxy: e.target.value }))}
                  placeholder="http://127.0.0.1:7890" data-testid="f-proxy" className={INPUT} />
              </Field>
              <Field label="源 ID（只读）">
                <input value={selectedId || '（未保存）'} readOnly data-testid="f-id" className={cn(INPUT, 'opacity-70')} />
              </Field>
            </div>

            {/* API Key：可多条 */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-label-sm text-on-surface-variant">
                API Key（第一条为当前使用；其余作为备用保存，便于手动切换）
              </span>
                <Button size="sm" variant="ghost"
                  onClick={() => setForm((f) => ({ ...f, keys: [...f.keys, ''] }))}>
                  <Plus className="w-3.5 h-3.5" /> 添加密钥
                </Button>
              </div>
              <div className="space-y-2" data-testid="key-list">
                {form.keys.map((k, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={k} type="password" autoComplete="off"
                      onChange={(e) => setForm((f) => ({
                        ...f, keys: f.keys.map((x, idx) => (idx === i ? e.target.value : x)),
                      }))}
                      placeholder={k.includes('****') ? k : 'sk-...'} className={INPUT} />
                    <Button size="icon-sm" variant="ghost" aria-label={`删除密钥 ${i + 1}`}
                      onClick={() => setForm((f) => ({ ...f, keys: f.keys.filter((_, idx) => idx !== i) }))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* 自定义请求头 */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-label-sm text-on-surface-variant">自定义请求头</span>
                <Button size="sm" variant="ghost"
                  onClick={() => setForm((f) => ({ ...f, headers: [...f.headers, { key: '', value: '' }] }))}>
                  <Plus className="w-3.5 h-3.5" /> 添加请求头
                </Button>
              </div>
              <div className="space-y-2" data-testid="header-list">
                {form.headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={h.key} placeholder="X-Tenant" className={INPUT}
                      onChange={(e) => setHeader(i, { key: e.target.value })} />
                    <input value={h.value} placeholder="value" className={INPUT}
                      onChange={(e) => setHeader(i, { value: e.target.value })} />
                    <Button size="icon-sm" variant="ghost" aria-label={`删除请求头 ${i + 1}`}
                      onClick={() => setForm((f) => ({ ...f, headers: f.headers.filter((_, idx) => idx !== i) }))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <Button size="sm" onClick={() => void save()} disabled={busy === 'save'}>
                {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                保存
              </Button>
              {selectedId && (
                <>
                  <Button size="sm" variant="outline" onClick={() => void testSource()}
                    disabled={busy === 'test'} data-testid="test-source">
                    {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                    测试连接
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void removeSource()} disabled={busy === 'remove'}>
                    <Trash2 className="w-3.5 h-3.5" /> 删除源
                  </Button>
                </>
              )}
            </div>
          </section>

          {/* 模型清单 */}
          <section className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-body-sm font-semibold text-on-surface">模型清单</h3>
              <span className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void fetchModels()} disabled={busy === 'fetch'}>
                  {busy === 'fetch' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  获取模型列表
                </Button>
              </span>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <input value={newModel} onChange={(e) => setNewModel(e.target.value)}
                placeholder="自定义模型 ID，例如 deepseek-chat" data-testid="new-model" className={INPUT} />
              <Button size="sm" variant="outline" onClick={() => void addCustomModel()} disabled={busy === 'model'}>
                <Plus className="w-3.5 h-3.5" /> 自定义模型
              </Button>
            </div>
            <ul className="divide-y divide-outline-variant/15" data-testid="model-list">
              {form.models.length === 0 && (
                <li className="py-3 text-caption text-on-surface-variant/70">暂无模型（先获取或自定义添加）</li>
              )}
              {form.models.map((m) => (
                <li key={m.id} className="py-2">
                  <div className="flex items-center gap-2">
                  <button type="button" aria-label={`启用 ${m.id}`} onClick={() => void toggleModel(m)}
                    className="text-on-surface-variant hover:text-primary">
                    {(m.enabled ?? true)
                      ? <Star className="w-3.5 h-3.5 text-track-audio" />
                      : <StarOff className="w-3.5 h-3.5" />}
                  </button>
                  {editingModel === m.id ? (
                    <>
                      <input autoFocus defaultValue={m.name || m.id} className={INPUT}
                        data-testid={`rename-${m.id}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void renameModel(m, (e.target as HTMLInputElement).value);
                          if (e.key === 'Escape') setEditingModel('');
                        }} />
                      <Button size="icon-sm" variant="ghost" aria-label={`确认重命名 ${m.id}`}
                        onClick={() => void renameModel(m, m.name || m.id)}>
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`取消重命名 ${m.id}`}
                        onClick={() => setEditingModel('')}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className={cn('font-mono text-caption flex-1 truncate',
                        (m.enabled ?? true) ? 'text-on-surface' : 'text-on-surface-variant/50 line-through')}>
                        {m.id}{m.name && m.name !== m.id ? ` (${m.name})` : ''}
                      </span>
                      {/* B4：逐模型生成参数（temperature/top_p/max_tokens） */}
                      <Button size="icon-sm" variant="ghost" aria-label={`生成参数 ${m.id}`}
                        onClick={() => {
                          setEditingGeneration((cur) => (cur === m.id ? '' : m.id));
                          setGenDraft((d) => ({
                            ...d,
                            [m.id]: {
                              temperature: m.generation?.temperature?.toString() ?? '',
                              top_p: m.generation?.top_p?.toString() ?? '',
                              max_tokens: m.generation?.max_tokens?.toString() ?? '',
                            },
                          }));
                        }}>
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`编辑 ${m.id}`}
                        onClick={() => setEditingModel(m.id)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`删除模型 ${m.id}`}
                        onClick={() => void removeModel(m.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                  </div>
                  {editingGeneration === m.id && (
                    <div className="mt-2 pl-6" data-testid={`generation-${m.id}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        {(Object.keys(GENERATION_LIMITS) as Array<keyof ModelGeneration>).map((key) => (
                          <label key={key} className="flex items-center gap-1 text-caption text-on-surface-variant">
                            <span className="font-mono">{GENERATION_LIMITS[key].label}</span>
                            <input
                              className={cn(INPUT, 'w-24')}
                              inputMode="decimal"
                              aria-label={`${GENERATION_LIMITS[key].label} ${m.id}`}
                              placeholder={String(key === 'max_tokens' ? 4096 : key === 'temperature' ? 0.7 : 1)}
                              value={genDraft[m.id]?.[key] ?? ''}
                              onChange={(e) => setGenDraft((d) => ({
                                ...d,
                                [m.id]: { ...(d[m.id] ?? {}), [key]: e.target.value },
                              }))}
                            />
                          </label>
                        ))}
                        <Button size="sm" variant="outline" disabled={busy === `gen-${m.id}`}
                          onClick={() => void saveGeneration(m)}>
                          <Check className="w-3.5 h-3.5" /> 保存参数
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => {
                            setEditingGeneration('');
                            setGenErrors((e) => { const next = { ...e }; delete next[m.id]; return next; });
                          }}>
                          取消
                        </Button>
                      </div>
                      {genErrors[m.id] && (
                        <p className="mt-1 text-caption text-error" data-testid={`generation-error-${m.id}`}>
                          {genErrors[m.id]}
                        </p>
                      )}
                      {m.generation && !genErrors[m.id] && (
                        <p className="mt-1 text-caption text-on-surface-variant/70">
                          当前生效：{Object.entries(m.generation)
                            .map(([k, v]) => `${k}=${v}`).join(' · ')}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* 角色分配 */}
          <section className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-4">
            <h3 className="text-body-sm font-semibold text-on-surface mb-1">角色分配</h3>
            <p className="text-caption text-on-surface-variant mb-3">
              角色由工程文件引用；这里把「角色 → 源 + 模型」绑定好即可（源换密钥不影响工程）。
              <span className="text-on-surface-variant/70">
                {' '}绑定后的角色会**覆盖**「后端配置」页里同名的 provider / 密钥 / 模型字段。
              </span>
            </p>
            <div className="space-y-2" data-testid="role-bindings">
              {kindRoles.map((role) => {
                const boundSource = sources.find((s) => s.id === roles[role]?.source_id);
                const modelOptions = (boundSource?.models ?? []).filter((m) => m.enabled ?? true);
                return (
                  <div key={role} className="flex items-center gap-3">
                    <span className="w-[110px] shrink-0 font-mono text-label-sm text-on-surface">
                      {ROLE_LABELS[role]}
                    </span>
                    <select value={roles[role]?.source_id ?? ''} data-testid={`role-${role}`}
                      onChange={(e) => void bindRole(role, e.target.value, '')}
                      disabled={busy === `role-${role}`}
                      className={cn(INPUT, 'max-w-[240px]')}>
                      <option value="">（未绑定）</option>
                      {kindSources.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    {/* B2：模型可选（多模型源要分别给 main/flash/vision 指定） */}
                    <select
                      value={roles[role]?.model ?? ''}
                      data-testid={`role-model-${role}`}
                      disabled={!roles[role]?.source_id || busy === `role-${role}`}
                      onChange={(e) => void bindRole(role, roles[role]?.source_id ?? '', e.target.value)}
                      className={cn(INPUT, 'max-w-[220px]')}
                      title="该角色使用的模型（取源内已启用的模型）"
                    >
                      <option value="">（用第一个启用模型）</option>
                      {modelOptions.map((m) => (
                        <option key={m.id} value={m.id}>{m.id}</option>
                      ))}
                    </select>
                    {boundSource && modelOptions.length === 0 && (
                      <span className="text-caption text-error shrink-0">该源没有启用中的模型</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </ConsoleShell>
  );
}

const INPUT = 'w-full bg-surface rounded-cw-xs px-2.5 py-1.5 text-body-sm text-on-surface outline-none '
  + 'border border-outline-variant/30 focus:border-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-label-sm text-on-surface-variant mb-1">{label}</span>
      {children}
    </label>
  );
}
