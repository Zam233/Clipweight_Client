/**
 * PluginLayoutRenderer — JSON-driven UI rendering engine.
 *
 * Renders a UILayout tree into React components. Plugin developers define
 * declarative JSON layouts; this engine handles state management, input
 * binding, API calls, and conditional rendering.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { Loader2, AlertCircle, CheckCircle2, Info, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { asText } from '@/lib/render';
import type { UILayout, UIWidget, UIRenderState } from './types';
import { executePluginAction } from './executePluginAction';

/**
 * PL-03：插件 layout 来自后端/模型产物，TS 声明为 string 的字段运行时可能是
 * `{name:...}` 对象，直接进 JSX 会抛 "Objects are not valid as a React child"
 * 整块白屏。在渲染边界**递归**把所有展示文本字段收成字符串（对象转 JSON 文本），
 * 并过滤非字符串选项，保持结构不变；渲染代码无需逐个 `asText`。
 */
function sanitizeLayout(raw: UILayout): UILayout {
  const str = (v: unknown, fallback = ''): string => {
    if (v === undefined || v === null) return fallback;
    return typeof v === 'string' ? v : asText(v);
  };
  const walk = (w: unknown): UIWidget => {
    if (!w || typeof w !== 'object') return { type: 'text', content: '' } as UIWidget;
    const o = { ...(w as Record<string, unknown>) } as Record<string, unknown>;
    for (const key of [
      'type', 'key', 'label', 'placeholder', 'title', 'content', 'alt',
      'sourceField', 'textField', 'contentField', 'optionsFrom', 'accept',
      'defaultValue', 'severity', 'size', 'variant',
    ]) {
      if (key in o && o[key] !== undefined) {
        // 数值型 defaultValue / 控件类型等按原类型保留；其余展示字段一律收成字符串
        if (key === 'defaultValue' && (typeof o[key] === 'number' || typeof o[key] === 'boolean')) continue;
        o[key] = str(o[key]);
      }
    }
    if ('options' in o && Array.isArray(o.options)) {
      o.options = (o.options as unknown[]).filter((s): s is string => typeof s === 'string');
    }
    // C4：容器 children/widgets 非数组时安全降级为空数组（旧实现直接 .map 会白屏）。
    for (const container of ['children', 'widgets']) {
      if (container in o) {
        o[container] = Array.isArray(o[container])
          ? (o[container] as unknown[]).map(walk)
          : [];
      }
    }
    return o as unknown as UIWidget;
  };
  return {
    ...raw,
    title: str(raw.title),
    widgets: Array.isArray(raw.widgets) ? raw.widgets.map(walk) : [],
  };
}

/** C4：只允许 data:/blob: 或同源相对路径；拒绝外链 http(s)/协议相对/其它协议。 */
export function safeImageSrc(raw: unknown): string {
  const src = typeof raw === 'string' ? raw.trim() : '';
  if (!src) return '';
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  // 协议相对 //host、任意 scheme（http:/https:/javascript:）与反斜杠一律拒绝
  if (src.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) || src.includes('\\')) return '';
  // 其余为同源相对路径（/foo.png、foo/bar.png、./x.png）
  return src;
}

/** C4：alert severity 白名单，非法值回退 info（避免 colors/icons 索引 undefined 崩溃）。 */
function safeSeverity(raw: unknown): 'error' | 'info' | 'success' {
  return raw === 'error' || raw === 'success' ? raw : 'info';
}

/** C4：响应合并 state 时过滤原型污染键与未声明的目标键。 */
function safeStateKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

export interface PluginOptionSource {
  value: string;
  label: string;
}

export function PluginLayoutRenderer({
  layout,
  optionSources,
  onChange,
  owner,
  stateKey,
  readOnly = false,
}: {
  layout: UILayout;
  /** 宿主提供的动态选项（白名单数据源名 → 选项）。插件不能读任意数据。 */
  optionSources?: Record<string, PluginOptionSource[]>;
  /** 控件值变化回调（宿主据此接入业务流程，如创作页的配音入口）。 */
  onChange?: (values: Record<string, unknown>) => void;
  /** C4：贡献所属插件 owner——按钮动作的受限代理按它路由，缺失即拒绝。 */
  owner?: string;
  /** C4：按贡献身份隔离渲染状态（不同 owner/id 不串用）。 */
  stateKey?: string;
  /** C4：管理页 UI 预览只读——button/file 禁用，image 不渲染外链。 */
  readOnly?: boolean;
}) {
  // C4：状态按贡献身份隔离——身份变化时清空残留（渲染期条件重置，React 官方模式），
  // 配合调用方传入的 React key 可保证不同 owner/id 的渲染器互不串用。
  const identity = stateKey ?? owner ?? '';
  const [state, setState] = useState<UIRenderState>({});
  // PL-03：先归一化整棵布局树，后续所有渲染点拿到的都是安全字符串。
  const safeLayout = useMemo(() => sanitizeLayout(layout), [layout]);
  const updatingRef = useRef(false);
  // P2-17 + C4：布局（schema）或贡献身份变化时重置渲染状态——旧实现跨插件/
  // 跨版本复用 state，残留旧 key 会污染新布局取值，两个同 id 不同 owner 也会串用。
  const layoutSig = JSON.stringify(safeLayout);
  const sig = `${identity}::${layoutSig}`;
  const prevSigRef = useRef(sig);
  if (prevSigRef.current !== sig) {
    // React 官方支持的「渲染期条件重置」模式
    prevSigRef.current = sig;
    setState({});
  }
  // 动作序号：丢弃过期响应，避免快速连点导致旧响应覆盖新状态
  const actionSeqRef = useRef(0);

  const setUIState = useCallback((key: string, value: unknown) => {
    if (updatingRef.current) return;
    setState((s) => ({ ...s, [key]: value }));
  }, []);

  // 值变化通知宿主：用 ref 持有最新回调，依赖只跟 state 走——宿主若传内联箭头函数，
  // 直接依赖 onChange 会每次渲染都触发一次，进而 setState → 死循环。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current?.(state);
  }, [state]);

  const getValue = useCallback(
    (key: string | undefined): unknown => {
      if (!key) return undefined;
      const raw = state[key];
      // PL-03：状态值来自接口/模型回填，运行时可能是对象。渲染点多数直接
      // 把它放进 JSX 或当字符串用，这里统一把非标量收成安全文本。
      if (raw === null || raw === undefined) return raw;
      const t = typeof raw;
      if (t === 'string' || t === 'number' || t === 'boolean') return raw;
      // File 对象（UIFile 控件）必须原样保留给宿主 onChange，不能转文本
      if (typeof File !== 'undefined' && raw instanceof File) return raw;
      return asText(raw);
    },
    [state],
  );

  const handleAction = useCallback(
    async (widget: { type: 'button'; label: string; action: import('./types').UIAction; disabledWhen?: string }) => {
      const { action } = widget;
      // C4：只读预览绝不执行动作（管理页 UI 预览不允许发 HTTP / 上传 / 编辑命令）。
      if (readOnly) return;
      // Interpolate "${key}" references in body（跳过原型键，防污染 state）。
      const resolveBody = (obj: Record<string, unknown>): Record<string, unknown> => {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (!safeStateKey(k)) continue;
          if (typeof v === 'string' && v.startsWith('${') && v.endsWith('}')) {
            const fieldKey = v.slice(2, -1);
            result[k] = safeStateKey(fieldKey) ? (state[fieldKey] ?? '') : '';
          } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            result[k] = resolveBody(v as Record<string, unknown>);
          } else {
            result[k] = v;
          }
        }
        return result;
      };

      const body = action.body ? resolveBody(action.body) : undefined;
      // C4：兼容旧版 ui.json 的 body.tool → body.name（仅 /api/tool/execute 且无 name）。
      // toPluginProxyRequest 里也有兜底映射，这里补一次并显式告警一次，保证升级用户可用。
      let specBody = body;
      if (action.endpoint === '/api/tool/execute' && body) {
        const rec = body as Record<string, unknown>;
        if ((rec.name === undefined || rec.name === null || rec.name === '') &&
            rec.tool !== undefined && rec.tool !== null && rec.tool !== '') {
          specBody = { ...rec, name: rec.tool };
          // eslint-disable-next-line no-console
          console.warn('[plugin] 旧版 ui.json 按钮 body 使用 tool 字段，已兼容补 name；请改用 name。');
        }
      }

      const seq = ++actionSeqRef.current;
      // Set loading state
      if (action.loadingKey) {
        updatingRef.current = true;
        setState((s) => ({ ...s, [action.loadingKey!]: true, [action.errorKey || '']: null }));
        updatingRef.current = false;
      }

      // C4：统一执行器——门禁、受限代理、owner 归属、写操作确认都收敛到一处。
      const result = await executePluginAction(
        owner ?? '',
        { endpoint: action.endpoint, method: action.method, body: specBody },
        { contributionId: identity, label: widget.label },
      );
      if (seq !== actionSeqRef.current) return; // 过期响应，丢弃

      const updates: Record<string, unknown> = {};
      if (action.loadingKey && safeStateKey(action.loadingKey)) {
        updates[action.loadingKey] = false;
      }
      if (!result.ok) {
        // 取消（用户主动）不写 errorKey，避免预览里出现误报错。
        if (result.reason !== 'cancelled' && action.errorKey && safeStateKey(action.errorKey)) {
          updates[action.errorKey] = result.message ?? '插件动作执行失败';
        }
      } else {
        if (action.successKey && safeStateKey(action.successKey)) updates[action.successKey] = true;
        if (action.errorKey && safeStateKey(action.errorKey)) updates[action.errorKey] = null;
        // C4：响应合并 state 只允许 resultMap 显式声明的 key（无 resultMap 时
        // 不再 Object.assign(updates, data) 全量合并），并过滤原型键。
        if (action.resultMap) {
          const data = result.data;
          for (const [stateKey, dataPath] of Object.entries(action.resultMap)) {
            if (!safeStateKey(stateKey)) continue;
            const val = String(dataPath).split('.').reduce((obj: unknown, k: string) => {
              if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[k];
              return undefined;
            }, data);
            if (val !== undefined) updates[stateKey] = val;
          }
        }
      }
      updatingRef.current = true;
      setState((s) => ({ ...s, ...updates }));
      updatingRef.current = false;
    },
    [state, owner, identity, readOnly],
  );

  const renderWidget = useMemo(
    () =>
      (widget: UIWidget, idx: number): React.ReactNode => {
        const vis = widget.visibleWhen ? getValue(widget.visibleWhen) : true;
        if (!vis) return null;

        switch (widget.type) {
          case 'textarea': {
            const val = (getValue(widget.key) as string) ?? widget.defaultValue ?? '';
            const inputId = `plui-${widget.key}-textarea`;
            return (
              <div key={widget.key}>
                {widget.label && (
                  <label htmlFor={inputId} className="block text-label text-on-surface-variant mb-1">{widget.label}</label>
                )}
                <textarea
                  id={inputId}
                  value={val}
                  onChange={(e) => setUIState(widget.key, e.target.value)}
                  placeholder={widget.placeholder}
                  rows={widget.rows ?? 3}
                  className="w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
                    outline-none border border-outline-variant/30 focus:border-primary resize-none
                    placeholder:text-on-surface-variant/40"
                />
              </div>
            );
          }

          // 别名：后端配置控件与插件 schema 常用 'string' 表示单行文本输入
          case 'string':
          case 'input': {
            const val = (getValue(widget.key) as string) ?? widget.defaultValue ?? '';
            const inputId = `plui-${widget.key}-input`;
            return (
              <div key={widget.key}>
                {widget.label && (
                  <label htmlFor={inputId} className="block text-label text-on-surface-variant mb-1">{widget.label}</label>
                )}
                <input
                  id={inputId}
                  type="text"
                  value={val}
                  onChange={(e) => setUIState(widget.key, e.target.value)}
                  placeholder={widget.placeholder}
                  className="w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
                    outline-none border border-outline-variant/30 focus:border-primary
                    placeholder:text-on-surface-variant/40"
                />
              </div>
            );
          }

          case 'select': {
            // 选项来源两种：静态 `options` 或宿主白名单数据源 `optionsFrom`
            // （例如 `voices` = 音色列表，由宿主管线提供；插件本身拿不到任意数据）。
            const dynamic = widget.optionsFrom ? (optionSources?.[widget.optionsFrom] ?? []) : null;
            const opts: Array<{ value: string; label: string }> = dynamic
              ? dynamic
              : (widget.options ?? []).map((o) => ({ value: o, label: o }));
            const val = (getValue(widget.key) as string) ?? widget.defaultValue ?? opts[0]?.value ?? '';
            const inputId = `plui-${widget.key}-select`;
            if (opts.length === 0) {
              return (
                <div key={widget.key} className="text-caption text-on-surface-variant">
                  {widget.label || widget.key}：暂无可用选项
                  {widget.optionsFrom ? `（数据源 ${widget.optionsFrom} 为空）` : ''}
                </div>
              );
            }
            return (
              <div key={widget.key}>
                {widget.label && (
                  <label htmlFor={inputId} className="block text-label text-on-surface-variant mb-1">{widget.label}</label>
                )}
                <select
                  id={inputId}
                  value={val}
                  onChange={(e) => setUIState(widget.key, e.target.value)}
                  className="w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
                    outline-none border border-outline-variant/30 focus:border-primary cursor-pointer"
                >
                  {opts.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            );
          }

          case 'checkbox': {
            const val = (getValue(widget.key) as boolean) ?? widget.defaultValue ?? false;
            return (
              <label key={widget.key} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={val}
                  onChange={(e) => setUIState(widget.key, e.target.checked)}
                  className="w-4 h-4 accent-primary cursor-pointer"
                />
                {widget.label && <span className="text-label text-on-surface-variant">{widget.label}</span>}
              </label>
            );
          }

          case 'slider': {
            const min = widget.min ?? 0;
            const max = widget.max ?? 100;
            const step = widget.step ?? 1;
            const val = (getValue(widget.key) as number) ?? widget.defaultValue ?? min;
            const inputId = `plui-${widget.key}-slider`;
            return (
              <div key={widget.key}>
                {widget.label && (
                  <label htmlFor={inputId} className="flex items-center justify-between text-label text-on-surface-variant mb-1">
                    <span>{widget.label}</span>
                    <span className="font-mono text-caption">{val}</span>
                  </label>
                )}
                <input
                  id={inputId}
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={val}
                  onChange={(e) => setUIState(widget.key, Number(e.target.value))}
                  className="w-full accent-primary cursor-pointer"
                />
              </div>
            );
          }

          case 'button': {
            const disabled = readOnly || (widget.disabledWhen ? !!getValue(widget.disabledWhen) : false);
            return (
              <Button
                key={widget.label}
                size="sm"
                onClick={() => handleAction(widget)}
                disabled={disabled}
                className="w-full"
              >
                {widget.label}
              </Button>
            );
          }

          case 'image': {
            // C4：只读预览不渲染任何外链 http(s) src；其余场景也只允许 data:/blob:/同源相对路径。
            const src = safeImageSrc(getValue(widget.sourceField));
            if (!src) return null;
            return (
              <div key={widget.sourceField} className="rounded-cw-sm overflow-hidden border border-outline-variant/20">
                <img src={src} alt={widget.alt ?? ''} className="w-full" />
              </div>
            );
          }

          case 'spinner': {
            return (
              <div key="spinner" className="flex items-center justify-center gap-2 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                {widget.label && <span className="text-caption text-on-surface-variant">{widget.label}</span>}
              </div>
            );
          }

          case 'alert': {
            const msg = (getValue(widget.textField) as string) ?? '';
            if (!msg) return null;
            const colors = {
              error: 'border-error/20 bg-error/5 text-error',
              info: 'border-primary/20 bg-primary/5 text-primary',
              success: 'border-track-video/20 bg-track-video/5 text-track-video',
            };
            const icons = { error: AlertCircle, info: Info, success: CheckCircle2 };
            // C4：非法 severity 安全回退 info（不索引 undefined 导致白屏）。
            const severity = safeSeverity(widget.severity);
            const Icon = icons[severity];
            return (
              <div
                key={widget.textField}
                className={cn('flex items-start gap-2 px-3 py-2 rounded-cw-sm border text-caption', colors[severity])}
              >
                <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{msg}</span>
              </div>
            );
          }

          case 'text': {
            const content = widget.contentField ? ((getValue(widget.contentField) as string) ?? widget.content) : widget.content;
            return (
              <p
                key={widget.content}
                className={cn(
                  'text-on-surface-variant',
                  widget.size === 'caption' ? 'text-caption' : 'text-body-sm',
                )}
              >
                {content}
              </p>
            );
          }

          case 'row': {
            return (
              <div
                key={`row-${idx}`}
                className="flex items-center gap-2"
                style={{ gap: widget.gap != null ? `${widget.gap * 4}px` : undefined }}
              >
                {(Array.isArray(widget.children) ? widget.children : []).map((w, i) => renderWidget(w, i))}
              </div>
            );
          }

          case 'column': {
            return (
              <div
                key={`col-${idx}`}
                className="flex flex-col"
                style={{ gap: widget.gap != null ? `${widget.gap * 4}px` : '12px' }}
              >
                {(Array.isArray(widget.children) ? widget.children : []).map((w, i) => renderWidget(w, i))}
              </div>
            );
          }

          case 'group': {
            return (
              <div key={`group-${idx}`} className="rounded-cw-sm border border-outline-variant/20 p-3 space-y-3">
                {widget.title && <h4 className="text-label font-medium text-on-surface-variant">{widget.title}</h4>}
                {(Array.isArray(widget.children) ? widget.children : []).map((w, i) => renderWidget(w, i))}
              </div>
            );
          }

          // 文件选择（2026-11-02 补）：值 = `File` 对象，经 onChange 交给宿主上传。
          // 控件本身不发起网络请求（UIAction 只支持 JSON body，上传是多部分表单），
          // 插件也就拿不到上传 API / 工作区路径 / 凭据 —— 这与「判断交给模型、
          // 能力交给插件、执行归宿主」同一条边界。
          case 'file': {
            const raw = getValue(widget.key);
            const picked = typeof File !== 'undefined' && raw instanceof File ? raw : null;
            // 宿主回填的字符串（上传后的路径/文件名）也要显示，否则上传完成控件看起来是空的
            const uploaded = typeof raw === 'string' ? raw : '';
            const fileName = picked?.name ?? (uploaded ? uploaded.split(/[\\/]/).pop() || uploaded : '');
            return (
              <div key={widget.key}>
                {widget.label && (
                  <div className="block text-label text-on-surface-variant mb-1">{widget.label}</div>
                )}
                <label
                  className={cn(
                    'w-full flex items-center justify-center gap-2 rounded-cw-sm py-2.5 px-3 text-label-sm cursor-pointer',
                    'border-2 border-dashed border-outline-variant/40 hover:border-primary/60 transition-colors',
                    fileName ? 'text-on-surface' : 'text-on-surface-variant',
                  )}
                >
                  <input
                    type="file"
                    accept={widget.accept}
                    disabled={readOnly}
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      // 同一个文件再次选择必须能触发 onChange，所以清空原生 input 的值
                      e.target.value = '';
                      setUIState(widget.key, f);
                    }}
                  />
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{fileName || widget.placeholder || '选择文件'}</span>
                  {fileName && (
                    <button
                      type="button"
                      title="清除已选文件"
                      // label 包裹的按钮默认会继续触发文件选择，必须阻止
                      onClick={(e) => { e.preventDefault(); if (!readOnly) setUIState(widget.key, null); }}
                      disabled={readOnly}
                      className="p-0.5 rounded-cw-xs text-on-surface-variant hover:text-error cursor-pointer shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </label>
              </div>
            );
          }

          default:
            // P2-17: 未知控件不再静默丢弃——给可见占位提示（插件 UI 规范
            // 演进/前端未实现该控件时用户与开发者都能立刻发现）
            return (
              <div
                key={`unknown-${idx}`}
                className="px-3 py-2 rounded-cw-sm border border-dashed border-outline-variant/50 text-caption text-on-surface-variant"
                title={`未知控件类型: ${String((widget as { type?: unknown })?.type ?? '?')}`}
              >
                此控件类型暂不支持（本版本前端未实现），已在插件 UI 中占位。
              </div>
            );
        }
      },
    [getValue, handleAction, setUIState, readOnly, optionSources],
  );

  return <div className="space-y-3">{safeLayout.widgets.map((w, i) => renderWidget(w, i))}</div>;
}


