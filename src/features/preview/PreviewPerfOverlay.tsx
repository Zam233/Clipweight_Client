import { usePreviewPerfStore } from './perf';
import { useSettingsStore } from '@/stores/settingsStore';

function ms(value: number): string {
  return `${value.toFixed(2)} ms`;
}

function bytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${value} B`;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-caption text-on-surface-variant/70">{label}</span>
      <span className="text-caption font-mono text-on-surface">
        {value}
        {hint && <span className="text-on-surface-variant/50"> {hint}</span>}
      </span>
    </div>
  );
}

/**
 * 预览性能诊断面板（O6）。
 *
 * 读数来自 `previewPerf`（每帧采样 + 250ms 节流推送），全部本地计算、不上报。
 * 拖动播放头时应重点看：`总耗时` 越低越好、`缓存命中率` 越高越好，
 * 以及 `绘制帧率` 是否接近显示器刷新率。
 */
export function PreviewPerfOverlay() {
  const enabled = useSettingsStore((s) => s.showPerfPanel);
  const snapshot = usePreviewPerfStore((s) => s.snapshot);
  if (!enabled) return null;

  const { cache } = snapshot;
  const resolveShare = snapshot.avgTotalMs > 0
    ? Math.round((snapshot.avgResolveMs / snapshot.avgTotalMs) * 100)
    : 0;

  return (
    <div
      data-testid="preview-perf-overlay"
      className="absolute left-2 top-2 z-30 w-[228px] rounded-cw-md border border-outline-variant/40
        bg-surface-dim/85 backdrop-blur px-2.5 py-2 space-y-0.5 pointer-events-none"
    >
      <div className="flex items-center justify-between pb-0.5">
        <span className="text-caption font-medium text-on-surface uppercase tracking-wide">预览性能</span>
        <span className="text-caption font-mono text-on-surface-variant/60">
          {snapshot.frames} 帧采样
        </span>
      </div>
      <Row label="总耗时" value={ms(snapshot.avgTotalMs)} hint={`p95 ${snapshot.p95TotalMs.toFixed(1)}`} />
      <Row label="素材解析" value={ms(snapshot.avgResolveMs)} hint={`${resolveShare}%`} />
      <Row label="绘制合成" value={ms(snapshot.avgCompositeMs)} />
      <Row label="绘制帧率" value={`${snapshot.fps.toFixed(0)} fps`} hint={`${snapshot.avgLayers.toFixed(1)} 层/帧`} />
      <div className="pt-1 mt-1 border-t border-outline-variant/30 space-y-0.5">
        <Row label="缓存命中率" value={`${(cache.hitRate * 100).toFixed(0)}%`}
             hint={`${cache.hits}/${cache.hits + cache.misses}`} />
        <Row label="缓存层数" value={`${cache.entries}`} hint={`淘汰 ${cache.evictions} · ${bytes(cache.approxBytes)}`} />
      </div>
    </div>
  );
}
