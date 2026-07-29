import { useEffect, useRef } from 'react';
import { useTimelineStore } from '@/stores/timelineStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { TRACK_COLORS } from '@/types/timeline';
import type { Clip, Track } from '@/types/timeline';
import { formatTimecode, clamp } from '@/lib/utils';
import { mediaManager } from '@/services/media/mediaManager';
import { interpolateProperties } from '@/features/timeline/engine/easing';
import { Maximize, Shield, Volume2, VolumeX, ZoomIn, ZoomOut, Camera, Repeat } from 'lucide-react';
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
  const zoomLevel = usePreviewStore((s) => s.zoomLevel);
  const setZoomLevel = usePreviewStore((s) => s.setZoomLevel);
  const playbackSpeed = usePreviewStore((s) => s.playbackSpeed);
  const setPlaybackSpeed = usePreviewStore((s) => s.setPlaybackSpeed);
  const isLooping = usePreviewStore((s) => s.isLooping);
  const toggleLoop = usePreviewStore((s) => s.toggleLoop);

  // Sync duration from timeline
  useEffect(() => {
    usePreviewStore.getState().setDuration(timeline.duration_sec);
    usePreviewStore.getState().setFps(timeline.fps);
  }, [timeline.duration_sec, timeline.fps]);

  // Audio sync: play/pause/seek audio clips' media elements with the playhead.
  // 播放期间节流至 ~10fps，避免每帧遍历全部 clip（seek 阈值本身为 0.25s）
  const lastAudioSyncRef = useRef(0);
  const audioStateRef = useRef({ playing: false, muted: false, tl: timeline as unknown });
  useEffect(() => {
    const prev = audioStateRef.current;
    const stateChanged = prev.playing !== isPlaying || prev.muted !== isMuted;
    audioStateRef.current = { playing: isPlaying, muted: isMuted, tl: timeline };
    const now = performance.now();
    if (!stateChanged && now - lastAudioSyncRef.current < 100) return;
    lastAudioSyncRef.current = now;

    const t = currentTimeSec;
    const playing = isPlaying;
    const muted = isMuted;
    for (const track of timeline.tracks) {
      if (track.kind !== 'audio' && track.kind !== 'waveform') continue;
      for (const clip of track.clips) {
        const entry = mediaManager.get(clip.asset_id);
        const el = entry?.audioEl ?? entry?.videoEl;
        if (!el) continue;
        const inClip = t >= clip.start_sec && t < clip.start_sec + clip.duration_sec;
        const localT = t - clip.start_sec + clip.source_offset_sec;
        el.volume = clamp(clip.volume, 0, 1);
        el.muted = muted || track.muted;
          if (inClip && playing) {
          if (Math.abs(el.currentTime - localT) > 0.25) { try { el.currentTime = localT; } catch { /* seek not available */ } }
          if (el.paused) {
            mediaManager.attachAnalyser(clip.asset_id);
            el.play().catch(() => {});
          }
        } else {
          if (!el.paused) el.pause();
        }
      }
    }
  }, [currentTimeSec, isPlaying, isMuted, timeline]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const st = usePreviewStore.getState();
      const speed = st.shuttleSpeed !== 0 ? st.shuttleSpeed * Math.abs(st.playbackSpeed) : st.playbackSpeed;
      let next = st.currentTimeSec + dt * speed;
      const dur = useTimelineStore.getState().timeline.duration_sec;
      const region = st.loopRegion;
      const looping = st.isLooping;

      if (looping && region) {
        if (next >= region.end) next = region.start;
        if (next < region.start) next = region.end;
      } else if (next >= dur) {
        next = dur;
        st.setPlaying(false);
      } else if (next < 0) {
        next = 0;
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

  // Composite render — 持久 RAF 循环 + 单次 ResizeObserver。
  // 不依赖 currentTimeSec，避免播放期间每帧重建 observer；仅在状态变化时重绘。
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let lastW = 0;
    let lastH = 0;
    const last = { t: -1, tl: null as unknown, safe: false, zoom: -1 };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      if (W !== lastW || H !== lastH) {
        lastW = W;
        lastH = H;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const pst = usePreviewStore.getState();
      const tl = useTimelineStore.getState().timeline;
      const t = pst.currentTimeSec;
      const showSafe = pst.showSafeArea;

      // Letterbox background
      ctx.fillStyle = '#08090F';
      ctx.fillRect(0, 0, W, H);

      // Fit video frame into panel (16:9 by default), scaled by preview zoom
      const zoom = pst.zoomLevel;
      const aspect = tl.height > 0 ? tl.width / tl.height : 16 / 9;
      let fw = (W - 32) * zoom;
      let fh = fw / aspect;
      if (fh > (H - 32) * zoom) {
        fh = (H - 32) * zoom;
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
          if (clip.enabled === false) continue;
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
      if (showSafe) {
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

    const loop = () => {
      const pst = usePreviewStore.getState();
      const tl = useTimelineStore.getState().timeline;
      const t = pst.currentTimeSec;
      const safe = pst.showSafeArea;
      const zoom = pst.zoomLevel;
      if (t !== last.t || tl !== last.tl || safe !== last.safe || zoom !== last.zoom) {
        last.t = t;
        last.tl = tl;
        last.safe = safe;
        last.zoom = zoom;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    draw();
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-dim">
      {/* Preview header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-outline-variant/30 shrink-0">
        <span className="text-label font-medium text-on-surface-variant uppercase tracking-wide">
          节目监视器
        </span>
        <div className="flex items-center gap-1">
          {/* preview zoom */}
          <Tooltip content="缩小预览">
            <button onClick={() => setZoomLevel(Math.max(0.25, zoomLevel - 0.25))}
              className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <button onClick={() => setZoomLevel(1)} title="重置为 100%"
            className="px-1.5 py-0.5 rounded-cw-xs font-mono text-caption text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer min-w-[42px] text-center">
            {Math.round(zoomLevel * 100)}%
          </button>
          <Tooltip content="放大预览">
            <button onClick={() => setZoomLevel(Math.min(4, zoomLevel + 0.25))}
              className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <div className="w-px h-4 bg-outline-variant/40 mx-0.5" />
          <Tooltip content="播放速度">
            <button onClick={() => {
              const speeds = [0.5, 1, 1.5, 2];
              const idx = speeds.indexOf(playbackSpeed);
              const next = speeds[(idx === -1 ? 0 : idx + 1) % speeds.length];
              setPlaybackSpeed(next);
            }}
              className="px-1.5 py-0.5 rounded-cw-xs font-mono text-caption text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer min-w-[38px] text-center">
              {playbackSpeed}×
            </button>
          </Tooltip>
          <Tooltip content={isLooping ? '关闭循环 (/)' : '开启循环 (/)'}>
            <button onClick={toggleLoop}
              className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${isLooping ? 'text-track-video bg-track-video/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
              <Repeat className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <div className="w-px h-4 bg-outline-variant/40 mx-0.5" />
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
          <Tooltip content="导出当前帧 (PNG)">
            <button onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const link = document.createElement('a');
              link.download = `frame_${Math.floor(currentTimeSec * 1000)}.png`;
              link.href = canvas.toDataURL('image/png');
              link.click();
            }}
              className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
              <Camera className="w-3.5 h-3.5" />
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
        <div className="flex items-center gap-2">
          <span>{timeline.width}×{timeline.height} · {timeline.fps}fps</span>
          <AudioLevelMeter />
        </div>
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

  // Apply keyframe interpolation for opacity/transform if present
  let opacity = clip.opacity;
  const tf: Transform2D = { ...getClipTransform(clip) };
  if (clip.keyframes.length > 0) {
    const props = interpolateProperties(clip.keyframes, localT);
    opacity = props.opacity ?? opacity;
    tf.scale = props.scale ?? tf.scale;
    tf.x = props.position_x ?? tf.x;
    tf.y = props.position_y ?? tf.y;
    tf.rotation = props.rotation ?? tf.rotation;
  }

  ctx.save();
  ctx.globalAlpha = clamp(opacity, 0, 1);
  if (clip.blend_mode && clip.blend_mode !== 'normal') {
    (ctx as CanvasRenderingContext2D).globalCompositeOperation = clip.blend_mode as GlobalCompositeOperation;
  }

  const fxStr = buildFilter(clip);
  if (fxStr) {
    ctx.filter = fxStr;
  }

  switch (track.kind) {
    case 'video':
    case 'image': {
      // Try real media first (uploaded video/image)
      const entry = mediaManager.get(clip.asset_id);
      const videoEl = entry?.videoEl;
      let drewReal = false;

      if (track.kind === 'image' && entry?.url) {
        // Real image: draw via cached Image
        const img = getImageCached(entry.url);
        if (img && img.complete && img.naturalWidth > 0) {
          drawCover(ctx, img, fx, fy, fw, fh, tf);
          drewReal = true;
        }
      } else if (videoEl && videoEl.readyState >= 2) {
        // Real video frame: seek to clip-local time and draw
        const sourceT = (t - clip.start_sec) * clip.speed + clip.source_offset_sec;
        mediaManager.seekVideo(clip.asset_id, sourceT);
        drawCover(ctx, videoEl, fx, fy, fw, fh, tf);
        drewReal = true;
      }

      if (!drewReal) {
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
        const label = (clip.metadata?.title as string) || clip.asset_id || track.kind;
        ctx.fillText(label, fx + 16, fy + 14);
      }
      break;
    }
    case 'text':
    case 'caption': {
      const text = clip.text || '文字';
      const fontSize = (clip.font_size ?? 48) * (fh / 1080) * tf.scale;
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
      const r = (fh * 0.15) * tf.scale * (0.8 + 0.2 * Math.sin(localT * Math.PI * 2));
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

export interface Transform2D {
  /** Position offset from frame center, normalized (-1..1 of frame size) */
  x: number;
  y: number;
  scale: number;
  /** Rotation in degrees */
  rotation: number;
}

export const IDENTITY_TRANSFORM: Transform2D = { x: 0, y: 0, scale: 1, rotation: 0 };

/** Read a clip's base transform from metadata (static edit) — keyframes animate on top. */
export function getClipTransform(clip: Clip): Transform2D {
  const t = (clip.metadata?.transform ?? {}) as Partial<Transform2D>;
  return {
    x: t.x ?? 0,
    y: t.y ?? 0,
    scale: t.scale ?? 1,
    rotation: t.rotation ?? 0,
  };
}

/**
 * Draw an image/video source covering the frame rect (object-fit: cover),
 * applying position offset, scale and rotation about the frame center.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  src: HTMLVideoElement | HTMLImageElement,
  fx: number, fy: number, fw: number, fh: number,
  tf: Transform2D,
) {
  const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLImageElement).naturalWidth;
  const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLImageElement).naturalHeight;
  if (!sw || !sh) return;
  // cover fit
  const srcAspect = sw / sh;
  const dstAspect = fw / fh;
  let cw = sw, ch = sh, cx = 0, cy = 0;
  if (srcAspect > dstAspect) {
    cw = sh * dstAspect;
    cx = (sw - cw) / 2;
  } else {
    ch = sw / dstAspect;
    cy = (sh - ch) / 2;
  }

  // Apply transform about the frame center
  const centerX = fx + fw / 2;
  const centerY = fy + fh / 2;
  const scale = tf.scale;
  const dw = fw * scale, dh = fh * scale;

  ctx.save();
  ctx.translate(centerX + tf.x * fw, centerY + tf.y * fh);
  if (tf.rotation !== 0) ctx.rotate((tf.rotation * Math.PI) / 180);
  try {
    ctx.drawImage(src, cx, cy, cw, ch, -dw / 2, -dh / 2, dw, dh);
  } catch { /* frame not ready */ }
  ctx.restore();
}

/** Image cache with LRU eviction (prevents unbounded memory growth). */
const IMAGE_CACHE_MAX = 64;
const imageCache = new Map<string, HTMLImageElement>();
function getImageCached(url: string): HTMLImageElement | undefined {
  let img = imageCache.get(url);
  if (img) {
    // refresh LRU order
    imageCache.delete(url);
    imageCache.set(url, img);
    return img;
  }
  img = new Image();
  img.src = url;
  imageCache.set(url, img);
  if (imageCache.size > IMAGE_CACHE_MAX) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  return img;
}

function buildFilter(clip: Clip): string {
  const parts: string[] = [];
  if (clip.fx_brightness != null && clip.fx_brightness !== 1) parts.push(`brightness(${clip.fx_brightness})`);
  if (clip.fx_contrast != null && clip.fx_contrast !== 1) parts.push(`contrast(${clip.fx_contrast})`);
  if (clip.fx_saturation != null && clip.fx_saturation !== 1) parts.push(`saturate(${clip.fx_saturation})`);
  if (clip.fx_blur != null && clip.fx_blur > 0) parts.push(`blur(${clip.fx_blur}px)`);
  if (clip.fx_hue != null && clip.fx_hue !== 0) parts.push(`hue-rotate(${clip.fx_hue}deg)`);
  return parts.join(' ');
}

function shadeColor(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = (v: number) => clamp(Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

import { useEffect as useEffect2, useRef as useRef2 } from 'react';

function AudioLevelMeter() {
  const canvasRef = useRef2<HTMLCanvasElement>(null);
  const rafRef = useRef2(0);

  useEffect2(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = () => {
      const [left, right] = mediaManager.getAudioLevels();
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = '#1a1a24';
      ctx.fillRect(0, 0, w, h);

      // Left channel (upper half)
      const lw = Math.round(left * (w - 2));
      ctx.fillStyle = left > 0.9 ? '#ef4444' : left > 0.6 ? '#f59e0b' : '#34D399';
      ctx.fillRect(1, 1, lw, h / 2 - 2);

      // Right channel (lower half)
      const rw = Math.round(right * (w - 2));
      ctx.fillStyle = right > 0.9 ? '#ef4444' : right > 0.6 ? '#f59e0b' : '#34D399';
      ctx.fillRect(1, h / 2 + 1, rw, h / 2 - 2);

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={80}
      height={16}
      className="rounded-cw-xs border border-outline-variant/20"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
