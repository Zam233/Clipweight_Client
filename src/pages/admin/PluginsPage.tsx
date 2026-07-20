import { useEffect, useState } from 'react';
import { ConsoleShell, ConsoleHeading, StatusPill } from './ConsoleShell';
import { pluginApi } from '@/services/api';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Puzzle, Power, Loader2, RefreshCw, Zap } from 'lucide-react';

interface PluginItem {
  id: string;
  name: string;
  description?: string;
  version?: string;
  loaded: boolean;
}

/**
 * PluginsPage — the module rack. Each plugin is a rack unit with a power
 * toggle (load/unload) and a status LED.
 */
export function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await pluginApi.discover();
      setPlugins(normalize(list));
    } catch {
      setPlugins(DEMO_PLUGINS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (p: PluginItem) => {
    setBusyId(p.id);
    try {
      if (p.loaded) await pluginApi.unload(p.id);
      else await pluginApi.load(p.id);
    } catch { /* offline: flip locally */ }
    setPlugins((ps) => ps.map((x) => (x.id === p.id ? { ...x, loaded: !x.loaded } : x)));
    setBusyId(null);
  };

  const loadAll = async () => {
    setLoadingAll(true);
    try { await pluginApi.loadAll(); } catch { /* offline */ }
    setPlugins((ps) => ps.map((x) => ({ ...x, loaded: true })));
    setLoadingAll(false);
  };

  const loadedCount = plugins.filter((p) => p.loaded).length;

  return (
    <ConsoleShell>
      <ConsoleHeading kicker="Extensions / Plugins" title="插件管理"
        desc="类型插件决定不同视频品类的剪辑逻辑。加载后 Agent 管线即可调用对应能力。" />

      {/* rack summary strip */}
      <div className="flex items-center gap-4 mb-6 bg-surface-container border border-outline-variant/30 rounded-cw-md px-5 py-3.5">
        <span className="w-10 h-10 rounded-cw-sm bg-primary-container flex items-center justify-center">
          <Puzzle className="w-5 h-5 text-on-primary-container" />
        </span>
        <div className="flex-1">
          <p className="text-body-sm font-semibold text-on-surface">插件机架</p>
          <p className="font-mono text-caption text-on-surface-variant">{loadedCount}/{plugins.length} LOADED</p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> 刷新
        </Button>
        <Button size="sm" onClick={loadAll} disabled={loadingAll}>
          {loadingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />} 全部加载
        </Button>
      </div>

      {/* rack units */}
      <div className="space-y-2.5 max-w-[820px]">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-surface-container rounded-cw-md animate-pulse" />)
        ) : (
          plugins.map((p, i) => (
            <div key={p.id}
              className={cn('relative flex items-center gap-4 bg-surface-container border rounded-cw-md px-5 py-4 overflow-hidden transition-all duration-short3 group hover:-translate-y-0.5',
                p.loaded ? 'border-track-audio/35 hover:shadow-lg hover:shadow-track-audio/5' : 'border-outline-variant/30 opacity-80')}
              style={{ animationDelay: `${i * 40}ms` }}>
              {/* status LED rail */}
              <span className={cn('absolute left-0 top-0 bottom-0 w-1 transition-colors duration-medium2',
                p.loaded ? 'bg-track-audio' : 'bg-outline-variant/40')} />

              <span className={cn('w-10 h-10 rounded-cw-sm flex items-center justify-center shrink-0 transition-colors',
                p.loaded ? 'bg-track-audio/15 text-track-audio' : 'bg-surface-container-high text-on-surface-variant')}>
                <Puzzle className="w-5 h-5" />
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <p className="font-mono text-body-sm font-semibold text-on-surface truncate">{p.id}</p>
                  {p.version && <span className="font-mono text-caption text-on-surface-variant shrink-0">v{p.version}</span>}
                </div>
                {p.description && <p className="text-caption text-on-surface-variant truncate mt-0.5">{p.description}</p>}
              </div>

              <StatusPill ok={p.loaded} label={p.loaded ? 'ACTIVE' : 'OFF'} />

              {/* power toggle */}
              <button onClick={() => toggle(p)} disabled={busyId === p.id}
                className={cn('relative w-12 h-[26px] rounded-cw-full transition-colors duration-short3 cursor-pointer shrink-0',
                  p.loaded ? 'bg-track-audio' : 'bg-outline-variant/50')}
                title={p.loaded ? '卸载' : '加载'}>
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
    </ConsoleShell>
  );
}

function normalize(data: unknown): PluginItem[] {
  if (Array.isArray(data)) {
    return data.map((d) => {
      const o = (typeof d === 'string' ? { id: d } : d) as Record<string, unknown>;
      return {
        id: String(o.id ?? o.name ?? 'plugin'),
        name: String(o.name ?? o.id ?? 'plugin'),
        description: o.description ? String(o.description) : undefined,
        version: o.version ? String(o.version) : undefined,
        loaded: Boolean(o.loaded ?? true),
      };
    });
  }
  return [];
}

const DEMO_PLUGINS: PluginItem[] = [
  { id: 'knowledge_longform', name: '知识区长片', description: '5-15s 镜头 · 硬切为主 · 关键词标注动画', version: '1.2.0', loaded: true },
  { id: 'kichiku_fastcut', name: '鬼畜快剪', description: '0.3-2s 镜头 · 闪白/Jump Cut · 极高动画密度', version: '1.0.3', loaded: true },
  { id: 'digital_review', name: '数码评测', description: '3-8s 镜头 · 缓入缓出 · 数据图表动画', version: '1.1.0', loaded: false },
  { id: 'vlog_daily', name: 'Vlog 日常', description: '3-10s 镜头 · 混合转场 · 字幕为主', version: '0.9.5', loaded: false },
  { id: 'llm_mg', name: 'LLM MG 动画', description: 'LLM 驱动的动态 MG 动画生成', version: '0.5.0', loaded: false },
];
