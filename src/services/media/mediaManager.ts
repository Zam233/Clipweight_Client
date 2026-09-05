/**
 * MediaManager — real media playback, thumbnails and waveform extraction.
 *
 * Bridges uploaded Files (object URLs) and backend-hosted assets (proxy URLs)
 * into HTMLVideoElement / HTMLAudioElement / WebAudio analysis. Falls back
 * gracefully when no real media is available (demo assets).
 */

import type { Timeline, Clip } from '@/types/timeline';
import { session } from '@/services/api/session';

/**
 * V5: <video>/<img> 无法携带 Authorization 头——by-path 代理 URL 附带
 * query token（后端中间件已兼容并在日志前抹除；无 token 时原样返回）。
 */
export function withMediaToken(url: string): string {
  const token = session.token;
  if (!token || !url.includes('/api/asset/by-path')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

/** Resolve a clip's real-media URL for preview playback. */
export function resolveMediaUrl(clip: Pick<Clip, 'metadata' | 'asset_id'>): string | undefined {
  const meta = clip.metadata ?? {};
  const rawUrl = typeof meta.url === 'string' ? meta.url : '';
  // 优先使用 HTTP URL（Agent 时间线可直接预览）；否则把本地路径/asset_id 包装成 by-path 代理
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  const localPath = typeof meta.local_path === 'string' ? meta.local_path : '';
  const path = localPath || clip.asset_id;
  if (!path) return undefined;
  return withMediaToken(`/api/asset/by-path?path=${encodeURIComponent(path)}`);
}

interface MediaEntry {
  url: string;
  kind: 'video' | 'audio' | 'image';
  videoEl?: HTMLVideoElement;
  audioEl?: HTMLAudioElement;
  img?: HTMLImageElement;
  /** V7: 缩略图专用隐藏 video 元素——不 seek 预览元素，避免播放中跳帧闪烁 */
  thumbVideoEl?: HTMLVideoElement;
  durationSec: number;
  waveform?: number[];
  thumbnails: Map<number, string>;
  /** W16: 缩略图 LRU 访问顺序（bucket 时间戳 → 最近访问序），超限时淘汰最久未用的 */
  thumbLru: number[];
  /** true when url is a blob: object URL that must be revoked on unregister */
  isObjectUrl?: boolean;
  /** true when the media element fired an error event (404 / network) — keeps url for retry */
  error?: boolean;
}

/** W16: 单素材缩略图缓存上限（数据 URL 可能很大，防内存无界增长）。 */
const MAX_THUMBNAILS_PER_ENTRY = 24;

class MediaManager {
  private entries = new Map<string, MediaEntry>();
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserSource: MediaElementAudioSourceNode | null = null;
  private sourceNodes = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

  /** Register an uploaded File so its real media becomes available. */
  registerFile(assetId: string, file: File): void {
    const url = URL.createObjectURL(file);
    const kind: MediaEntry['kind'] = file.type.startsWith('video')
      ? 'video'
      : file.type.startsWith('audio')
        ? 'audio'
        : 'image';
    const entry: MediaEntry = { url, kind, durationSec: 0, thumbnails: new Map(), thumbLru: [], isObjectUrl: true };

    if (kind === 'video') {
      const v = document.createElement('video');
      v.src = url;
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      v.addEventListener('loadedmetadata', () => {
        entry.durationSec = v.duration;
        this.notify(assetId);
      });
      v.addEventListener('error', () => {
        entry.error = true;
        this.notify(assetId);
      });
      entry.videoEl = v;
    } else if (kind === 'audio') {
      const a = new Audio();
      a.src = url;
      a.preload = 'auto';
      a.addEventListener('loadedmetadata', () => {
        entry.durationSec = a.duration;
        this.notify(assetId);
      });
      a.addEventListener('error', () => {
        entry.error = true;
        this.notify(assetId);
      });
      entry.audioEl = a;
    } else {
      // image: probe dimensions via an Image
      const img = new Image();
      img.crossOrigin = 'anonymous'; // no-op for same-origin blob URLs, but required for canvas reads later
      img.src = url;
      img.onload = () => this.notify(assetId);
      img.onerror = () => {
        entry.error = true;
        this.notify(assetId);
      };
      entry.img = img;
    }

    this.entries.set(assetId, entry);
  }

  /** Register a backend-hosted asset by proxy URL. */
  registerUrl(assetId: string, url: string, kind: MediaEntry['kind']): void {
    if (this.entries.has(assetId)) return;
    const entry: MediaEntry = { url, kind, durationSec: 0, thumbnails: new Map(), thumbLru: [] };
    if (kind === 'video') {
      const v = document.createElement('video');
      v.src = url;
      v.preload = 'metadata';
      v.muted = true;
      v.crossOrigin = 'anonymous';
      v.addEventListener('loadedmetadata', () => { entry.durationSec = v.duration; this.notify(assetId); });
      v.addEventListener('error', () => {
        entry.error = true;
        this.notify(assetId);
      });
      entry.videoEl = v;
    } else if (kind === 'audio') {
      const a = new Audio();
      a.src = url;
      a.preload = 'metadata';
      a.crossOrigin = 'anonymous';
      a.addEventListener('loadedmetadata', () => { entry.durationSec = a.duration; this.notify(assetId); });
      a.addEventListener('error', () => {
        entry.error = true;
        this.notify(assetId);
      });
      entry.audioEl = a;
    } else if (kind === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // must precede src assignment so the fetch uses CORS mode
      img.src = url;
      img.onload = () => this.notify(assetId);
      img.onerror = () => {
        entry.error = true;
        this.notify(assetId);
      };
      entry.img = img;
    }
    this.entries.set(assetId, entry);
  }

  /**
   * registerTimeline — 把时间线上所有媒体片段（video/audio/image）注册为真实媒体。
   *
   * 幂等：已注册且 URL 未变的 asset_id 跳过；URL 变化（如代理切换/代理生成）
   * 时刷新媒体元素（V6）；无法解析 URL 的片段静默跳过（预览回退占位块）。
   * blob: 对象 URL（本地上传）不参与刷新。
   */
  registerTimeline(timeline: Timeline): void {
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.kind !== 'video' && clip.kind !== 'audio' && clip.kind !== 'image') continue;
        const url = resolveMediaUrl(clip);
        if (!url) continue;
        const existing = this.entries.get(clip.asset_id);
        if (existing) {
          if (existing.isObjectUrl || existing.url === url) continue;
          // V6: URL 变了（代理切换）——先卸载旧元素再按新 URL 重注册
          this.unregister(clip.asset_id);
        }
        this.registerUrl(clip.asset_id, url, clip.kind);
      }
    }
  }

  get(assetId: string): MediaEntry | undefined {
    return this.entries.get(assetId);
  }

  /** Unregister an asset and release its resources (object URL, media elements, caches). */
  unregister(assetId: string): void {
    const e = this.entries.get(assetId);
    if (!e) return;
    if (e.videoEl) {
      e.videoEl.pause();
      e.videoEl.removeAttribute('src');
      e.videoEl.load();
    }
    if (e.audioEl) {
      e.audioEl.pause();
      e.audioEl.removeAttribute('src');
      e.audioEl.load();
    }
    this.releaseThumbVideo(e); // V7
    e.thumbnails.clear();
    if (e.isObjectUrl) URL.revokeObjectURL(e.url);
    this.entries.delete(assetId);
    this.notify(assetId);
  }

  /** Release all registered assets (e.g. on project switch / editor unmount). */
  clear(): void {
    for (const id of [...this.entries.keys()]) this.unregister(id);
  }

  /** Pause all playing media elements without releasing them. */
  pauseAll(): void {
    for (const e of this.entries.values()) {
      if (e.videoEl && !e.videoEl.paused) e.videoEl.pause();
      if (e.audioEl && !e.audioEl.paused) e.audioEl.pause();
    }
  }

  /**
   * V9: 预缓冲——把播放头临近片段的 preload 升到 auto（默认 metadata 只取
   * 元数据，跨片段边界时无缓冲导致占位闪白）。仅处理暂停中的元素（load()
   * 会重置播放位置），幂等可高频调用。
   */
  prebuffer(assetIds: string[]): void {
    for (const id of assetIds) {
      const e = this.entries.get(id);
      const el = e?.videoEl;
      if (!el || el.preload === 'auto') continue;
      if (!el.paused) continue;
      el.preload = 'auto';
      try { el.load(); } catch { /* detached src */ }
    }
  }

  hasRealMedia(assetId: string): boolean {
    const e = this.entries.get(assetId);
    return !!e && (e.kind !== 'image' ? !!e.videoEl || !!e.audioEl : true);
  }

  getDuration(assetId: string): number {
    return this.entries.get(assetId)?.durationSec ?? 0;
  }

  getMediaUrl(assetId: string): string | undefined {
    return this.entries.get(assetId)?.url;
  }

  /** Seek a video asset to a time and return the element (for canvas drawing). */
  seekVideo(assetId: string, timeSec: number): HTMLVideoElement | undefined {
    const e = this.entries.get(assetId);
    if (!e?.videoEl) return undefined;
    const v = e.videoEl;
    const target = Math.max(0, Math.min(timeSec, (e.durationSec || timeSec) - 0.01));
    if (Math.abs(v.currentTime - target) > 0.03) {
      try { v.currentTime = target; } catch { /* not ready */ }
    }
    return v;
  }

  /** Capture a thumbnail frame as a dataURL (cached per time bucket). */
  async captureThumbnail(assetId: string, timeSec = 0.1, width = 160): Promise<string | null> {
    const e = this.entries.get(assetId);
    if (!e) return null;

    if (e.kind === 'image') return e.url;

    const bucket = Math.round(timeSec * 2) / 2;
    const cached = e.thumbnails.get(bucket);
    if (cached) {
      // W16: 命中即标记最近使用
      this.touchThumb(e, bucket);
      return cached;
    }

    // V7: 缩略图改用独立隐藏 video 元素——原实现直接 seek 预览共享的
    // videoEl，播放中抓帧导致预览跳帧闪烁
    if (e.kind === 'video' && e.url) {
      const tv = this.ensureThumbVideo(e);
      if (!tv) return null;
      return new Promise((resolve) => {
        const grab = () => {
          try {
            const c = document.createElement('canvas');
            const scale = width / (tv.videoWidth || width);
            c.width = width;
            c.height = Math.round((tv.videoHeight || 90) * scale);
            const ctx = c.getContext('2d')!;
            ctx.drawImage(tv, 0, 0, c.width, c.height);
            const dataUrl = c.toDataURL('image/jpeg', 0.7);
            e.thumbnails.set(bucket, dataUrl);
            this.touchThumb(e, bucket);
            resolve(dataUrl);
          } catch {
            resolve(null);
          }
        };
        if (tv.readyState >= 2) {
          tv.currentTime = Math.min(bucket, (e.durationSec || bucket) - 0.05);
          tv.addEventListener('seeked', grab, { once: true });
        } else {
          tv.addEventListener('loadeddata', () => {
            tv.currentTime = Math.min(bucket, (e.durationSec || bucket) - 0.05);
            tv.addEventListener('seeked', grab, { once: true });
          }, { once: true });
        }
      });
    }
    return null;
  }

  /** V7: 懒创建缩略图专用隐藏 video 元素（跟随 entry 生命周期）。 */
  private ensureThumbVideo(e: MediaEntry): HTMLVideoElement | null {
    if (e.thumbVideoEl) return e.thumbVideoEl;
    try {
      const tv = document.createElement('video');
      tv.src = e.url;
      tv.preload = 'auto';
      tv.muted = true;
      tv.crossOrigin = 'anonymous';
      tv.playsInline = true;
      e.thumbVideoEl = tv;
      return tv;
    } catch {
      return null;
    }
  }

  /** V7: 释放缩略图专用元素。 */
  private releaseThumbVideo(e: MediaEntry): void {
    if (!e.thumbVideoEl) return;
    e.thumbVideoEl.pause();
    e.thumbVideoEl.removeAttribute('src');
    e.thumbVideoEl.load();
    e.thumbVideoEl = undefined;
  }

  /**
   * W16: 标记缩略图最近使用并执行 LRU 淘汰。
   * 超过 MAX_THUMBNAILS_PER_ENTRY 时删除最久未用的 bucket，防止缓存无界增长。
   */
  private touchThumb(e: MediaEntry, bucket: number): void {
    e.thumbLru = e.thumbLru.filter((b) => b !== bucket);
    e.thumbLru.push(bucket);
    while (e.thumbLru.length > MAX_THUMBNAILS_PER_ENTRY) {
      const oldest = e.thumbLru.shift();
      if (oldest !== undefined) e.thumbnails.delete(oldest);
    }
  }

  /** Extract waveform peaks (0-1) via WebAudio decodeAudioData. Cached. */
  async getWaveform(assetId: string, buckets = 120): Promise<number[] | null> {
    const e = this.entries.get(assetId);
    if (!e) return null;
    if (e.waveform && e.waveform.length === buckets) return e.waveform;

    const srcEl = e.audioEl ?? e.videoEl;
    if (!srcEl) return null;

    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      // P0-10/P3-3B: 波形提取走裸 fetch——补 Authorization 头（动态导入避免 node 测试环境加载 DOM 依赖的 store）
      const { useSettingsStore } = await import('@/stores/settingsStore');
      const { session } = await import('@/services/api/session');
      const token = useSettingsStore.getState().authToken || session.token;
      const resp = await fetch(e.url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const buf = await resp.arrayBuffer();
      const audioBuf = await this.audioCtx.decodeAudioData(buf);
      const data = audioBuf.getChannelData(0);
      const block = Math.floor(data.length / buckets) || 1;
      const peaks: number[] = [];
      for (let i = 0; i < buckets; i++) {
        let max = 0;
        const start = i * block;
        for (let j = start; j < start + block && j < data.length; j += 8) {
          const v = Math.abs(data[j]);
          if (v > max) max = v;
        }
        peaks.push(Math.min(1, max));
      }
      e.waveform = peaks;
      return peaks;
    } catch {
      return null;
    }
  }

  /** Synchronous read of cached waveform peaks (null if not yet decoded). */
  getCachedWaveform(assetId: string): number[] | null {
    return this.entries.get(assetId)?.waveform ?? null;
  }

  /** Synchronous read of a cached thumbnail at a time bucket (dataURL or null). */
  getCachedThumbnailAt(assetId: string, timeSec: number): string | null {
    const e = this.entries.get(assetId);
    if (!e) return null;
    if (e.kind === 'image') return e.url;
    const bucket = Math.round(timeSec * 2) / 2;
    return e.thumbnails.get(bucket) ?? null;
  }

  /** Fire-and-forget: ensure a thumbnail capture has been kicked off. */
  ensureThumbnail(assetId: string, timeSec: number): void {
    const e = this.entries.get(assetId);
    if (!e || e.kind !== 'video') return;
    const bucket = Math.round(timeSec * 2) / 2;
    if (e.thumbnails.has(bucket)) return;
    e.thumbnails.set(bucket, ''); // in-flight marker
    this.captureThumbnail(assetId, bucket).then((url) => {
      if (!url) e.thumbnails.delete(bucket);
      this.notify(assetId);
    });
  }

  /** Fire-and-forget: ensure waveform decoding has been kicked off. */
  ensureWaveform(assetId: string, buckets = 120): void {
    const e = this.entries.get(assetId);
    if (!e || e.waveform) return;
    if (e.kind === 'audio' || e.kind === 'video') {
      // mark as in-flight by storing an empty array to avoid duplicate kicks
      e.waveform = [];
      this.getWaveform(assetId, buckets).then((peaks) => {
        if (!peaks) e.waveform = undefined;
        this.notify(assetId);
      });
    }
  }

  // ── simple change notification ───────────────────────
  private listeners = new Set<(assetId: string) => void>();
  onChange(cb: (assetId: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private notify(assetId: string) {
    this.listeners.forEach((cb) => cb(assetId));
  }

  // ── audio level metering ─────────────────────────────
  private ensureAudioCtx(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return this.audioCtx;
  }

  /** Attach analyser to an audio-capable media entry for level metering. */
  attachAnalyser(assetId: string): AnalyserNode | null {
    const e = this.entries.get(assetId);
    if (!e || (e.kind !== 'audio' && e.kind !== 'video')) return null;
    const el = e.audioEl ?? e.videoEl;
    if (!el) return null;
    const ctx = this.ensureAudioCtx();
    // 浏览器可能以 suspended 状态创建 AudioContext（非用户手势路径），静默无声；
    // 播放已由用户点击触发，此时尝试恢复
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.connect(ctx.destination);
    }
    let src = this.sourceNodes.get(el);
    if (!src) {
      src = ctx.createMediaElementSource(el);
      this.sourceNodes.set(el, src);
      // V1 修复: 每个 MediaElementSource 创建后永久连接到 analyser，
      // 多个 source 可同时输入（BGM+配音同响），不再断开上一个 source。
      try { src.connect(this.analyser); } catch { /* already connected */ }
    }
    return this.analyser;
  }

  /** Get current audio levels (0-1) — simplified peak detection. */
  getAudioLevels(): [number, number] {
    if (!this.analyser) return [0, 0];
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let leftMax = 0;
    let rightMax = 0;
    for (let i = 0; i < data.length; i += 2) {
      const v = Math.abs(data[i] / 128 - 1);
      if (v > leftMax) leftMax = v;
    }
    for (let i = 1; i < data.length; i += 2) {
      const v = Math.abs(data[i] / 128 - 1);
      if (v > rightMax) rightMax = v;
    }
    return [Math.min(1, leftMax), Math.min(1, rightMax)];
  }
}

export const mediaManager = new MediaManager();
