// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { mediaManager, resolveMediaUrl, withMediaToken } from './mediaManager';
import { session } from '@/services/api/session';
import type { Timeline, Clip, Track } from '@/types/timeline';

// jsdom doesn't implement object URL helpers — provide minimal stubs for registerFile tests
beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (file: File) => string }).createObjectURL = (file: File) => `blob:mock:${file.name}`;
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => {};
  }
});

function mkClip(id: string, over: Partial<Clip> = {}): Clip {
  return {
    id, kind: 'video', asset_id: `asset_${id}`, track_id: 'tr',
    start_sec: 0, duration_sec: 5, source_offset_sec: 0,
    speed: 1, volume: 1, opacity: 1, keyframes: [], metadata: {}, ...over,
  };
}

function mkTimeline(clips: Clip[]): Timeline {
  const track: Track = { id: 'tr', name: 'V1', kind: 'video', index: 0, locked: false, muted: false, clips };
  return { id: 'tl', width: 1920, height: 1080, fps: 30, duration_sec: 10, tracks: [track] };
}

describe('mediaManager.registerTimeline', () => {
  beforeEach(() => {
    mediaManager.clear();
  });

  it('registers video/audio/image clips with resolved by-path URL', () => {
    const tl = mkTimeline([
      mkClip('v1', { kind: 'video', asset_id: 'C:\\library\\a.mp4' }),
      mkClip('a1', { kind: 'audio', asset_id: 'C:\\library\\voice.wav' }),
      mkClip('i1', { kind: 'image', asset_id: 'img_1', metadata: { local_path: 'C:\\library\\bg.png' } }),
    ]);
    mediaManager.registerTimeline(tl);

    const v = mediaManager.get('C:\\library\\a.mp4');
    expect(v).toBeDefined();
    expect(v!.kind).toBe('video');
    expect(v!.videoEl).toBeDefined();
    expect(v!.url).toContain('/api/asset/by-path?path=');

    const a = mediaManager.get('C:\\library\\voice.wav');
    expect(a).toBeDefined();
    expect(a!.kind).toBe('audio');
    expect(a!.audioEl).toBeDefined();

    const img = mediaManager.get('img_1');
    expect(img).toBeDefined();
    expect(img!.kind).toBe('image');
    expect(img!.url).toContain('/api/asset/by-path?path=');
  });

  it('prefers http metadata.url over by-path proxy', () => {
    const tl = mkTimeline([mkClip('v1', { metadata: { url: 'http://cdn.example/v.mp4' } })]);
    mediaManager.registerTimeline(tl);
    const e = mediaManager.get('asset_v1')!;
    expect(e.url).toBe('http://cdn.example/v.mp4');
  });

  it('skips text/animation/shape clips', () => {
    const tl = mkTimeline([
      mkClip('t1', { kind: 'text', asset_id: '' }),
      mkClip('an1', { kind: 'animation', asset_id: '' }),
      mkClip('s1', { kind: 'shape', asset_id: '' }),
    ]);
    mediaManager.registerTimeline(tl);
    for (const id of ['asset_t1', 'asset_an1', 'asset_s1']) {
      expect(mediaManager.get(id)).toBeUndefined();
    }
  });

  it('skips clips with no resolvable URL (empty asset_id + no metadata)', () => {
    const tl = mkTimeline([mkClip('v1', { asset_id: '' })]);
    mediaManager.registerTimeline(tl);
    expect(mediaManager.get('asset_v1')).toBeUndefined();
  });

  it('is idempotent across repeated calls', () => {
    const tl = mkTimeline([mkClip('v1', { metadata: { local_path: 'C:\\library\\a.mp4' } })]);
    mediaManager.registerTimeline(tl);
    mediaManager.registerTimeline(tl);
    mediaManager.registerTimeline(tl);
    expect(mediaManager.get('asset_v1')).toBeDefined();
  });
});

describe('resolveMediaUrl', () => {
  afterEach(() => {
    session.setToken(null); // V5: 不向其他用例泄漏 token
  });

  it('returns http url directly', () => {
    expect(resolveMediaUrl({ asset_id: 'x', metadata: { url: 'https://cdn/x.mp4' } })).toBe('https://cdn/x.mp4');
  });

  it('wraps local_path as by-path proxy', () => {
    const url = resolveMediaUrl({ asset_id: 'x', metadata: { local_path: 'C:\\library\\a.mp4' } });
    expect(url).toBe('/api/asset/by-path?path=' + encodeURIComponent('C:\\library\\a.mp4'));
  });

  it('falls back to asset_id when no metadata', () => {
    const url = resolveMediaUrl({ asset_id: 'C:\\media\\a.mp4', metadata: {} });
    expect(url).toBe('/api/asset/by-path?path=' + encodeURIComponent('C:\\media\\a.mp4'));
  });

  it('returns undefined when nothing resolvable', () => {
    expect(resolveMediaUrl({ asset_id: '', metadata: {} })).toBeUndefined();
  });
});

describe('V5 withMediaToken — by-path query token', () => {
  afterEach(() => {
    session.setToken(null);
  });

  it('no token → URL unchanged', () => {
    expect(withMediaToken('/api/asset/by-path?path=a.mp4')).toBe('/api/asset/by-path?path=a.mp4');
  });

  it('token set → appended to by-path URL only (http urls untouched)', () => {
    session.setToken('tok123');
    const u1 = withMediaToken('/api/asset/by-path?path=a.mp4');
    expect(u1).toBe('/api/asset/by-path?path=a.mp4&token=tok123');
    const u2 = withMediaToken('http://cdn.example/v.mp4');
    expect(u2).toBe('http://cdn.example/v.mp4');
  });

  it('resolveMediaUrl honors the session token', () => {
    session.setToken('tok456');
    const url = resolveMediaUrl({ asset_id: 'x', metadata: { local_path: 'C:\\a.mp4' } })!;
    expect(url.endsWith('&token=tok456')).toBe(true);
  });
});

describe('V6 registerTimeline — URL refresh on proxy switch', () => {
  beforeEach(() => {
    mediaManager.clear();
  });

  it('re-registers when the resolved URL changes (same asset_id)', () => {
    const oldClip = mkClip('v1', { metadata: { local_path: 'C:\\lib\\full.mp4' } });
    mediaManager.registerTimeline(mkTimeline([oldClip]));
    const before = mediaManager.get('asset_v1')!;
    expect(before.url).toContain(encodeURIComponent('C:\\lib\\full.mp4'));

    const proxyClip = mkClip('v1', { metadata: { local_path: 'C:\\lib\\full_proxy.mp4' } });
    mediaManager.registerTimeline(mkTimeline([proxyClip]));

    const after = mediaManager.get('asset_v1')!;
    expect(after.url).toContain(encodeURIComponent('C:\\lib\\full_proxy.mp4'));
    expect(after.url).not.toBe(before.url);
  });

  it('object-URL (uploaded file) entries are never refreshed', () => {
    mediaManager.registerFile('asset_v1', new File(['x'], 'upload.mp4', { type: 'video/mp4' }));
    const before = mediaManager.get('asset_v1')!;
    expect(before.isObjectUrl).toBe(true);

    mediaManager.registerTimeline(mkTimeline([mkClip('v1', { metadata: { local_path: 'C:\\lib\\full.mp4' } })]));
    expect(mediaManager.get('asset_v1')!.isObjectUrl).toBe(true);
    expect(mediaManager.get('asset_v1')!.url).toBe(before.url);
  });
});

describe('V7 thumbnails use a dedicated hidden video element', () => {
  beforeEach(() => {
    mediaManager.clear();
  });

  it('captureThumbnail does not seek the shared preview element', async () => {
    mediaManager.registerUrl('asset_v1', 'http://mock.local/v.mp4', 'video');
    const entries = (mediaManager as unknown as { entries: Map<string, { thumbVideoEl?: HTMLVideoElement }> }).entries;
    const entry = mediaManager.get('asset_v1')!;
    let previewSeeks = 0;
    entry.videoEl!.addEventListener('seeked', () => { previewSeeks += 1; });

    // 发起抓帧（不预 await——thumbVideoEl 在调用内懒创建）
    const p = mediaManager.captureThumbnail('asset_v1', 0.5, 80);
    const thumbEl = entries.get('asset_v1')!.thumbVideoEl!;
    expect(thumbEl).toBeDefined();
    expect(thumbEl).not.toBe(entry.videoEl);

    // jsdom 不真正解码媒体——手动驱动事件让 capture 流程走完（resolve(null)）
    Object.defineProperty(thumbEl, 'readyState', { value: 2, configurable: true });
    thumbEl.dispatchEvent(new Event('loadeddata'));
    thumbEl.dispatchEvent(new Event('seeked'));
    await expect(p).resolves.toBeNull();
    // 关键断言：预览共享元素从未被 seek
    expect(previewSeeks).toBe(0);
  });

  it('unregister releases the thumbnail element', () => {
    mediaManager.registerUrl('asset_v1', 'http://mock.local/v.mp4', 'video');
    const entries = (mediaManager as unknown as { entries: Map<string, { thumbVideoEl?: HTMLVideoElement }> }).entries;
    entries.get('asset_v1')!.thumbVideoEl = document.createElement('video');
    mediaManager.unregister('asset_v1');
    expect(entries.get('asset_v1')).toBeUndefined(); // 释放随 entry 一起消失
  });
});

describe('V9 prebuffer', () => {
  beforeEach(() => {
    mediaManager.clear();
  });

  it('upgrades preload to auto on paused, metadata-preloaded video entries', () => {
    mediaManager.registerUrl('asset_v1', 'http://mock.local/v.mp4', 'video');
    const el = mediaManager.get('asset_v1')!.videoEl!;
    expect(el.preload).toBe('metadata');

    mediaManager.prebuffer(['asset_v1', 'unknown_id']);
    expect(el.preload).toBe('auto');
  });

  it('never touches a playing element', () => {
    mediaManager.registerUrl('asset_v1', 'http://mock.local/v.mp4', 'video');
    const el = mediaManager.get('asset_v1')!.videoEl!;
    Object.defineProperty(el, 'paused', { value: false, configurable: true });
    mediaManager.prebuffer(['asset_v1']);
    expect(el.preload).toBe('metadata');
  });
});

describe('V7b setThumbCacheLimit — 每素材缩略图 LRU 上限自适应', () => {
  beforeEach(() => {
    mediaManager.clear();
    mediaManager.setThumbCacheLimit(24); // 复位默认
  });

  it('收紧上限时立即淘汰既有最久未用 bucket', () => {
    mediaManager.registerUrl('asset_v1', 'http://mock.local/v.mp4', 'video');
    const entry = mediaManager.get('asset_v1')!;
    for (const b of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]) {
      entry.thumbnails.set(b, `u${b}`);
      // 直接经 touch 语义维护 LRU 序
      (mediaManager as unknown as { touchThumb: (e: typeof entry, b: number) => void })
        .touchThumb(entry, b);
    }
    mediaManager.setThumbCacheLimit(8); // 下限 8
    expect(entry.thumbLru.length).toBe(8);
    expect(entry.thumbnails.has(0)).toBe(false); // 最久未用被淘汰
    expect(entry.thumbnails.has(4.5)).toBe(true);
  });

  it('放大上限后可继续缓存更多 bucket', () => {
    mediaManager.setThumbCacheLimit(64);
    mediaManager.registerUrl('asset_v1', 'http://mock.local/v.mp4', 'video');
    const touch = (mediaManager as unknown as {
      touchThumb: (e: { thumbLru: number[]; thumbnails: Map<number, string> }, b: number) => void;
    }).touchThumb;
    const entry = mediaManager.get('asset_v1')!;
    for (let i = 0; i < 40; i += 1) {
      entry.thumbnails.set(i * 0.5, 'u');
      touch(entry, i * 0.5);
    }
    expect(entry.thumbLru.length).toBe(40);
  });
});

describe('mediaManager error tracking', () => {
  beforeEach(() => {
    mediaManager.clear();
  });

  it('video (registerUrl): marks entry.error and notifies subscribers on error event', () => {
    const notified: string[] = [];
    const unsub = mediaManager.onChange((id) => notified.push(id));
    try {
      mediaManager.registerUrl('asset_err_video', 'http://cdn.example/404.mp4', 'video');
      const entry = mediaManager.get('asset_err_video')!;
      expect(entry).toBeDefined();
      expect(entry.error).toBeFalsy();

      entry.videoEl!.dispatchEvent(new Event('error'));

      expect(entry.error).toBe(true);
      expect(notified).toContain('asset_err_video');
      // URL kept so a retry remains possible
      expect(mediaManager.get('asset_err_video')!.url).toBe('http://cdn.example/404.mp4');
    } finally {
      unsub();
    }
  });

  it('audio (registerFile): marks entry.error and notifies subscribers on error event', () => {
    const notified: string[] = [];
    const unsub = mediaManager.onChange((id) => notified.push(id));
    try {
      mediaManager.registerFile('asset_err_audio', new File(['x'], 'broken.wav', { type: 'audio/wav' }));
      const entry = mediaManager.get('asset_err_audio')!;
      expect(entry).toBeDefined();
      expect(entry.error).toBeFalsy();

      entry.audioEl!.dispatchEvent(new Event('error'));

      expect(entry.error).toBe(true);
      expect(notified).toContain('asset_err_audio');
    } finally {
      unsub();
    }
  });

  it('happy path: no error event → entry.error stays falsy', () => {
    mediaManager.registerUrl('asset_ok_video', 'http://cdn.example/ok.mp4', 'video');
    mediaManager.registerFile('asset_ok_audio', new File(['x'], 'ok.wav', { type: 'audio/wav' }));

    expect(mediaManager.get('asset_ok_video')!.error).toBeFalsy();
    expect(mediaManager.get('asset_ok_audio')!.error).toBeFalsy();
  });
});

describe('mediaManager image registration', () => {
  beforeEach(() => {
    mediaManager.clear();
  });

  it('registerUrl (image): caches img and notifies subscribers on load event', () => {
    const notified: string[] = [];
    const unsub = mediaManager.onChange((id) => notified.push(id));
    try {
      mediaManager.registerUrl('a', 'http://mock.local/red.png', 'image');
      const entry = mediaManager.get('a')!;
      expect(entry.img).toBeDefined();

      entry.img!.dispatchEvent(new Event('load'));

      expect(notified).toContain('a');
      expect(entry.error).toBeFalsy();
    } finally {
      unsub();
    }
  });

  it('registerUrl (image): marks entry.error and notifies subscribers on error event', () => {
    const notified: string[] = [];
    const unsub = mediaManager.onChange((id) => notified.push(id));
    try {
      mediaManager.registerUrl('b', 'http://bad.invalid/x.png', 'image');
      const entry = mediaManager.get('b')!;
      expect(entry.img).toBeDefined();

      entry.img!.dispatchEvent(new Event('error'));

      expect(entry.error).toBe(true);
      expect(notified).toContain('b');
    } finally {
      unsub();
    }
  });

  it('registerFile (image): caches img and notifies subscribers on load event', () => {
    const notified: string[] = [];
    const unsub = mediaManager.onChange((id) => notified.push(id));
    try {
      mediaManager.registerFile('f', new File(['x'], 'img.png', { type: 'image/png' }));
      const entry = mediaManager.get('f')!;
      expect(entry.img).toBeDefined();
      expect(entry.error).toBeFalsy();

      entry.img!.dispatchEvent(new Event('load'));

      expect(notified).toContain('f');
    } finally {
      unsub();
    }
  });

  it('sets crossOrigin to anonymous on the registered image', () => {
    mediaManager.registerUrl('c', 'http://mock.local/blue.png', 'image');
    expect(mediaManager.get('c')!.img!.crossOrigin).toBe('anonymous');

    mediaManager.registerFile('g', new File(['x'], 'green.png', { type: 'image/png' }));
    expect(mediaManager.get('g')!.img!.crossOrigin).toBe('anonymous');
  });
});
