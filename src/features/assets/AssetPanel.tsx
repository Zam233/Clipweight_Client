import { useState, useCallback } from 'react';
import { useAssetStore } from '@/stores/assetStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { assetApi } from '@/services/api';
import { Button, Badge } from '@/components/ui';
import { uid } from '@/lib/utils';
import type { Asset } from '@/types/api';
import type { ClipKind } from '@/types/timeline';
import { Sparkles, FolderOpen, History, Upload, Search, Plus } from 'lucide-react';

type Tab = 'ai' | 'library' | 'history';

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: 'ai', label: 'AI 匹配', icon: Sparkles },
  { id: 'library', label: '素材库', icon: FolderOpen },
  { id: 'history', label: '历史', icon: History },
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
  const [searchQuery, setSearchQuery] = useState('');

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const list = await assetApi.list();
      setAssets(Array.isArray(list) ? list : []);
    } catch {
      // Backend offline — show demo assets so the editor remains usable
      setAssets(demoAssets());
    } finally {
      setLoading(false);
    }
  }, [setAssets, setLoading]);

  // Load on mount
  useState(() => { loadAssets(); });

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    try {
      for (const file of Array.from(files)) {
        await assetApi.upload(file, setUploadProgress);
      }
      await loadAssets();
    } catch {
      // Offline: create local placeholder assets
      const newAssets: Asset[] = Array.from(files).map((f) => ({
        id: uid('asset'),
        filename: f.name,
        path: f.name,
        kind: f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : 'image',
        tags: ['本地上传'],
        created_at: new Date().toISOString(),
      }));
      setAssets([...newAssets, ...useAssetStore.getState().assets]);
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  const addToTimeline = (asset: Asset) => {
    const store = useTimelineStore.getState();
    const kind: ClipKind = asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'audio' : 'image';
    // Find or create a matching track
    let track = store.timeline.tracks.find((t) => t.kind === kind);
    if (!track) {
      const tid = store.addTrack(kind);
      track = store.timeline.tracks.find((t) => t.id === tid);
    }
    if (!track) return;
    // Append after last clip on that track
    const lastEnd = track.clips.reduce((m, c) => Math.max(m, c.start_sec + c.duration_sec), 0);
    store.addClip(track.id, {
      kind,
      asset_id: asset.filename,
      start_sec: lastEnd,
      duration_sec: asset.duration_sec ?? 5,
      metadata: { title: asset.filename },
    });
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {activeTab === 'ai' && <AIMatchView />}

        {(activeTab === 'library' || activeTab === 'history') && (
          <>
            {isLoading ? (
              <LoadingGrid />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(activeTab === 'library' ? filtered : history).map((asset) => (
                  <AssetCard key={asset.id} asset={asset} onAdd={() => addToTimeline(asset)} />
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

function AssetCard({ asset, onAdd }: { asset: Asset; onAdd: () => void }) {
  const kindColor = asset.kind === 'video' ? '#4F8CFF' : asset.kind === 'audio' ? '#34D399' : '#A855F7';
  return (
    <div
      onDoubleClick={onAdd}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/asset-id', asset.id)}
      className="group bg-surface-container rounded-cw-sm overflow-hidden border border-outline-variant/20
        hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-short3 cursor-grab active:cursor-grabbing"
      title="双击或拖拽到时间轴"
    >
      {/* Thumbnail placeholder */}
      <div
        className="relative h-16 flex items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${kindColor}22, ${kindColor}0D)` }}
      >
        <span className="text-2xl" style={{ color: kindColor }}>
          {asset.kind === 'video' ? '🎬' : asset.kind === 'audio' ? '🎵' : '🖼'}
        </span>
        {asset.duration_sec && (
          <span className="absolute bottom-1 right-1 text-caption font-mono bg-black/60 text-white px-1 rounded-cw-xs">
            {asset.duration_sec.toFixed(1)}s
          </span>
        )}
        {/* Hover add button */}
        <button
          onClick={onAdd}
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-short3 cursor-pointer"
        >
          <span className="w-7 h-7 rounded-cw-full bg-primary text-on-primary flex items-center justify-center">
            <Plus className="w-4 h-4" />
          </span>
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
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds);
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="w-12 h-12 rounded-cw-full bg-primary-container flex items-center justify-center mb-3">
        <Sparkles className="w-6 h-6 text-on-primary-container" />
      </div>
      <p className="text-body-sm text-on-surface font-medium mb-1">AI 素材匹配</p>
      <p className="text-label-sm text-on-surface-variant leading-relaxed">
        {selectedClipIds.length > 0
          ? '已选中片段。Agent 将根据上下文推荐风格匹配的候选素材。'
          : '在时间轴上选中一个片段或空白区域，Agent 将推荐语义匹配的素材。'}
      </p>
      <Button size="sm" variant="outline" className="mt-3">
        <Sparkles className="w-3.5 h-3.5" />
        请求推荐
      </Button>
    </div>
  );
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
