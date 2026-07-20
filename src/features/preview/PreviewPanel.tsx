import { useEffect, useRef } from 'react';
import { useTimelineStore } from '@/stores/timelineStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { TRACK_COLORS } from '@/types/timeline';
import type { Clip, Track } from '@/types/timeline';
import { formatTimecode, clamp } from '@/lib/utils';
import { Maximize, Shield, Volume2, VolumeX } from 'lucide-react';
import { Tooltip } from '@/components/ui';

/**
 * PreviewPanel — Canvas compositor that renders the timeline at the playhead.
 * Drives playback via requestAnimationFrame and syncs duration with the timeline.
 */
export function PreviewPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const timeline = useTimelineStore((s) => s.timeline);
  const currentTimeSec = usePreviewStore((s) => s.currentTimeSec);
  const isPlaying = usePreviewStore((s) => s.isPlaying);
  const showSafeArea = usePreviewStore((s) => s.showSafeArea);
  const isMuted = usePreviewStore((s) => s.isMuted);
  const toggleMute = usePreviewStore((s) => s.toggleMute);
  const toggleSafeArea = usePreviewStore((s) => s.toggleSafeArea);
  const setFullscreen = usePreviewStore((s) => s.setFullscreen);

  // Sync duration from timeline
  useEffect(() => {
    usePreviewStore.getState().setDuration(timeline.duration_sec);
    usePreviewStore.getState().setFps(timeline.fps);
  }, [timeline.duration_sec, timeline.fps]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const st = usePreviewStore.getState();
      let next = st.currentTimeSec + dt;
      const dur = useTimelineStore.getState().timeline.duration_sec;
      if (next >= dur) {
        next = dur;
        st.setPlaying(false);
      }
      st.setCurrentTime(next);
      if (usePreviewStore.getState().isPlaying) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // Composite render
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const tl = useTimelineStore.getState().timeline;
      const t = usePreviewStore.getState().currentTimeSec;

      // Letterbox background
      ctx.fillStyle = '#08090F';
      ctx.fillRect(0, 0, W, H);

      // Fit video frame into panel (16:9 by default)
      const aspect = tl.width / tl.height;
      let fw = W - 32;
      let fh = fw / aspect;
      if (fh > H - 32) {
        fh = H - 32;
        fw = fh * aspect;
      }
      const fx = (W - fw) / 2;
      const fy = (H - fh) / 2;

      // Frame background
      ctx.fillStyle = '#0E101A';
      ctx.fillRect(fx, fy, fw, fh);

      // Composite visible clips (bottom track first = higher index drawn first? )
      // Render order: draw tracks from last (bottom) to first (top) so top tracks overlay.
      const sorted = [...tl.tracks].sort((a, b) => b.index - a.index);
      for (const track of sorted) {
        if (track.muted && (track.kind === 'audio' || track.kind === 'waveform')) continue;
        for (const clip of track.clips) {
          if (t < clip.start_sec || t >= clip.start_sec + clip.duration_sec) continue;
          drawClipToPreview(ctx, clip, track, fx, fy, fw, fh, t);
        }
      }

      // Empty frame hint
      if (tl.tracks.length === 0) {
        ctx.fillStyle = '#46464F';
        ctx.font = "400 13px 'Inter','Noto Sans SC',sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('预览窗口 — 添加素材后在此实时预览', W / 2, H / 2);
        ctx.textAlign = 'left';
      }

      // Safe area overlay
      if (showSafeArea) {
        ctx.strokeStyle = 'rgba(255,68,68,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        // Action safe (90%)
        ctx.strokeRect(fx + fw * 0.05, fy + fh * 0.05, fw * 0.9, fh * 0.9);
        // Title safe (80%)
        ctx.strokeStyle = 'rgba(0,229,255,0.5)';
        ctx.strokeRect(fx + fw * 0.1, fy + fh * 0.1, fw * 0.8, fh * 0.8);
        ctx.setLineDash([]);
      }

      // Frame border
      ctx.strokeStyle = 'rgba(141,141,153,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [currentTimeSec, timeline, showSafeArea]);

  return (
    <div className="flex flex-col h-full bg-surface-dim">
      {/* Preview header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-outline-variant/30 shrink-0">
        <span className="text-label font-medium text-on-surface-variant uppercase tracking-wide">
          节目监视器
        </span>
        <div className="flex items-center gap-1">
          <Tooltip content={isMuted ? '取消静音' : '静音'}>
            <button onClick={toggleMute}
              className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </Tooltip>
          <Tooltip content="安全框">
            <button onClick={toggleSafeArea}
              className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${showSafeArea ? 'text-snap-guide bg-snap-guide/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
              <Shield className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="全屏">
            <button onClick={() => { setFullscreen(true); wrapRef.current?.requestFullscreen?.(); }}
              className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
              <Maximize className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Canvas viewport */}
      <div ref={wrapRef} className="flex-1 relative overflow-hidden min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0 block" />
      </div>

      {/* Resolution / info bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-outline-variant/30 text-caption text-on-surface-variant font-mono shrink-0">
        <span>{timeline.width}×{timeline.height} · {timeline.fps}fps</span>
        <span>{formatTimecode(currentTimeSec, timeline.fps)}</span>
      </div>
    </div>
  );
}

/** Draw a single clip into the preview frame (placeholder compositing). */
function drawClipToPreview(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  track: Track,
  fx: number, fy: number, fw: number, fh: number,
  t: number,
) {
  const localT = (t - clip.start_sec) / clip.duration_sec; // 0-1
  const color = TRACK_COLORS[track.kind] ?? '#4F8CFF';

  // Apply keyframe interpolation for opacity/scale if present
  let opacity = clip.opacity;
  let scale = 1;
  if (clip.keyframes.length > 0) {
    const props = interpolateKeyframes(clip.keyframes, localT);
    opacity = props.opacity ?? opacity;
    scale = props.scale ?? scale;
  }

  ctx.save();
  ctx.globalAlpha = clamp(opacity, 0, 1);

  switch (track.kind) {
    case 'video':
    case 'image': {
      // Placeholder gradient block representing media
      const g = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
      g.addColorStop(0, shadeColor(color, -0.5));
      g.addColorStop(0.5, shadeColor(color, -0.2));
      g.addColorStop(1, shadeColor(color, -0.6));
      ctx.fillStyle = g;
      ctx.fillRect(fx, fy, fw, fh);
      // Moving sheen to suggest motion
      const sheenX = fx + ((localT * 2) % 1.4 - 0.2) * fw;
      const sg = ctx.createLinearGradient(sheenX - 80, 0, sheenX + 80, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(fx, fy, fw, fh);
      // Clip label
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = "500 14px 'Inter','Noto Sans SC',sans-serif";
      ctx.textBaseline = 'top';
      ctx.fillText(clip.asset_id || track.kind, fx + 16, fy + 14);
      break;
    }
    case 'text':
    case 'caption': {
      const text = clip.text || '文字';
      const fontSize = (clip.font_size ?? 48) * (fh / 1080) * scale;
      ctx.font = `600 ${fontSize}px 'Noto Sans SC','PingFang SC',sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = clip.font_color || '#FFFFFF';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 8;
      const ty = track.kind === 'caption' ? fy + fh * 0.85 : fy + fh / 2;
      ctx.fillText(text, fx + fw / 2, ty, fw * 0.9);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
      break;
    }
    case 'animation': {
      // Animated shape placeholder
      const cx = fx + fw / 2;
      const cy = fy + fh / 2;
      const r = (fh * 0.15) * scale * (0.8 + 0.2 * Math.sin(localT * Math.PI * 2));
      ctx.fillStyle = color;
      ctx.globalAlpha = clamp(opacity, 0, 1) * 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'shape': {
      ctx.fillStyle = clip.fill || color;
      ctx.fillRect(fx + fw * 0.3, fy + fh * 0.3, fw * 0.4, fh * 0.4);
      break;
    }
    default:
      break; // audio etc. not drawn to video frame
  }

  ctx.restore();
}

/** Linear keyframe interpolation at progress (0-1). */
function interpolateKeyframes(
  keyframes: Clip['keyframes'],
  progress: number,
): Record<string, number> {
  if (keyframes.length === 0) return {};
  if (keyframes.length === 1) return { ...keyframes[0].properties };
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (progress <= sorted[0].time) return { ...sorted[0].properties };
  if (progress >= sorted[sorted.length - 1].time) return { ...sorted[sorted.length - 1].properties };
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].time <= progress) lo = mid; else hi = mid;
  }
  const prev = sorted[lo], next = sorted[hi];
  const seg = next.time - prev.time;
  const lt = seg > 0 ? (progress - prev.time) / seg : 0;
  const result: Record<string, number> = {};
  const keys = new Set([...Object.keys(prev.properties), ...Object.keys(next.properties)]);
  for (const k of keys) {
    const a = prev.properties[k] ?? next.properties[k] ?? 0;
    const b = next.properties[k] ?? prev.properties[k] ?? 0;
    result[k] = a + (b - a) * lt;
  }
  return result;
}

function shadeColor(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = (v: number) => clamp(Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
