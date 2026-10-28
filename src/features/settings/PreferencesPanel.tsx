import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { healthApi, assetApi, resetApiClient } from '@/services/api';
import { getApiClient } from '@/services/api/client';
import { Button, Badge, Slider } from '@/components/ui';
import {
  Server, Palette, Ruler, Save, RefreshCw, FolderOpen, Gauge,
  Keyboard, SlidersHorizontal,
} from 'lucide-react';
import { keybindingEngine } from '@/features/keyboard/KeybindingEngine';
import { useKeybindingStore } from '@/features/keyboard/keybindingStore';

/** 偏好设置的分区开关（首页「设置」tab 只放常用的，独立设置页放全部）。 */
export interface PreferencesPanelProps {
  /** 后端连接（API 地址 + 连通性测试） */
  connection?: boolean;
  /** 用量统计（需要后端） */
  usage?: boolean;
  appearance?: boolean;
  timeline?: boolean;
  autosave?: boolean;
  demoMode?: boolean;
  materialSources?: boolean;
  keybindings?: boolean;
}

/**
 * PreferencesPanel — 本地偏好设置的**唯一实现**。
 *
 * 为什么抽出来：首页「设置」tab 与独立设置页此前各写一套几乎相同的控件
 * （主题/语言/自动保存/帧率/分辨率/吸附…），是"大量重复"的直接来源；
 * 而且两套实现已经漂移——首页给的是「帧率」「分辨率」「吸附」「标尺帧标记」，
 * 独立页给的是「默认帧率」「吸附阈值」「默认分辨率预设」，同一件事两种说法、
 * 两组不同的字段。现在两边渲染同一份组件，只按需要开关分区。
 */
export function PreferencesPanel({
  connection = true,
  usage = true,
  appearance = true,
  timeline = true,
  autosave = true,
  demoMode = true,
  materialSources = true,
  keybindings = true,
}: PreferencesPanelProps = {}) {
  const s = useSettingsStore();
  const [health, setHealth] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const [matSources, setMatSources] = useState<{ id: string; name: string }[]>([]);
  const [matLoading, setMatLoading] = useState(false);
  // P5: 用量报表
  const [usageData, setUsageData] = useState<{ pipelines: number; renders: number; llm_tokens_month: number; llm_tokens_total: number } | null>(null);

  useEffect(() => {
    if (!usage) return;
    void (async () => {
      try {
        const { data } = await getApiClient().get('/api/stats/usage');
        setUsageData(data);
      } catch { /* 后端离线 */ }
    })();
  }, [usage]);

  const loadMatSources = async () => {
    setMatLoading(true);
    try { setMatSources(await assetApi.listSources()); } catch { /* offline */ }
    setMatLoading(false);
  };

  useEffect(() => { if (materialSources) void loadMatSources(); }, [materialSources]);

  const checkHealth = async () => {
    setHealth('checking');
    try {
      await healthApi.check();
      setHealth('ok');
    } catch {
      setHealth('fail');
    }
  };

  // C4: 快捷键自定义
  const kb = useKeybindingStore();
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const captureOnceRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    captureOnceRef.current = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener('keydown', captureOnceRef.current, true);
      const id = recordingId;
      setRecordingId(null);
      if (!id) return;
      if (e.key === 'Escape') return; // 取消
      if (e.key === 'Backspace' || e.key === 'Delete') { kb.resetCombo(id); return; } // 恢复默认
      const mods: string[] = [];
      if (e.ctrlKey || e.metaKey) mods.push('ctrl');
      if (e.shiftKey) mods.push('shift');
      if (e.altKey) mods.push('alt');
      const key = normalizeCaptureKey(e.key);
      if (!key) return;
      const combo = [...mods, key].join('+');
      kb.setCombo(id, combo);
    };
  }, [recordingId, kb]);

  const startRecord = (id: string) => {
    setRecordingId(id);
    setTimeout(() => document.addEventListener('keydown', captureOnceRef.current, true), 0);
  };

  useEffect(() => () => { document.removeEventListener('keydown', captureOnceRef.current, true); }, []);

  const bindings = keybindingEngine.list();

  return (
    <div className="space-y-6">
      {/* API connection */}
      {connection && (
        <Card icon={<Server className="w-4 h-4" />} title="后端连接">
          <Field label="API 地址">
            <input
              value={s.apiBaseUrl}
              onChange={(e) => s.setApiBaseUrl(e.target.value)}
              onBlur={resetApiClient}
              className="w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm font-mono text-on-surface
                outline-none border border-outline-variant/30 focus:border-primary"
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={checkHealth}>
              <RefreshCw className={`w-3.5 h-3.5 ${health === 'checking' ? 'animate-spin' : ''}`} />
              测试连接
            </Button>
            {health === 'ok' && <Badge variant="success">引擎在线</Badge>}
            {health === 'fail' && <Badge variant="error">无法连接</Badge>}
          </div>
        </Card>
      )}

      {/* P5: 用量报表（用户可读） */}
      {usage && (
        <Card icon={<Gauge className="w-4 h-4" />} title="用量统计">
          {usageData ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="管线运行" value={String(usageData.pipelines)} />
              <Stat label="渲染任务" value={String(usageData.renders)} />
              <Stat label="本月 LLM Tokens" value={usageData.llm_tokens_month.toLocaleString()} />
              <Stat label="累计 LLM Tokens" value={usageData.llm_tokens_total.toLocaleString()} />
            </div>
          ) : (
            <p className="text-caption text-on-surface-variant">加载中…（后端离线则不可用）</p>
          )}
        </Card>
      )}

      {/* Appearance */}
      {appearance && (
        <Card icon={<Palette className="w-4 h-4" />} title="外观">
          <Field label="主题">
            <div className="flex bg-surface rounded-cw-sm border border-outline-variant/40 p-0.5">
              {(['dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => s.setTheme(t)}
                  className={`px-4 py-1.5 rounded-cw-xs text-label-sm transition-colors cursor-pointer ${
                    s.theme === t ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {t === 'dark' ? '暗色（推荐）' : '亮色'}
                </button>
              ))}
            </div>
          </Field>
          <Field label="界面语言">
            <div className="flex bg-surface rounded-cw-sm border border-outline-variant/40 p-0.5">
              {(['zh', 'en'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => s.setLanguage(l)}
                  className={`px-4 py-1.5 rounded-cw-xs text-label-sm transition-colors cursor-pointer ${
                    s.language === l ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {l === 'zh' ? '中文' : 'English'}
                </button>
              ))}
            </div>
          </Field>
        </Card>
      )}

      {/* Timeline defaults */}
      {timeline && (
        <Card icon={<Ruler className="w-4 h-4" />} title="时间轴默认值">
          <Slider label="默认帧率" min={24} max={60} step={1} value={s.defaultFps} onChange={s.setDefaultFps} />
          <Slider label="吸附阈值" min={2} max={20} step={1} value={s.snapThresholdPx} onChange={s.setSnapThreshold} />
          <Field label="默认分辨率">
            <div className="flex flex-wrap gap-2">
              {[
                { w: 1920, h: 1080, label: '1080p' },
                { w: 3840, h: 2160, label: '4K' },
                { w: 1080, h: 1920, label: '竖屏' },
              ].map((r) => (
                <button
                  key={r.label}
                  onClick={() => s.setDefaultResolution({ width: r.w, height: r.h })}
                  className={`px-3 py-1.5 rounded-cw-sm text-label-sm border transition-colors cursor-pointer ${
                    s.defaultResolution.width === r.w && s.defaultResolution.height === r.h
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </Field>
          <ToggleRow
            label="启用吸附（对齐）"
            hint="拖动片段时对齐片段边缘 / 播放头 / 标记点"
            checked={s.snapEnabled}
            onChange={s.setSnapEnabled}
          />
          <ToggleRow
            label="标尺显示帧标记"
            hint="时间轴刻度尺上显示帧级刻线"
            checked={s.showFramesInRuler}
            onChange={s.setShowFramesInRuler}
          />
        </Card>
      )}

      {/* Saving */}
      {autosave && (
        <Card icon={<Save className="w-4 h-4" />} title="保存">
          <ToggleRow
            label="自动保存"
            hint="编辑时自动写入本地缓存"
            checked={s.autoSave}
            onChange={s.setAutoSave}
          />
        </Card>
      )}

      {/* 轮 89：演示回退开关（生产默认关） */}
      {demoMode && (
        <Card icon={<SlidersHorizontal className="w-4 h-4" />} title="演示模式">
          <ToggleRow
            label="后端离线时展示演示数据"
            hint="关闭时离线显示错误/空状态，不展示假数据（生产环境保持关闭）"
            checked={s.allowDemoFallback}
            onChange={s.setAllowDemoFallback}
          />
        </Card>
      )}

      {/* Material Sources */}
      {materialSources && (
        <Card icon={<FolderOpen className="w-4 h-4" />} title="素材源">
          {matSources.length === 0 && !matLoading && (
            <p className="text-label-sm text-on-surface-variant">暂无注册素材源。启动后端后将自动发现可用源（如 Pexels、本地素材库）。</p>
          )}
          {matLoading && <p className="text-label-sm text-on-surface-variant">加载中…</p>}
          {matSources.map((src) => (
            <div key={src.id} className="flex items-center justify-between bg-surface rounded-cw-xs px-3 py-2 border border-outline-variant/20">
              <span className="text-body-sm text-on-surface">{src.name}</span>
              <span className="font-mono text-caption text-on-surface-variant">{src.id}</span>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={loadMatSources} disabled={matLoading}>
            <RefreshCw className={`w-3.5 h-3.5 ${matLoading ? 'animate-spin' : ''}`} /> 刷新素材源
          </Button>
        </Card>
      )}

      {/* C4: 快捷键自定义 */}
      {keybindings && (
        <Card icon={<Keyboard className="w-4 h-4" />} title="快捷键自定义">
          <p className="text-caption text-on-surface-variant">
            点击某个快捷键开始录制新组合键；Esc 取消，Delete/Backspace 恢复默认。
          </p>
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {bindings.length === 0 && (
              <p className="text-caption text-on-surface-variant/60 text-center py-3">暂无已注册的快捷键（打开编辑器后刷新）</p>
            )}
            {bindings.map((b) => {
              const effective = keybindingEngine.effectiveCombo(b);
              const isCustom = effective !== b.combo;
              const recording = recordingId === b.id;
              return (
                <div key={b.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-cw-sm bg-surface-container border border-outline-variant/20">
                  <span className="text-caption text-on-surface-variant w-20 shrink-0 truncate">{b.category}</span>
                  <span className="text-body-sm text-on-surface flex-1 truncate">{b.label}</span>
                  {recording ? (
                    <span className="text-label-sm text-primary animate-pulse">按下新组合键…</span>
                  ) : (
                    <button onClick={() => startRecord(b.id)}
                      className={`px-2 py-0.5 rounded-cw-xs text-label-sm font-mono transition-colors cursor-pointer ${
                        isCustom ? 'text-primary bg-primary/10' : 'text-on-surface-variant bg-surface-container-high hover:text-on-surface'
                      }`}
                      title={isCustom ? `已自定义（默认 ${comboKeyLabel(b.combo)}）· 点击修改` : '点击修改'}
                    >
                      {comboKeyLabel(effective)}
                    </button>
                  )}
                  {isCustom && !recording && (
                    <button onClick={() => kb.resetCombo(b.id)}
                      className="p-1 rounded-cw-xs text-caption text-on-surface-variant/50 hover:text-error transition-colors cursor-pointer"
                      title="恢复默认">
                      ⟲
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {bindings.length > 0 && (
            <div className="flex justify-end pt-1">
              <button onClick={() => kb.resetAll()}
                className="px-3 py-1 rounded-cw-xs text-label-sm text-error hover:bg-error/10 transition-colors cursor-pointer">
                全部恢复默认
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface-container border border-outline-variant/30 rounded-cw-md overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-outline-variant/20 text-on-surface-variant">
        {icon}
        <h2 className="text-title-sm font-medium text-on-surface">{title}</h2>
      </header>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-label font-medium text-on-surface-variant mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export function ToggleRow({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-body-sm text-on-surface">{label}</p>
        {hint && <p className="text-label-sm text-on-surface-variant">{hint}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative w-11 h-6 rounded-cw-full shrink-0 transition-colors duration-short3 cursor-pointer ${
          checked ? 'bg-primary' : 'bg-outline-variant'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-short3 ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-cw-sm bg-surface-container">
      <p className="font-mono text-title-sm text-on-surface">{value}</p>
      <p className="text-caption text-on-surface-variant">{label}</p>
    </div>
  );
}

/** C4: 把 KeyboardEvent.key 归一化为 combo 键名（与 KeybindingEngine.parseCombo 对齐）。 */
export function normalizeCaptureKey(key: string): string {
  const k = key.toLowerCase();
  const map: Record<string, string> = {
    ' ': 'space', esc: 'escape', 'delete': 'delete', backspace: 'backspace',
    arrowup: 'arrowup', arrowdown: 'arrowdown', arrowleft: 'arrowleft', arrowright: 'arrowright',
    enter: 'enter', tab: 'tab', home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown',
  };
  const mapped = map[k] ?? k;
  // 单字符（字母/数字/标点）或功能键 F1-F24
  if (/^[a-z0-9.,/;'[\]\\`=-]$/.test(mapped)) return mapped;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(mapped)) return mapped;
  if (['space', 'escape', 'delete', 'backspace', 'enter', 'tab', 'home', 'end', 'pageup', 'pagedown',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(mapped)) return mapped;
  return '';
}

/** C4: 快捷键速查（组合键展示）。 */
export function comboKeyLabel(combo: string): string {
  return combo.split('+').map((p) => {
    const map: Record<string, string> = {
      ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', space: '␣',
      arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
      escape: 'Esc', delete: 'Del', backspace: '⌫', enter: 'Enter', tab: 'Tab',
    };
    return map[p] ?? p.toUpperCase();
  }).join(' + ');
}
