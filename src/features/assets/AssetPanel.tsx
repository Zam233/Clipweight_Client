import { useState, useCallback, useEffect } from 'react';
import { useAssetStore } from '@/stores/assetStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHistoryStore } from '@/stores/historyStore';
import { usePreviewStore } from '@/stores/previewStore';
import { assetApi, getApiClient } from '@/services/api';
import { mediaManager } from '@/services/media/mediaManager';
import { Button, Badge } from '@/components/ui';
import { uid } from '@/lib/utils';
import { DubView } from './DubView';
import { PluginPanel } from './PluginPanel';
import type { Asset, MaterialSearchResult } from '@/types/api';
import type { ClipKind } from '@/types/timeline';
import { Sparkles, FolderOpen, History, Upload, Search, Plus, Mic, AudioLines, Puzzle } from 'lucide-react';

type Tab = 'ai' | 'library' | 'history' | 'dub' | 'plugins';

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: 'ai', label: 'AI 匹配', icon: Sparkles },
  { id: 'library', label: '素材库', icon: FolderOpen },
  { id: 'history', label: '历史', icon: History },
  { id: 'dub', label: '配音', icon: Mic },
  { id: 'plugins', label: '插件', icon: Puzzle },
];

/**
 * AssetPanel — three-tab asset browser (AI match / library / history).
 * Supports double-click or drag to add assets to the timeline.
 */
export function AssetPanel() {
  const activeTab = useAssetStore((s) => s.activeTab);
  const setActiveTab = useAssetStore((s) => s.setActiveTab);
  const assets = useAssetStore((s) => s.assets);
  const setAssets = useAssetStore((s) => s.setAssets);
  const history = useAssetStore((s) => s.history);
  const isLoading = useAssetStore((s) => s.isLoading);
  const setLoading = useAssetStore((s) => s.setLoading);
  const uploadProgress = useAssetStore((s) => s.uploadProgress);
  const setUploadProgress = useAssetStore((s) => s.setUploadProgress);
  const [loadError, setLoadError] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setDemoMode(false);
    try {
      const list = await assetApi.list();
      setAssets(Array.isArray(list) ? list : []);
    } catch {
      setAssets(demoAssets());
      setDemoMode(true);
    } finally {
      setLoading(false);
    }
  }, [setAssets, setLoading]);

  // Load on mount
  useEffect(() => { loadAssets(); }, [loadAssets]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    try {
      for (const file of Array.from(files)) {
        await assetApi.upload(file, setUploadProgress);
      }
      await loadAssets();
    } catch {
      // Offline: create local assets backed by real object URLs (playable media)
      const newAssets: Asset[] = Array.from(files).map((f) => {
        const id = uid('asset');
        const kind = f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : 'image';
        // Register real media so preview/thumbnails/waveforms work
        mediaManager.registerFile(id, f);
        return {
          id,
          filename: f.name,
          path: f.name,
          kind,
          tags: ['本地上传'],
          created_at: new Date().toISOString(),
        };
      });
      setAssets([...newAssets, ...useAssetStore.getState().assets]);
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  const addToTimeline = (asset: Asset, opts?: { ripple?: boolean }) => {
    const store = useTimelineStore.getState();
    const kind: ClipKind = asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'audio' : 'image';
    // Find or create a matching track
    let track = store.timeline.tracks.find((t) => t.kind === kind);
    if (!track) {
      const tid = store.addTrack(kind);
      track = useTimelineStore.getState().timeline.tracks.find((t) => t.id === tid);
    }
    if (!track) return;
    // Prefer real media duration when available
    const realDur = mediaManager.getDuration(asset.id);
    const duration = realDur > 0 ? realDur : (asset.duration_sec ?? 5);
    const clipData = { kind, asset_id: asset.id, duration_sec: duration, metadata: { title: asset.filename } };

    useHistoryStore.getState().pushState(store.timeline, 'add-asset');
    if (opts?.ripple) {
      // Ripple insert at playhead: shift later clips right
      const atSec = usePreviewStore.getState().currentTimeSec;
      store.rippleInsert(track.id, clipData, atSec);
    } else {
      // Append after last clip on that track
      const lastEnd = track.clips.reduce((m, c) => Math.max(m, c.start_sec + c.duration_sec), 0);
      store.addClip(track.id, { ...clipData, start_sec: lastEnd });
    }
    useAssetStore.getState().addToHistory(asset);
  };

  const filtered = assets.filter((a) =>
    a.filename.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="flex flex-col h-full bg-surface-container-low">
      {/* Tab bar */}
      <div className="flex border-b border-outline-variant/30 shrink-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-label font-medium
              border-b-2 transition-colors duration-short3 cursor-pointer ${
                activeTab === id
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Search + upload */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/20 shrink-0">
        <div className="flex-1 flex items-center gap-2 bg-surface-container rounded-cw-sm px-2.5 py-1.5">
          <Search className="w-3.5 h-3.5 text-on-surface-variant shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索素材…"
            className="flex-1 bg-transparent outline-none text-body-sm text-on-surface placeholder:text-on-surface-variant/50"
          />
        </div>
        <label className="p-2 rounded-cw-sm bg-primary-container text-on-primary-container hover:opacity-90 transition-opacity cursor-pointer">
          <Upload className="w-3.5 h-3.5" />
          <input type="file" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} />
        </label>
      </div>

      {/* Upload progress */}
      {uploadProgress !== null && (
        <div className="px-3 py-1.5 shrink-0">
          <div className="h-1 bg-surface-container rounded-cw-full overflow-hidden">
            <div className="h-full bg-primary transition-all duration-medium2" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {(demoMode || loadError) && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-warning/10 border-b border-outline-variant/20 shrink-0">
          <span className="text-caption text-warning flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            {demoMode ? '演示数据' : '加载失败'}
          </span>
          <button
            onClick={loadAssets}
            className="text-caption text-primary hover:text-primary/80 cursor-pointer"
          >
            重试
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {activeTab === 'ai' && <AIMatchView />}

        {activeTab === 'dub' && <DubView />}

        {activeTab === 'plugins' && <PluginPanel />}

        {(activeTab === 'library' || activeTab === 'history') && (
          <>
            {isLoading ? (
              <LoadingGrid />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(activeTab === 'library' ? filtered : history).map((asset) => (
                  <AssetCard key={asset.id} asset={asset}
                    onAdd={(opts) => addToTimeline(asset, opts)} />
                ))}
              </div>
            )}
            {!isLoading && (activeTab === 'library' ? filtered : history).length === 0 && (
              <EmptyAssets onUpload={() => document.querySelector<HTMLInputElement>('input[type=file]')?.click()} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function AssetCard({ asset, onAdd }: { asset: Asset; onAdd: (opts?: { ripple?: boolean }) => void }) {
  const kindColor = asset.kind === 'video' ? '#4F8CFF' : asset.kind === 'audio' ? '#34D399' : '#A855F7';
  const [thumb, setThumb] = useState<string | null>(null);
  const [realDur, setRealDur] = useState(0);

  // Load real thumbnail + duration when media becomes available
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const t = await mediaManager.captureThumbnail(asset.id, 0.1);
      if (alive) setThumb(t);
    };
    if (mediaManager.hasRealMedia(asset.id)) {
      load();
      const un = mediaManager.onChange((id) => {
        if (id === asset.id) {
          if (alive) setRealDur(mediaManager.getDuration(asset.id));
          load();
        }
      });
      return () => { alive = false; un(); };
    }
    const un = mediaManager.onChange((id) => { if (id === asset.id) load(); });
    return () => { alive = false; un(); };
  }, [asset.id]);

  const dur = realDur || asset.duration_sec;

  return (
    <div
      onDoubleClick={(e) => onAdd({ ripple: e.shiftKey })}
      draggable
      onDragStart={(e) => {
        const payload = JSON.stringify({
          id: asset.id, kind: asset.kind, filename: asset.filename, duration: dur ?? 5,
        });
        e.dataTransfer.setData('application/x-clipwright-asset', payload);
        e.dataTransfer.setData('text/plain', payload);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className="group bg-surface-container rounded-cw-sm overflow-hidden border border-outline-variant/20
        hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-short3 cursor-grab active:cursor-grabbing"
      title="双击添加到时间轴 · Shift+双击在播放头处波纹插入 · 拖拽到时间轴"
    >
      {/* Thumbnail */}
      <div
        className="relative h-16 flex items-center justify-center overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${kindColor}22, ${kindColor}0D)` }}
      >
        {thumb ? (
          <img src={thumb} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <span className="text-2xl" style={{ color: kindColor }}>
            {asset.kind === 'video' ? '🎬' : asset.kind === 'audio' ? '🎵' : '🖼'}
          </span>
        )}
        {dur != null && dur > 0 && (
          <span className="absolute bottom-1 right-1 text-caption font-mono bg-black/60 text-white px-1 rounded-cw-xs">
            {dur.toFixed(1)}s
          </span>
        )}
        {/* Hover overlay (visual only, no pointer events — preserves drag from thumbnail) */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-short3 pointer-events-none" />
        {/* Add button (small badge, pointer-events-auto) — Shift+click = ripple insert at playhead */}
        <button
          onClick={(e) => onAdd({ ripple: e.shiftKey })}
          className="absolute bottom-1 left-1 w-7 h-7 rounded-cw-full bg-primary text-on-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-short3 pointer-events-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="px-2 py-1.5">
        <p className="text-label-sm text-on-surface truncate">{asset.filename}</p>
        <p className="text-caption text-on-surface-variant capitalize">{asset.kind}</p>
      </div>
    </div>
  );
}

function AIMatchView() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MaterialSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [selSources, setSelSources] = useState<string[]>([]);
  const [visionOpen, setVisionOpen] = useState(false);
  const [visionPath, setVisionPath] = useState('');
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionResult, setVisionResult] = useState<string | null>(null);

  useEffect(() => { assetApi.listSources().then(setSources).catch(() => {}); }, []);

  const doSearch = async (q: string) => {
    const queryText = q.trim() || '通用 B-roll 空镜';
    setSearching(true);
    setSearched(true);
    try {
      const res = await assetApi.searchMaterials({ query: queryText, limit: 12 });
      setResults(Array.isArray(res) ? res : []);
    } catch {
      setResults(demoMatches(queryText));
    } finally { setSearching(false); }
  };

  const doVisionImport = async () => {
    if (!visionPath.trim()) return;
    setVisionLoading(true);
    setVisionResult(null);
    try {
      const analyzeRes = await getApiClient().post('/api/vision/analyze', { image_path: visionPath.trim() });
      const ad = analyzeRes.data;
      const labels = ad.tags?.join(', ') || ad.description || JSON.stringify(ad).slice(0, 200);
      setVisionResult(`分析结果: ${labels}`);
      await getApiClient().post('/api/vision/import', { image_path: visionPath.trim() });
      setVisionResult((prev) => `${prev} — 已导入素材库`);
      assetApi.listSources().then(setSources).catch(() => {});
    } catch (e: unknown) {
      setVisionResult(`失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally { setVisionLoading(false); }
  };

  const addResult = (r: MaterialSearchResult) => {
    const store = useTimelineStore.getState();
    let track = store.timeline.tracks.find((t) => t.kind === 'video');
    if (!track) {
      const tid = store.addTrack('video');
      track = useTimelineStore.getState().timeline.tracks.find((t) => t.id === tid);
    }
    if (!track) return;
    const lastEnd = track.clips.reduce((m, c) => Math.max(m, c.start_sec + c.duration_sec), 0);
    useHistoryStore.getState().pushState(store.timeline, 'ai-match');
    store.addClip(track.id, {
      kind: 'video', asset_id: r.id, start_sec: lastEnd,
      duration_sec: r.duration_sec ?? 5, metadata: { title: r.title, source: r.source },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1.5 px-1 pb-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch(query)}
          placeholder="描述想要的画面，如「城市夜景延时」…"
          className="flex-1 bg-surface-container rounded-cw-sm px-2.5 py-1.5 text-body-sm text-on-surface
            outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/40" />
        <button onClick={() => doSearch(query)} disabled={searching}
          className="px-2.5 rounded-cw-sm bg-primary-container text-on-primary-container hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer">
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </div>

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1 pb-2 px-1">
          {sources.map((s) => {
            const sel = selSources.includes(s.id);
            return (
              <button key={s.id} onClick={() => setSelSources(sel ? selSources.filter((x) => x !== s.id) : [...selSources, s.id])}
                className={`px-1.5 py-0.5 rounded-cw-full text-caption border transition-colors cursor-pointer ${
                  sel ? 'bg-track-video/15 border-track-video/60 text-track-video' : 'bg-surface-container-high border-outline-variant/40 text-on-surface-variant/70 hover:text-on-surface'
                }`}>
                {s.name}
              </button>
            );
          })}
          <button onClick={() => setVisionOpen(!visionOpen)}
            className="px-1.5 py-0.5 rounded-cw-full text-caption border border-outline-variant/40 bg-surface-container-high
              text-on-surface-variant/70 hover:text-tertiary hover:border-tertiary/40 transition-colors cursor-pointer">
            视觉识别
          </button>
        </div>
      )}

      {visionOpen && (
        <div className="px-1 pb-2 border border-outline-variant/20 rounded-cw-sm p-2 mb-2 bg-surface-container">
          <p className="text-caption text-on-surface-variant mb-1.5">视觉识别：输入图片路径，AI 分析后自动入库</p>
          <div className="flex gap-1.5 mb-1.5">
            <input value={visionPath} onChange={(e) => setVisionPath(e.target.value)}
              placeholder="图片路径…" className="flex-1 bg-surface rounded-cw-xs px-2 py-1 text-label-sm text-on-surface outline-none border border-outline-variant/30 focus:border-primary" />
            <Button size="sm" onClick={doVisionImport} disabled={visionLoading || !visionPath.trim()}>
              {visionLoading ? '分析中…' : '导入'}
            </Button>
          </div>
          {visionResult && <p className="text-caption text-on-surface-variant leading-relaxed">{visionResult}</p>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {searching && (
          <div className="flex items-center gap-2 text-label-sm text-on-surface-variant py-4 justify-center">
            <span className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            语义检索中…
          </div>
        )}
        {!searching && results.map((r) => (
          <button key={r.id} onClick={() => addResult(r)}
            draggable
            onDragStart={(e) => {
              const payload = JSON.stringify({
                id: r.id, kind: 'video', filename: r.title, duration: r.duration_sec ?? 5,
              });
              e.dataTransfer.setData('application/x-clipwright-asset', payload);
              e.dataTransfer.setData('text/plain', payload);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            className="w-full flex items-center gap-2.5 bg-surface-container border border-outline-variant/20 rounded-cw-sm px-2.5 py-2
              hover:border-primary/50 hover:bg-surface transition-all duration-short3 cursor-pointer group text-left">
            {r.thumbnail ? (
              <span className="w-10 h-10 rounded-cw-xs bg-surface overflow-hidden shrink-0">
                <img src={r.thumbnail} alt="" className="w-full h-full object-cover" />
              </span>
            ) : (
              <span className="w-9 h-9 rounded-cw-xs bg-track-video/15 text-track-video flex items-center justify-center shrink-0 text-body">🎬</span>
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-label-sm text-on-surface truncate group-hover:text-primary transition-colors">{r.title}</span>
              <span className="flex items-center gap-1.5 text-caption text-on-surface-variant">
                <span className="font-mono text-track-audio">{Math.round(r.score * 100)}%</span>
                <span>· {r.source}</span>
                {r.duration_sec != null && <span>· {r.duration_sec.toFixed(1)}s</span>}
              </span>
              {r.reason && <span className="block text-caption text-on-surface-variant/70 truncate">{r.reason}</span>}
            </span>
            <Plus className="w-3.5 h-3.5 text-on-surface-variant group-hover:text-primary shrink-0" />
          </button>
        ))}
        {!searching && searched && results.length === 0 && (
          <p className="text-label-sm text-on-surface-variant text-center py-6">未找到匹配素材</p>
        )}
        {!searching && !searched && (
          <div className="flex flex-col items-center justify-center py-8 text-center px-2">
            <Sparkles className="w-6 h-6 text-primary/50 mb-2" />
            <p className="text-label-sm text-on-surface-variant leading-relaxed">
              输入画面描述，Agent 将从素材源中语义检索最匹配的候选。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function demoMatches(query: string): MaterialSearchResult[] {
  const base = [
    { title: `${query} · 空镜 01`, score: 0.94, reason: '语义高度匹配，色调偏冷' },
    { title: `${query} · 特写 02`, score: 0.88, reason: '构图与主题相关' },
    { title: '城市延时 · 夜景', score: 0.81, reason: '氛围匹配' },
    { title: '数据可视化 · 图表动画', score: 0.74, reason: '可用于论点支撑' },
    { title: '人物采访 · 中景', score: 0.68, reason: '叙事补充' },
  ];
  return base.map((b, i) => ({
    id: `match_${i}_${Date.now().toString(36)}`, title: b.title, url: '', score: b.score,
    source: 'pexels', duration_sec: 4 + i * 2, reason: b.reason,
  }));
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-surface-container rounded-cw-sm overflow-hidden animate-pulse">
          <div className="h-16 bg-surface-container-high" />
          <div className="px-2 py-1.5 space-y-1">
            <div className="h-2 bg-surface-container-high rounded w-3/4" />
            <div className="h-2 bg-surface-container-high rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyAssets({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <FolderOpen className="w-8 h-8 text-on-surface-variant/40 mb-2" />
      <p className="text-body-sm text-on-surface-variant mb-3">素材库为空</p>
      <Button size="sm" onClick={onUpload}>
        <Upload className="w-3.5 h-3.5" />
        上传素材
      </Button>
    </div>
  );
}

/** Demo assets so the editor is usable without a backend. */
function demoAssets(): Asset[] {
  const mk = (name: string, kind: Asset['kind'], dur?: number): Asset => ({
    id: uid('asset'), filename: name, path: name, kind,
    duration_sec: dur, tags: ['示例'], created_at: new Date().toISOString(),
  });
  return [
    mk('开场镜头.mp4', 'video', 6),
    mk('产品特写.mp4', 'video', 4.5),
    mk('B-roll_城市.mp4', 'video', 8),
    mk('采访片段.mp4', 'video', 12),
    mk('背景音乐.mp3', 'audio', 60),
    mk('旁白配音.wav', 'audio', 45),
    mk('封面图.png', 'image'),
    mk('LOGO.png', 'image'),
  ];
}
