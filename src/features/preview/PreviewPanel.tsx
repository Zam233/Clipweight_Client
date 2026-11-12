import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '@/stores/timelineStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { TRACK_COLORS } from '@/types/timeline';
import type { Clip, Timeline, Track } from '@/types/timeline';
import { captionFontSize, textLayout } from './captionLayout';
import { orderTracksForComposite } from './compositeOrder';
import { publishPlaybackStats, resetPlaybackStats } from './playbackStats';
import { clearMgImageCache, drawMgFrame, emptyFidelity, mgSpecOf } from './mgRenderer';
import { reportMgFidelity, resetMgFidelity, useMgFidelityStore } from './mgFidelity';

/**
 * 同时连续解码的视频路数上限（devplan T1.2）。
 *
 * 为什么是 2：主画面 1 路 + 叠化/叠轨时另一路 1 路。再往上会同时占满浏览器硬解器与显存，
 * 实测表现为「第一帧出来了、之后一直卡」——不是渲染慢，是解码排队。
 */
const DECODE_BUDGET = 2;
import { computePreviewFrameRect, xToScrubTime } from './frameGeometry';
import type { FrameRect } from './frameGeometry';
import { formatTimecode, clamp } from '@/lib/utils';
import { secondsToFrame } from '@/lib/mediaTime';
import { mediaManager } from '@/services/media/mediaManager';
import { interpolateProperties } from '@/features/timeline/engine/easing';
import { Maximize, Minimize, Shield, Volume2, VolumeX, ZoomIn, ZoomOut, Camera, Repeat, Play, Pause, Gauge } from 'lucide-react';
import { Tooltip, Slider } from '@/components/ui';
import { applyMasterVolume } from './volume';
import { toast } from '@/stores/toastStore';
import { resolveCanvasClickAction } from './canvasClickAction';
import { contentKey, getPreviewLayerCache, quantize, type Layer2DContext } from './layerCache';
import { createFramePerf, previewPerf, type FramePerf } from './perf';
import { PreviewPerfOverlay } from './PreviewPerfOverlay';
import {
  applyTransformDrag, hitTestTransform, snapTransform, transformHandleLayout,
  type DragContext, type SnapGuide, type Transform2D as HandleTransform,
} from './transformHandles';
import { fidelityBadges } from './previewFidelity';

/**
 * PreviewPanel — Canvas compositor that renders the timeline at the playhead.
 * Drives playback via requestAnimationFrame and syncs duration with the timeline.
 */
export function PreviewPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Drag-scrub state: start coords + dragging flag + rAF-merged target time.
  // 拖拽刷洗状态：起点坐标 + 拖拽标志 + rAF 合并的目标时间。
  const scrubRef = useRef({ startX: 0, startY: 0, dragging: false, raf: 0, targetTime: -1, lastUpWasDouble: false });

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
  const volume = usePreviewStore((s) => s.volume);
  const setVolume = usePreviewStore((s) => s.setVolume);
  const showPerfPanel = useSettingsStore((s) => s.showPerfPanel);
  // devplan T2.4：MG 渲染还原度台账（有差异才显示角标）
  // devplan M1 回滚开关：default false = 旧路径（每帧 seek），开 = 连续解码新路径
  const continuousPlayback = useSettingsStore((s) => s.previewContinuousPlayback);
  const mgFidelityCount = useMgFidelityStore((s) => s.clipCount);
  const fidelityLabels = useMgFidelityStore((s) => s.labels);
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds);

  // C1: 画布双击编辑文字 — 命中 text/caption 片段时打开内联编辑
  const [editingText, setEditingText] = useState<{ clipId: string; text: string; x: number; y: number } | null>(null);
  const editTextRef = useRef<HTMLTextAreaElement>(null);
  // O-变换手柄：拖拽会话 + 吸附参考线（参考线在画布上叠加绘制）
  const transformDragRef = useRef<{ ctx: DragContext; clipId: string; pushed?: boolean } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  /** 参考线的绘制循环可见副本（draw 闭包读 ref，避免闭包过期） */
  const guidesRef = useRef<SnapGuide[]>([]);
  /** 参考线变化会让绘制循环重绘（清空参考线时时间线并未变化） */
  const guidesEpochRef = useRef(0);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // P-02：标记这次 up 序列是双击，pointerup 的点击决策据此不再切播放。
    scrubRef.current.lastUpWasDouble = true;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const pst = usePreviewStore.getState();
    const tl = useTimelineStore.getState().timeline;
    const t = pst.currentTimeSec;
    const fr = computePreviewFrameRect(rect.width, rect.height, tl.width, tl.height, pst.zoomLevel);
    // 点击必须在帧内
    if (px < fr.fx || px > fr.fx + fr.fw || py < fr.fy || py > fr.fy + fr.fh) return;
    const hit = hitTestTextClipForEdit(px, py, fr, tl.tracks, t);
    if (hit) setEditingText({ clipId: hit.clip.id, text: hit.clip.text ?? '', x: hit.x, y: hit.y });
  }, []);

  const commitTextEdit = useCallback(() => {
    setEditingText((cur) => {
      if (cur) {
        useHistoryStore.getState().pushState(useTimelineStore.getState().timeline, 'edit-text');
        useTimelineStore.getState().updateClip(cur.clipId, { text: cur.text });
      }
      return null;
    });
  }, []);

  useEffect(() => {
    if (editingText) {
      // 聚焦并选中全部文本，方便直接覆盖
      const el = editTextRef.current;
      if (el) { el.focus(); el.select(); }
    }
  }, [editingText]);

  // Sync duration from timeline
  useEffect(() => {
    usePreviewStore.getState().setDuration(timeline.duration_sec);
    usePreviewStore.getState().setFps(timeline.fps);
  }, [timeline.duration_sec, timeline.fps]);

  // Audio sync: play/pause/seek audio clips' media elements with the playhead.
  //
  // devplan T1.5：两处改动。
  // ① 节流 100ms → 20ms：100ms 的节流意味着音画最大可以差出 100ms，人耳对这种
  //    "口型对不上"很敏感；20ms 约等于一帧，且比"每帧都做"便宜（每帧约 16ms）。
  // ② 预缓冲单独节流（500ms）：它要扫全时间线找未来 3 秒的片段，没必要跟着 20ms 走。
  const lastAudioSyncRef = useRef(0);
  const lastPrebufferRef = useRef(0);
  const audioStateRef = useRef({ playing: false, muted: false, tl: timeline as unknown });
  /** 只在时间线对象变化时重建音频片段索引——旧实现每次同步都遍历全部轨道 */
  const audioClips = useMemo(() => {
    const out: Array<{
      assetId: string; start: number; end: number; speed: number;
      volume: number; trackMuted: boolean; offset: number;
    }> = [];
    for (const track of timeline.tracks) {
      if (track.kind !== 'audio' && track.kind !== 'waveform') continue;
      for (const clip of track.clips) {
        if (clip.enabled === false) continue;
        out.push({
          assetId: clip.asset_id,
          start: clip.start_sec,
          end: clip.start_sec + clip.duration_sec,
          speed: clip.speed,
          volume: clip.volume,
          trackMuted: !!track.muted,
          offset: clip.source_offset_sec,
        });
      }
    }
    return out;
  }, [timeline]);

  // P-06：rAF 同步循环读取的镜像（避免循环依赖 audioClips/volume 重建循环）
  const audioClipsRef = useRef(audioClips);
  audioClipsRef.current = audioClips;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    const prev = audioStateRef.current;
    const stateChanged = prev.playing !== isPlaying || prev.muted !== isMuted;
    audioStateRef.current = { playing: isPlaying, muted: isMuted, tl: timeline };
    const now = performance.now();
    // P-06（PRD §2 P2）：播放中不再依赖 currentTimeSec 触发本 effect（那等于
    // 每帧重跑一遍并让整棵组件树跟着渲染）。播放中的同步由下方 rAF 循环驱动；
    // 本 effect 只在 播放/静音/时间线/音量 变化时执行一次（用 getState 拿最新 t）。
    if (isPlaying && !stateChanged && prev.tl === timeline && now - lastAudioSyncRef.current < 1e9) {
      // 播放中的周期同步走 rAF（见 useEffect [isPlaying]），这里直接跳过
      return;
    }
    lastAudioSyncRef.current = now;

    const t = usePreviewStore.getState().currentTimeSec;
    const playing = isPlaying;
    const muted = isMuted;
    for (const item of audioClips) {
      const entry = mediaManager.get(item.assetId);
      const el = entry?.audioEl ?? entry?.videoEl;
      if (!el) continue;
      const inClip = t >= item.start && t < item.end;
      // Account for clip speed so audio stays in sync with sped-up/slowed video
      const localT = (t - item.start) * item.speed + item.offset;
      el.volume = applyMasterVolume(item.volume, volume);
      el.muted = muted || item.trackMuted;
      if (Math.abs(el.playbackRate - item.speed) > 0.01) {
        try { el.playbackRate = item.speed; } catch { /* not supported */ }
      }
      if (inClip && playing) {
        // 校正阈值 0.08s（约 2 帧@30fps）：再小会频繁 seek，反而听得出断续
        if (Math.abs(el.currentTime - localT) > 0.08) {
          try { el.currentTime = localT; } catch { /* seek not available */ }
        }
        if (el.paused) {
          mediaManager.attachAnalyser(item.assetId);
          el.play().catch(() => {});
        }
      } else {
        if (!el.paused) el.pause();
      }
    }
    // V9: 预缓冲——播放头后 3s 内的画面片段升级解码预载，消除跨片段边界闪白。
    // 与音频同步解耦：它扫全时间线，500ms 一次足够。
    if (playing && now - lastPrebufferRef.current >= 500) {
      lastPrebufferRef.current = now;
      const upcoming = new Set<string>();
      for (const track of timeline.tracks) {
        if (track.kind !== 'video' && track.kind !== 'image') continue;
        for (const clip of track.clips) {
          if (clip.enabled === false) continue;
          const end = clip.start_sec + clip.duration_sec;
          if (end > t && clip.start_sec < t + 3) upcoming.add(clip.asset_id);
        }
      }
      if (upcoming.size > 0) mediaManager.prebuffer([...upcoming]);
    }
    // P-06：依赖里去掉 currentTimeSec（播放中由下方 rAF 驱动同步，不再每帧重渲染整树）
  }, [isPlaying, isMuted, timeline, volume, audioClips]);

  // P-06：播放中的音频同步 rAF——从"每帧触发 React effect"改为纯 ref 循环，
  // 与合成 rAF（读取 store，不触发渲染）同构；volume 经 ref 读取避免重建循环。
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const pst = usePreviewStore.getState();
      if (!pst.isPlaying) return;
      const t = pst.currentTimeSec;
      for (const item of audioClipsRef.current) {
        const entry = mediaManager.get(item.assetId);
        const el = entry?.audioEl ?? entry?.videoEl;
        if (!el) continue;
        const inClip = t >= item.start && t < item.end;
        const localT = (t - item.start) * item.speed + item.offset;
        el.volume = applyMasterVolume(item.volume, volumeRef.current);
        el.muted = pst.isMuted || item.trackMuted;
        if (Math.abs(el.playbackRate - item.speed) > 0.01) {
          try { el.playbackRate = item.speed; } catch { /* not supported */ }
        }
        if (inClip) {
          if (Math.abs(el.currentTime - localT) > 0.08) {
            try { el.currentTime = localT; } catch { /* seek not available */ }
          }
          if (el.paused) {
            mediaManager.attachAnalyser(item.assetId);
            el.play().catch(() => {});
          }
        } else if (!el.paused) {
          el.pause();
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, audioClips]);

  // Playback loop
  //
  // devplan T1.3：**绝对时间锚点**时钟。
  // 旧实现（本函数改造前）是 `next = current + min(dt, 1/15) * speed`：卡一帧就丢一段墙钟，
  // 连续卡顿会让播放头越跑越慢（看起来像放慢动作）；且 dt 截断本身就等于主动丢时间。
  // 现在起播时打一个锚点 `(墙钟, 时间线, 速度)`，每帧用绝对差算时间线位置——中间卡多久
  // 都能一次性追平，丢的是画面帧而不是时间。
  // 外部改时间（拖动播放头/seek/step）或改速度时，通过"当前值 ≠ 本循环上次写入值"识别并重新打锚点。
  useEffect(() => {
    if (!isPlaying) {
      publishPlaybackStats({ clockRunning: false, driftMs: 0 });
      return;
    }
    let raf = 0;
    const speedOf = (st: ReturnType<typeof usePreviewStore.getState>): number => (
      st.shuttleSpeed !== 0 ? st.shuttleSpeed * Math.abs(st.playbackSpeed) : st.playbackSpeed
    );
    let anchorWall = performance.now();
    let anchorTl = usePreviewStore.getState().currentTimeSec;
    let anchorSpeed = speedOf(usePreviewStore.getState());
    let written = anchorTl;
    // 播放诊断（T1.1）：期望帧数由经过的墙钟×fps 估算，已呈现帧由 mediaManager 的 rVFC 计数
    const startedWall = anchorWall;
    mediaManager.resetFrameStats();
    let lastPublish = 0;

    const tick = (now: number) => {
      const st = usePreviewStore.getState();
      const speed = speedOf(st);
      // 外部改动：时间被别处写过，或速度变了 → 重新打锚点（否则会把播放头拽回旧位置）
      if (Math.abs(st.currentTimeSec - written) > 1e-3 || speed !== anchorSpeed) {
        anchorWall = now;
        anchorTl = st.currentTimeSec;
        anchorSpeed = speed;
        written = st.currentTimeSec;
      }
      const elapsedSec = (now - anchorWall) / 1000;
      let next = anchorTl + elapsedSec * speed;
      let rewound = false;
      const dur = useTimelineStore.getState().timeline.duration_sec;
      const region = st.loopRegion;
      const looping = st.isLooping;

      if (looping) {
        // Loop region (or the whole timeline if no In/Out markers set)
        // 钳位到时间线范围内：时间线被修剪变短后，标记可能越界
        const lo = Math.min(Math.max(region ? region.start : 0, 0), dur);
        const hi = Math.min(Math.max(region ? region.end : dur, lo + 0.01), dur);
        const span = hi - lo;
        if (span > 0) {
          if (next >= hi) { next = lo + ((next - hi) % span); rewound = true; }
          else if (next < lo) { next = hi - ((lo - next) % span); rewound = true; }
        }
      } else if (next >= dur) {
        next = dur;
        st.setPlaying(false);
        rewound = true;
      } else if (next < 0) {
        next = 0;
        st.setPlaying(false);
        rewound = true;
      }
      // 回绕/到端点后必须重打锚点，否则 elapsed 会一直变大、每帧都再回绕一次
      if (rewound) {
        anchorWall = now;
        anchorTl = next;
        anchorSpeed = speed;
      }
      st.setCurrentTime(next);
      written = next;

      // ── 诊断发布（节流 250ms，与合成采样同频）─────────────────────────────
      if (now - lastPublish >= 250) {
        lastPublish = now;
        const fps = usePreviewStore.getState().fps || 30;
        const expected = ((now - startedWall) / 1000) * fps;
        const presented = mediaManager.frameStats().presented;
        const wallTl = anchorTl + ((now - anchorWall) / 1000) * speed;
        publishPlaybackStats({
          clockRunning: true,
          activeDecodes: mediaManager.activeDecodeCount(),
          frozenCount: mediaManager.frozenAssets().length,
          presentedFrames: presented,
          droppedFrames: Math.max(0, Math.round(expected - presented)),
          // 漂移 = 实际播放头 − 锚点推出来的墙钟位置（正常应在几毫秒内）
          driftMs: Math.round((next - wallTl) * 1000),
        });
      }

      if (usePreviewStore.getState().isPlaying) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // devplan T1.2：暂停时把解码池收空——元素在后台继续解码白占解码器与显存，
  // 切回播放时还可能撞上"同时解码太多"导致前几帧全丢。
  useEffect(() => {
    if (isPlaying) return;
    mediaManager.setActiveVideos([], { budget: 1 });
  }, [isPlaying]);

  // Pause all media when the preview unmounts (avoid audio playing after leaving the editor)
  useEffect(() => () => {
    cancelAnimationFrame(scrubRef.current.raf);
    mediaManager.pauseAll();
    resetPlaybackStats();
    // devplan T2.3/T2.4：切项目/卸载时清掉 MG spec 图片缓存与还原度台账，
    // 否则下一个项目可能命中上一个项目的图片，或带着别人的"差异角标"。
    resetMgFidelity();
    clearMgImageCache();
  }, []);

  // V10: 页面隐藏时暂停播放——RAF 停摆但音频元素继续出声，回切后音画错位
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && usePreviewStore.getState().isPlaying) {
        usePreviewStore.getState().setPlaying(false);
        mediaManager.pauseAll();
        // P-09（PRD §2 P3）：切走标签页导致暂停时给用户一个提示——
        // 否则切回来只看到画面停着，不知道为什么。
        toast('已切换标签页，预览已暂停（点击播放继续）', 'info');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Canvas pointer scrub: drag horizontally to seek the playhead, click to toggle play.
  // 画布指针刷洗：水平拖拽移动播放头，单击切换播放/暂停。
  //
  // O-变换手柄：若按下的位置命中选中片段的手柄/本体，则进入**变换拖拽**（不平移播放头）。
  const transformTargetClip = useCallback((): { clip: Clip; frame: FrameRect; dpr: number } | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const id = selectedClipIds[0];
    if (!id) return null;
    const tl = useTimelineStore.getState().timeline;
    const pst = usePreviewStore.getState();
    if (pst.isPlaying) return null; // 播放中不显示手柄（避免抖动手柄与误拖）
    const t = pst.currentTimeSec;
    for (const track of tl.tracks) {
      if (track.hidden) continue;
      for (const clip of track.clips) {
        if (clip.id !== id) continue;
        if (clip.kind !== 'video' && clip.kind !== 'image') return null;
        if (t < clip.start_sec || t >= clip.start_sec + clip.duration_sec) return null;
        const rect = wrap.getBoundingClientRect();
        const frame = computePreviewFrameRect(rect.width, rect.height, tl.width, tl.height, pst.zoomLevel);
        return { clip, frame, dpr: window.devicePixelRatio || 1 };
      }
    }
    return null;
  }, [selectedClipIds]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture unavailable */ }
    // P-02：新手势开始时复位双击标记（由 handleDoubleClick 置位、pointerup 消费）
    scrubRef.current.lastUpWasDouble = false;

    // 先判手柄：命中则进入变换拖拽，不再刷洗播放头
    const target = transformTargetClip();
    if (target) {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const tf = getClipTransform(target.clip);
      const layout = transformHandleLayout(target.frame, tf);
      const hit = hitTestTransform(px, py, layout);
      if (hit) {
        // P-05（PRD §2 P2）：不再"按下手柄即入撤销栈"——改在**首次真实位移**时入栈
        // （见 handlePointerMove），误点手柄后 Ctrl+Z 不会空耗一步。
        transformDragRef.current = {
          clipId: target.clip.id,
          pushed: false,
          ctx: {
            kind: hit.kind,
            anchor: hit.anchor,
            startPointer: [px, py],
            startTransform: tf,
            frame: target.frame,
            shiftKey: e.shiftKey,
          },
        };
        return;
      }
    }

    const s = scrubRef.current;
    s.startX = e.clientX;
    s.startY = e.clientY;
    s.dragging = false;
  }, [transformTargetClip]);

  /** 更新吸附参考线：state（UI 用）+ ref（绘制循环用）+ epoch（触发重绘） */
  const setGuides = useCallback((list: SnapGuide[]) => {
    guidesRef.current = list;
    guidesEpochRef.current += 1;
    setSnapGuides(list);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    // O-变换手柄：拖拽中实时写回 metadata.transform 并更新吸附参考线
    const drag = transformDragRef.current;
    if (drag) {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const outcome = applyTransformDrag(
        { ...drag.ctx, shiftKey: e.shiftKey }, px, py,
      );
      // P-05：首次真实位移才入撤销栈（快照的是拖拽前状态）
      if (!drag.pushed) {
        drag.pushed = true;
        useHistoryStore.getState().pushState(
          useTimelineStore.getState().timeline, 'transform');
      }
      const store = useTimelineStore.getState();
      const clip = store.getClip(drag.clipId);
      if (clip) {
        store.updateClip(drag.clipId, {
          metadata: {
            ...(clip.metadata ?? {}),
            transform: {
              x: Number(outcome.transform.x.toFixed(5)),
              y: Number(outcome.transform.y.toFixed(5)),
              scale: Number(outcome.transform.scale.toFixed(5)),
              rotation: Number(outcome.transform.rotation.toFixed(3)),
            },
          },
        });
      }
      setGuides(outcome.guides);
      return;
    }

    const s = scrubRef.current;
    const d = Math.abs(e.clientX - s.startX) + Math.abs(e.clientY - s.startY);
    if (d > 5) {
      s.dragging = true;
      if (usePreviewStore.getState().isPlaying) usePreviewStore.getState().setPlaying(false);
    }
    if (!s.dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const tl = useTimelineStore.getState().timeline;
    const zoom = usePreviewStore.getState().zoomLevel;
    const frame = computePreviewFrameRect(rect.width, rect.height, tl.width, tl.height, zoom);
    s.targetTime = xToScrubTime(e.clientX - rect.left, frame, tl.duration_sec);
    if (s.raf === 0) {
      s.raf = requestAnimationFrame(() => {
        scrubRef.current.raf = 0;
        usePreviewStore.getState().setCurrentTime(scrubRef.current.targetTime);
      });
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (transformDragRef.current) {
      transformDragRef.current = null;
      setGuides([]);
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      }
      return;
    }
    const s = scrubRef.current;
    if (s.raf !== 0) {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      usePreviewStore.getState().setCurrentTime(s.targetTime);
    }
    if (!s.dragging) {
      // V10: 画布点击后移除焦点——残留焦点在按钮上时空格会二次触发该按钮（焦点陷阱）
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      // P-02/P-03（coding plan §1 默认口径）：画布单击不再切播放——旧行为让
      // "点空白取消选中"把视频播起来（P-03）、"双击编辑文字"先播放/暂停闪一下
      // （P-02）。单击只做选中/取消选中；播放由播放按钮与空格快捷键控制。
      // 判定输入：双击窗口内（pointerdown 记录 lastUpWasDouble）。
      resolveCanvasClickAction({
        hitsText: s.lastUpWasDouble === true,
        isDouble: s.lastUpWasDouble === true,
      });
    }
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
    s.dragging = false;
  }, []);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    transformDragRef.current = null;
    setGuides([]);
    const s = scrubRef.current;
    if (s.raf !== 0) {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    }
    s.dragging = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
  }, []);

  // Keep fullscreen state in sync with the browser (e.g. user exits via Escape)
  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [setFullscreen]);

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
    const last = { t: -1, tl: null as unknown, safe: false, zoom: -1, mv: -1, guides: -1 };

    // Re-render when media state changes (e.g. an asset errors while loading) —
    // otherwise the failed clip would stay a silent black frame until the playhead moves.
    let mediaVersion = 0;
    const unsubMedia = mediaManager.onChange(() => {
      mediaVersion++;
      bumpPreviewMediaVersion();
      // O6: 素材重新加载/报错 → 媒体层缓存整体失效（旧帧可能已过时，或本就不该缓存）
      getPreviewLayerCache().invalidatePrefix('media');
    });

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const perf = createFramePerf(perfNow());
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
      // V10: 播放头停在末尾时钳到 dur−ε——t==dur 时刻没有任何活跃 clip，会画出末帧黑屏
      const t = tl.duration_sec > 0 ? Math.min(pst.currentTimeSec, tl.duration_sec - 0.001) : 0;
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

      // Composite order: lowest track index drawn first (bottom layer), highest index last (top layer) — matches backend render.py is_overlay = track.index > 0.
      // 合成顺序：轨道 index 升序，低 index 先画（底层），高 index 最后（顶层）。
      compositeTimelineClips(ctx, tl, t, { fx, fy, fw, fh }, dpr, perf,
        // 只有「连续播放」开启时才按播放态取帧（不逐帧 seek）；关掉即回到旧的
        // 每帧 seek 路径——这是 devplan M1 的回滚开关。
        useSettingsStore.getState().previewContinuousPlayback
          && usePreviewStore.getState().isPlaying);

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

      // O-变换手柄 + 吸附参考线（选中 video/image 片段且未播放时显示）
      drawTransformOverlay(ctx, tl, t, { fx, fy, fw, fh },
        useSelectionStore.getState().selectedClipIds, guidesRef.current);

      // O6: 采样一帧（含缓存命中率）；store 推送由 PerfTracker 内部节流
      previewPerf.record(perf);
    };

    /**
     * devplan T1.2：按播放头维护「活跃解码集合」。
     *
     * 为什么必须显式维护：`mediaManager.registerTimeline()` 会把时间线里所有 video clip
     * 都注册成元素，旧实现还给每个 `preload='auto'`——全片几十个镜头就是几十路解码，
     * 浏览器硬解上限一超就排队，seek 变慢、画面开始跳帧。
     * 现在的规则：**正在播放的才连续解码**，取画面最上层的前 `DECODE_BUDGET` 路；
     * 其余 pause 保留最后一帧（合成仍能用），并按 clip 自己的变速设 playbackRate。
     */
    const applyDecodePool = (tl: Timeline, t: number, playing: boolean) => {
      if (!playing) {
        mediaManager.setActiveVideos([], { budget: 1 });
        return;
      }
      const ids: string[] = [];
      const rates: Record<string, number> = {};
      const speed = usePreviewStore.getState().playbackSpeed || 1;
      // 从上往下取（z 序高的先满足预算）：最上层通常就是用户正在看的画面
      const ordered = orderTracksForComposite(tl.tracks).slice().reverse();
      for (const track of ordered) {
        if (track.kind !== 'video' || track.hidden) continue;
        for (const clip of track.clips) {
          if (clip.enabled === false) continue;
          if (t < clip.start_sec || t >= clip.start_sec + clip.duration_sec) continue;
          if (ids.includes(clip.asset_id)) continue;
          ids.push(clip.asset_id);
          rates[clip.asset_id] = clip.speed * speed;
        }
        if (ids.length >= DECODE_BUDGET) break;
      }
      mediaManager.setActiveVideos(ids, { budget: DECODE_BUDGET, rates });
    };

    const loop = () => {
      const pst = usePreviewStore.getState();
      const tl = useTimelineStore.getState().timeline;
      const t = pst.currentTimeSec;
      const safe = pst.showSafeArea;
      const zoom = pst.zoomLevel;
      const guidesEpoch = guidesEpochRef.current;
      if (t !== last.t || tl !== last.tl || safe !== last.safe || zoom !== last.zoom
          || mediaVersion !== last.mv || guidesEpoch !== last.guides) {
        last.t = t;
        last.tl = tl;
        last.safe = safe;
        last.zoom = zoom;
        last.mv = mediaVersion;
        last.guides = guidesEpoch;
        // devplan T1.2：按当前播放头维护解码池（只在播放时连续解码）。
        // 活跃集合 = 当前时刻可见的 video clip，按轨道 z 序从上往下取前 2 个；
        // 其余 pause 保留最后一帧，超出预算的会进 frozen 列表（浮层与徽标用）。
        applyDecodePool(tl, t, pst.isPlaying && useSettingsStore.getState().previewContinuousPlayback);
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
      unsubMedia();
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-dim">
      {/* Preview header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-outline-variant/30 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-label font-medium text-on-surface-variant uppercase tracking-wide">
            节目监视器
          </span>
          {/* P1-32 / devplan T2.4：明示预览近似性。
              MG 现在**真的画了**（结构化 spec → canvas display-list），但浏览器与后端
              Hyperframes/FFmpeg 的字体/滤镜/阴影不可能完全一致，所以这条说明保留；
              真正有差异的片段数由 `useMgFidelityStore` 统计，**有差异才额外标红点**。 */}
          <span
            className="px-1.5 py-0.5 rounded-cw-full bg-surface-container-high border border-outline-variant/40 text-caption text-on-surface-variant cursor-help flex items-center gap-1"
            data-testid="preview-fidelity-badge"
            title={fidelityLabels.length > 0
              ? `近似预览：${fidelityLabels.join('；')}。最终效果以渲染成片为准。`
              : '近似预览：MG 动画在浏览器内实时渲染，字体/滤镜/阴影与后端成片可能有细微差异；最终效果以渲染成片为准。'}
          >
            近似预览
            {mgFidelityCount > 0 && (
              <span
                className="inline-flex items-center rounded-cw-full bg-error/15 px-1 text-[10px] leading-4 text-error"
                data-testid="preview-fidelity-count"
              >
                {mgFidelityCount} 处差异
              </span>
            )}
          </span>
        </div>
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
              setPlaybackSpeed(nextPlaybackSpeed(playbackSpeed, speeds));
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
          <Slider label="音量" min={0} max={1} step={0.05} value={volume} onChange={setVolume} className="min-w-[80px] shrink-0" />
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
          {/* devplan M1 回滚/对比开关：连续播放（默认关，验收后开启）。
              关 = 旧路径（每帧 seek，会看到一帧一帧）；开 = 连续解码 + 解码池。 */}
          <Tooltip content={continuousPlayback ? '连续播放：开（关掉可对比旧路径）' : '连续播放：关（开启后预览才平滑）'}>
            <button
              type="button"
              onClick={() => useSettingsStore.getState().setPreviewContinuousPlayback(!continuousPlayback)}
              aria-pressed={continuousPlayback}
              aria-label="连续播放"
              data-testid="preview-continuous-playback"
              className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${continuousPlayback ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
              <Play className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          {/* O6: 性能诊断开关（偏好持久化；关掉即零开销） */}
          <Tooltip content="性能诊断">
            <button
              onClick={() => useSettingsStore.getState().setShowPerfPanel(!showPerfPanel)}
              aria-pressed={showPerfPanel}
              aria-label="性能诊断"
              className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${showPerfPanel ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
              <Gauge className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="全屏">
            <button onClick={() => {
              // 全屏请求可能被浏览器拒绝：成功后才置位，避免 UI 状态与实际不一致
              wrapRef.current?.requestFullscreen?.()
                .then(() => setFullscreen(true))
                .catch(() => setFullscreen(false));
            }}
              className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
              <Maximize className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="导出当前帧 (PNG)">
            <button onClick={() => { void (async () => {
              // V10: 离屏按时间线分辨率重渲当前帧——直接导出预览画布会带上
              // safe-area 叠层/窗口 DPR 缩放/黑边，与成片不一致
              const tl = useTimelineStore.getState().timeline;
              if (tl.width <= 0 || tl.height <= 0) return;
              const t = tl.duration_sec > 0
                ? Math.min(usePreviewStore.getState().currentTimeSec, tl.duration_sec - 0.001)
                : 0;
              // P-01：先等所有可见视频 seek 到目标时刻的新帧再合成，
              // 否则导出的是上一帧（与监视器不一致）。
              const visibleClips = orderTracksForComposite(tl.tracks)
                .filter((track) => !track.hidden)
                .flatMap((track) => track.clips)
                .filter((clip) => !clip.nested_timeline
                  && clip.enabled !== false
                  && t >= clip.start_sec && t < clip.start_sec + clip.duration_sec);
              const prep = await mediaManager.prepareFrameAt(visibleClips, t);
              if (!prep.ready) {
                // 有素材没就绪：明确提示，不导出占位/旧帧（宁可不出也不给错图）
                toast('部分素材尚未解码到该帧，请稍后重试或先播放一下', 'info');
                return;
              }
              const off = document.createElement('canvas');
              off.width = tl.width;
              off.height = tl.height;
              const ctx = off.getContext('2d');
              if (!ctx) return;
              ctx.fillStyle = '#0E101A';
              ctx.fillRect(0, 0, off.width, off.height);
              for (const track of orderTracksForComposite(tl.tracks)) {
                if (track.hidden) continue;
                if (track.muted && (track.kind === 'audio' || track.kind === 'waveform')) continue;
                for (const clip of track.clips) {
                  if (t < clip.start_sec || t >= clip.start_sec + clip.duration_sec) continue;
                  if (clip.enabled === false) continue;
                  if (clip.nested_timeline) {
                    drawNestedTimeline(ctx, clip, track, 0, 0, off.width, off.height, t, 0);
                    continue;
                  }
                  drawClipToPreview(ctx, clip, track, 0, 0, off.width, off.height, t);
                }
              }
              const link = document.createElement('a');
              link.download = `frame_${Math.floor(usePreviewStore.getState().currentTimeSec * 1000)}.png`;
              link.href = off.toDataURL('image/png');
              link.click();
            })(); }}
              className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
              <Camera className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Canvas viewport */}
      <div ref={wrapRef} className="flex-1 relative overflow-hidden min-h-0 group/preview">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onDoubleClick={handleDoubleClick}
        />
        {/* C1: 画布内联文字编辑 */}
        {editingText && (
          <div className="absolute z-20" style={{ left: editingText.x, top: editingText.y, transform: 'translate(-50%, -50%)' }}>
            <textarea
              ref={editTextRef}
              value={editingText.text}
              onChange={(e) => setEditingText({ ...editingText, text: e.target.value })}
              onBlur={commitTextEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextEdit(); }
                if (e.key === 'Escape') setEditingText(null);
              }}
              rows={2}
              className="w-64 max-w-[80vw] bg-black/85 text-white text-center rounded-cw-xs
                px-3 py-2 text-body outline-none border-2 border-primary/70 resize-none shadow-2xl"
              aria-label="编辑文字"
            />
          </div>
        )}
        {/* O6: 性能诊断浮层（拖动播放头时看耗时与缓存命中率） */}
        <PreviewPerfOverlay />
        {/* O-特效预览还原度：把"预览与导出的差异"显式标出来（LUT 仅渲染后可见、星形蒙版导出不支持） */}
        <FidelityBadges />
        {/* Centered play/pause overlay — visible when paused or on hover */}
        <button
          aria-label={isPlaying ? '暂停' : '播放'}
          className={`absolute inset-0 m-auto w-12 h-12 rounded-cw-full flex items-center justify-center
            bg-black/50 text-white backdrop-blur-sm transition-opacity duration-short3 pointer-events-none
            ${isPlaying ? 'opacity-0 group-hover/preview:opacity-100' : 'opacity-35 group-hover/preview:opacity-100'}`}
        >
          {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
        </button>
        {/* P-07（PRD §2 P2）：全屏内的迷你控制条——全屏的是 wrapRef（画布区域），
            头部工具栏与信息条不在其中，旧实现全屏后无法暂停/看时间码。 */}
        <FullscreenMiniBar />
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
/**
 * M11: 转场可见性 — 在进/出转场窗口内调制透明度，让淡入淡出/溶解类转场在预览中可见。
 * - transition_in：片段开头 dur 秒内透明度 0→1（前一片段叠化进来）
 * - transition_out：片段结尾 dur 秒内透明度 1→0（叠化到下一片段）
 * - hard_cut / 无转场：不调制
 * - 轮76：slide/wipe 改为几何转场（见 transitionGeometry），不再退化为 alpha 渐隐
 */
export function applyTransitionAlpha(opacity: number, clip: Clip, localT: number): number {
  const dur = Math.max(0.05, clip.transition_duration_sec ?? 0.5);
  const fadeKinds = new Set(['fade', 'dissolve', 'pixel_dissolve', 'glitch']);
  if (clip.transition_in && clip.transition_in !== 'hard_cut' && fadeKinds.has(clip.transition_in)) {
    const windowFrac = clamp(localT / (dur / clip.duration_sec), 0, 1);
    opacity *= windowFrac; // 0→1 淡入
  }
  if (clip.transition_out && clip.transition_out !== 'hard_cut' && fadeKinds.has(clip.transition_out)) {
    const windowFrac = clamp((1 - localT) / (dur / clip.duration_sec), 0, 1);
    opacity *= windowFrac; // 1→0 淡出
  }
  return clamp(opacity, 0, 1);
}

export interface TransitionGeometry {
  /** 水平位移（像素）：slide 转场用 */
  dx: number;
  /** 可见宽度（像素）：wipe 转场用；null = 不裁剪 */
  clipW: number | null;
}

/**
 * 轮76：几何转场预览 —— slide 位移 / wipe 擦除，替代此前的统一 alpha 渐隐。
 * - slide-in：从右侧滑入（dx: fw→0）；slide-out：向左滑出（dx: 0→-fw）
 * - wipe-in：从左向右擦除（可见宽 0→fw）；wipe-out：向右收缩（fw→0）
 */
export function transitionGeometry(
  clip: Clip, localT: number, fw: number, fh: number,
): TransitionGeometry {
  const dur = Math.max(0.05, clip.transition_duration_sec ?? 0.5);
  const w = clamp(dur / clip.duration_sec, 0, 1); // 转场窗口占片段比例
  const geo: TransitionGeometry = { dx: 0, clipW: null };
  if (clip.transition_in === 'slide') {
    geo.dx = (1 - clamp(localT / w, 0, 1)) * fw;
  } else if (clip.transition_in === 'wipe') {
    geo.clipW = clamp(localT / w, 0, 1) * fw;
  }
  if (clip.transition_out === 'slide') {
    geo.dx = -(1 - clamp((1 - localT) / w, 0, 1)) * fw;
  } else if (clip.transition_out === 'wipe') {
    geo.clipW = clamp((1 - localT) / w, 0, 1) * fw;
  }
  return geo;
}

/**
 * M4: 蒙版裁剪 — 把当前画布裁剪路径限定到蒙版形状内（矩形或椭圆，基于归一化 rect）。
 * 必须在 clip 绘制前调用（ctx.save 之后），restore 由调用方统一处理。
 */
/**
 * 蒙版裁剪（M4 + O-遮罩升级）。
 *
 * 支持形状：rect / ellipse / polygon（N 边形）/ star（N 角星）/ heart。
 * 新增：
 * - `mask_rotation`：绕蒙版中心旋转（度）；
 * - `mask_inverted`：反相（用 even-odd 填充规则在整幅画面上"挖洞"）；
 * - `mask_feather`：软边——沿边界多圈描边做 alpha 渐变近似（导出侧用 geq 隐函数线性过渡，
 *   两者观感一致；预览不做离屏模糊是为了不给每帧多加一张全尺寸画布）。
 *
 * 与导出的差异（已在文档写明）：star/heart 导出侧暂不支持（会记警告并跳过蒙版）。
 */
export function applyMaskClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  fx: number, fy: number, fw: number, fh: number,
) {
  if (!clip.mask_type || clip.mask_type === 'none') return;
  const r = clip.mask_rect ?? { x: 0, y: 0, w: 1, h: 1 };
  const x = clamp(r.x, 0, 1);
  const y = clamp(r.y, 0, 1);
  // 宽高钳制到剩余画面，避免蒙版越界
  const w = clamp(r.w, 0.01, 1 - x);
  const h = clamp(r.h, 0.01, 1 - y);
  const mx = fx + x * fw;
  const my = fy + y * fh;
  const mw = w * fw;
  const mh = h * fh;
  const cx = mx + mw / 2;
  const cy = my + mh / 2;
  const rx = mw / 2;
  const ry = mh / 2;
  const rotation = ((clip.mask_rotation ?? 0) * Math.PI) / 180;
  const feather = Math.max(0, Math.min(50, clip.mask_feather ?? 0));

  const traceShape = () => {
    ctx.beginPath();
    switch (clip.mask_type) {
      case 'ellipse':
        ctx.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
        break;
      case 'polygon': {
        const sides = Math.max(3, Math.min(12, clip.mask_points ?? 5));
        for (let i = 0; i < sides; i += 1) {
          const a = rotation + (2 * Math.PI * i) / sides - Math.PI / 2;
          const px = cx + rx * Math.cos(a);
          const py = cy + ry * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
      }
      case 'star': {
        const points = Math.max(3, Math.min(12, clip.mask_points ?? 5));
        const inner = 0.45; // 内半径比例（五角星观感）
        for (let i = 0; i < points * 2; i += 1) {
          const radius = i % 2 === 0 ? 1 : inner;
          const a = rotation + (Math.PI * i) / points - Math.PI / 2;
          const px = cx + rx * radius * Math.cos(a);
          const py = cy + ry * radius * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
      }
      case 'heart': {
        // 心形：两段三次贝塞尔（与导出的形状语言一致）
        const topY = cy - ry * 0.45;
        ctx.moveTo(cx, cy + ry * 0.9);
        ctx.bezierCurveTo(cx - rx * 1.1, cy + ry * 0.1, cx - rx * 0.7, topY - ry * 0.7, cx, topY);
        ctx.bezierCurveTo(cx + rx * 0.7, topY - ry * 0.7, cx + rx * 1.1, cy + ry * 0.1, cx, cy + ry * 0.9);
        ctx.closePath();
        break;
      }
      default:
        ctx.rect(mx, my, mw, mh);
    }
  };

  if (clip.mask_inverted) {
    // 反相：整幅画面减去形状（even-odd 一次成洞，不必离屏合成）
    ctx.beginPath();
    ctx.rect(fx - 2, fy - 2, fw + 4, fh + 4);
    traceShape();
    ctx.clip('evenodd');
    return;
  }

  if (feather > 0) {
    // 软边近似：从形状边界向外若干圈描边，透明度递减
    const steps = 4;
    for (let i = steps; i >= 1; i -= 1) {
      const t = i / steps;
      ctx.save();
      ctx.globalAlpha = t;
      ctx.lineWidth = feather * 2 * (1 - t + 1 / steps);
      traceShape();
      ctx.stroke();
      ctx.restore();
    }
  }

  traceShape();
  ctx.clip();
}

/**
 * C3: 嵌套序列合成 — 把子时间线的片段按父片段的时间窗口递归渲染。
 * 父片段占 [start_sec, start_sec+duration)；嵌套时间线内的时刻 = t - start_sec。
 * 深度上限 4 防止循环嵌套导致栈溢出。
 */
function drawNestedTimeline(
  ctx: CanvasRenderingContext2D,
  parent: Clip,
  parentTrack: Track,
  fx: number, fy: number, fw: number, fh: number,
  t: number,
  depth: number,
  dpr = 1,
  perf?: FramePerf,
) {
  if (depth >= 4 || !parent.nested_timeline) return;
  const nestedT = t - parent.start_sec;
  const nt = parent.nested_timeline;
  const sorted = orderTracksForComposite(nt.tracks);
  for (const track of sorted) {
    if (track.hidden) continue;
    if (track.muted && (track.kind === 'audio' || track.kind === 'waveform')) continue;
    for (const clip of track.clips) {
      if (nestedT < clip.start_sec || nestedT >= clip.start_sec + clip.duration_sec) continue;
      if (clip.enabled === false) continue;
      if (clip.nested_timeline) {
        // 深度优先：用 clip 自己的时间窗继续下钻
        drawNestedTimeline(ctx, clip, track, fx, fy, fw, fh, clip.start_sec + nestedT, depth + 1, dpr, perf);
        continue;
      }
      drawClipToPreview(ctx, clip, track, fx, fy, fw, fh, nestedT, dpr, perf);
    }
  }
}

/**
 * 合成一帧：把时间线上 t 时刻的可见片段按轨道顺序画进 `ctx` 的给定矩形。
 *
 * 从 `draw()` 里提取出来的**可测入口**：预览循环与单测走同一条路径，
 * 性能对比测试（`previewCompositeCache.test.ts`）直接驱动它。
 * 返回实际绘制的层数。
 */
export function compositeTimelineClips(
  ctx: CanvasRenderingContext2D,
  timeline: Timeline,
  t: number,
  geom: FrameRect,
  dpr = 1,
  perf?: FramePerf,
  /** 是否连续播放：播放中视频层不 seek（devplan T1.4） */
  playing = false,
): number {
  const { fx, fy, fw, fh } = geom;
  let drawn = 0;
  const sorted = orderTracksForComposite(timeline.tracks);
  for (const track of sorted) {
    if (track.hidden) continue; // M7: 隐藏轨道不参与预览合成
    if (track.muted && (track.kind === 'audio' || track.kind === 'waveform')) continue;
    for (const clip of track.clips) {
      if (t < clip.start_sec || t >= clip.start_sec + clip.duration_sec) continue;
      if (clip.enabled === false) continue;
      // C3: 嵌套序列 — 递归合成子时间线（深度上限 4，防循环）
      if (clip.nested_timeline) {
        drawNestedTimeline(ctx, clip, track, fx, fy, fw, fh, t, 0, dpr, perf);
        drawn += 1;
        continue;
      }
      drawClipToPreview(ctx, clip, track, fx, fy, fw, fh, t, dpr, perf, playing);
      drawn += 1;
    }
  }
  return drawn;
}

/** 内容绘制阶段的上下文（素材已在 resolve 阶段查好并计时） */
interface ClipPaintEnv {
  tf: Transform2D;
  localT: number;
  speed: number;
  color: string;
  opacity: number;
  entry: ReturnType<typeof mediaManager.get>;
  perf?: FramePerf;
  now: () => number;
  /**
   * 是否处于「连续播放」（devplan T1.4）。
   *
   * 播放时元素由解码池连续 `play()`，画面来自它**当前已解码的帧**——这时再调
   * `seek()` 只会让元素一直处于 seek 中、合成到上一帧（用户看到的"一帧一帧"就是这个）。
   * 只有暂停/拖动时才需要"seek 到精确时刻再画"。
   */
  playing?: boolean;
}

/**
 * 绘制片段**内容**（可被层缓存光栅化的部分）。
 *
 * 返回值：`true` = 真实内容（可入缓存）；`false` = 占位/降级内容（不得入缓存，
 * 否则素材稍后就绪时会把占位冻结在画面上）。
 *
 * 注意：每帧变化的部分（globalAlpha / 混合模式 / filter / 裁剪 / 蒙版 / 转场位移）
 * 由调用方施加在外层 ctx 上，内容本身只许依赖会进缓存键的输入。
 * 因此 `animation` 分支（正弦脉冲 + 自带 alpha）**不参与缓存**。
 */
function paintClipContent(
  ctx: Layer2DContext,
  clip: Clip,
  track: Track,
  fx: number, fy: number, fw: number, fh: number,
  t: number,
  env: ClipPaintEnv,
): boolean {
  const { tf, localT, speed, color } = env;

  switch (track.kind) {
    case 'video':
    case 'image': {
      const entry = env.entry;
      const videoEl = entry?.videoEl;

      // Media failed to load (404 / network) — show an explicit placeholder instead of silent black
      if (entry?.error) {
        drawErrorPlaceholder(ctx, fx, fy, fw, fh);
        return false;
      }

      let drewReal = false;

      if (track.kind === 'image' && entry?.img) {
        // Real image: draw via the registered image (mediaManager caches + notifies on load)
        const img = entry.img;
        if (img.complete && img.naturalWidth > 0) {
          drawCover(ctx, img, fx, fy, fw, fh, tf);
          drewReal = true;
        }
      } else if (videoEl && videoEl.readyState >= 2) {
        // devplan T1.4：播放中**不再 seek**——元素由解码池连续解码，直接取它当前帧。
        // 旧实现每帧 seek 一次（见 mediaManager.seekVideo 的 P1-33 注释：seek 后立即
        // drawImage 画的是旧帧），这就是"一帧一帧"的直接成因。
        const sourceT = (t - clip.start_sec) * speed + clip.source_offset_sec;
        if (env.playing) {
          // 播放中只做漂移校正：偏差超过 250ms 才纠一次，避免打断连续解码
          if (Math.abs(videoEl.currentTime - sourceT) > 0.25) {
            const seekStart = env.now();
            mediaManager.seekVideo(clip.asset_id, sourceT);
            if (env.perf) env.perf.resolveMs += env.now() - seekStart;
          }
        } else {
          // 暂停/拖动：必须 seek 到精确时刻（异步 seeked 通知会触发重绘）
          const seekStart = env.now();
          mediaManager.seekVideo(clip.asset_id, sourceT);
          if (env.perf) env.perf.resolveMs += env.now() - seekStart;
        }
        drawCover(ctx, videoEl, fx, fy, fw, fh, tf);
        drewReal = true;
      }

      if (!drewReal) {
        // Placeholder gradient block representing media — 占位图不入缓存（见函数注释）
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
        return false;
      }
      return true;
    }
    case 'text':
    case 'caption': {
      const text = clip.text || '文字';
      // Min-dimension scaling keeps caption text fitting portrait frames too
      // (height-only scaling overflows 1080x1920 exports).
      const fontSize = captionFontSize(clip.font_size ?? 48, fw, fh, tf.scale);
      // Font family comes from clip.font (was hardcoded); apply weight + italic
      const fontStyle = clip.font_italic ? 'italic' : 'normal';
      const fontWeight = clip.font_weight || 'normal';
      ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${quoteFontFamily(clip.font)}`;
      // Letter spacing (feature-detected; unsupported browsers ignore it)
      const hasLetterSpacing = 'letterSpacing' in ctx;
      const letterSpacingPx = clip.letter_spacing ?? 0;
      if (hasLetterSpacing && letterSpacingPx !== 0) {
        (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${letterSpacingPx}px`;
      }
      // X3: 锚点与导出对齐——position 元数据 → 轨序回退 {1:bottom,2:top,3:center}；
      // 同轨非字幕文字按 35px/条堆叠（导出 offset_y 语义）
      const isCaptionClip = track.kind === 'caption' || clip.kind === 'caption';
      const stackIndex = track.clips
        .slice(0, track.clips.indexOf(clip))
        .filter((c) => (c.kind === 'text' || c.kind === 'caption') && !c.metadata?.position)
        .length;
      const layout = textLayout({
        position: (clip.metadata?.position as string) ?? (clip.metadata?.style as { position?: string } | undefined)?.position ?? null,
        textAlign: clip.text_align,
        isCaption: isCaptionClip,
        stackIndex,
        fontSize,
        fw,
        fh,
        trackIndex: track.index,
      });
      ctx.textAlign = layout.align;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = clip.font_color || '#FFFFFF';
      const baseY = fy + layout.y;
      const baseX = fx + layout.x;
      const maxWidth = fw * 0.9;
      // Apply position offset + rotation about the text anchor
      ctx.save();
      ctx.translate(baseX + tf.x * fw, baseY + tf.y * fh);
      if (tf.rotation !== 0) ctx.rotate((tf.rotation * Math.PI) / 180);

      // Drop shadow (from style fields)
      const shadowColor = clip.shadow_color || '';
      const shadowX = clip.shadow_x ?? 0;
      const shadowY = clip.shadow_y ?? 0;
      const shadowBlur = clip.shadow_blur ?? 0;
      if (shadowBlur > 0 && shadowColor) {
        ctx.shadowColor = shadowColor;
        ctx.shadowOffsetX = shadowX;
        ctx.shadowOffsetY = shadowY;
        ctx.shadowBlur = shadowBlur;
      }

      // Glow pass — blurred halo rendered behind the glyphs, offsets zeroed
      const glowColor = clip.glow_color || '';
      const glowWidth = clip.glow_width ?? 0;
      if (glowWidth > 0 && glowColor) {
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowBlur = glowWidth;
        ctx.fillText(text, 0, 0, maxWidth);
        ctx.restore();
      }

      // Stroke before fill so the fill covers the inner half of the outline.
      // X3: 导出 borderw 为纯外侧描边；canvas 居中描边可见宽度=lineWidth/2，
      // 故预览 lineWidth 取 2×stroke_width 才与导出视觉一致。
      const strokeColor = clip.stroke_color || '#000000';
      const strokeWidth = clip.stroke_width ?? 0;
      if (strokeWidth > 0 && strokeColor) {
        ctx.lineWidth = strokeWidth * 2;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = strokeColor;
        ctx.strokeText(text, 0, 0, maxWidth);
      }
      ctx.fillText(text, 0, 0, maxWidth);
      ctx.restore();

      if (hasLetterSpacing && letterSpacingPx !== 0) {
        (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
      }
      ctx.textAlign = 'left';
      return true;
    }
    case 'animation': {
      // ── devplan T2.3：有 MG spec 就**真渲染**（前端 display-list），否则退回占位形 ──
      // 为什么要走这条路：时间线里每个 animation clip 的 `metadata.mg_def` 就存着
      // 结构化 spec（后端 `mg/generator.py` 产物），浏览器完全可以直接画；
      // 旧的"脉冲占位形 + 未渲染预览"是能力缺口，不是设计意图。
      const spec = mgSpecOf(clip.metadata);
      if (spec) {
        const mgFidelity = emptyFidelity();
        // clip-local 时间（吃 clip.speed 与 source_offset，与视频层同一套换算）
        const specLocal = Math.max(0, (t - clip.start_sec) * speed + clip.source_offset_sec);
        ctx.save();
        ctx.globalAlpha = clamp(env.opacity, 0, 1);
        if (tf.rotation !== 0) {
          ctx.translate(fx + fw / 2, fy + fh / 2);
          ctx.rotate((tf.rotation * Math.PI) / 180);
          ctx.translate(-(fx + fw / 2), -(fy + fh / 2));
        }
        drawMgFrame(ctx, spec, specLocal, { x: fx, y: fy, w: fw, h: fh }, mgFidelity);
        ctx.restore();
        reportMgFidelity(clip.asset_id, mgFidelity);
        return false; // 时间相关 → 不入层缓存
      }
      // 无 spec：保留占位形（旧行为），并明确标注"未渲染预览"，不伪装成真实效果
      const cx = fx + fw / 2 + tf.x * fw;
      const cy = fy + fh / 2 + tf.y * fh;
      const pulse = clip.keyframes.length > 0 ? 1 : 0.8 + 0.2 * Math.sin(localT * Math.PI * 2);
      const size = (fh * 0.15) * tf.scale * pulse;
      const shape = (typeof clip.metadata?.shape === 'string' && clip.metadata.shape) || clip.shape || 'rect';
      ctx.save();
      ctx.globalAlpha = clamp(env.opacity, 0, 1) * 0.85;
      ctx.translate(cx, cy);
      // 轮76：占位形状不是真实 MG/动画渲染结果——加「未渲染预览」标注，
      // 避免用户把脉冲占位形误当成成片效果（渲染后才由 Hyperframes 出图）
      ctx.font = "500 12px 'Inter','Noto Sans SC',sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const badge = '未渲染预览';
      const badgeW = ctx.measureText(badge).width + 12;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-badgeW / 2, size + 8, badgeW, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(badge, 0, size + 11);
      if (tf.rotation !== 0) ctx.rotate((tf.rotation * Math.PI) / 180);
      ctx.fillStyle = color;
      ctx.beginPath();
      if (shape === 'ellipse' || shape === 'circle') {
        ctx.arc(0, 0, size, 0, Math.PI * 2);
      } else {
        // 默认圆角矩形
        const rr = Math.min(size, fw * 0.05);
        ctx.moveTo(-size + rr, -size);
        ctx.arcTo(size, -size, size, size, rr);
        ctx.arcTo(size, size, -size, size, rr);
        ctx.arcTo(-size, size, -size, -size, rr);
        ctx.arcTo(-size, -size, size, -size, rr);
        ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
      reportMgFidelity(clip.asset_id, { ...emptyFidelity(), missingSpec: true });
      return false; // 时间相关（正弦脉冲）+ 自带 alpha → 不入缓存
    }
    case 'shape': {
      ctx.fillStyle = clip.fill || color;
      ctx.fillRect(fx + fw * 0.3, fy + fh * 0.3, fw * 0.4, fh * 0.4);
      return true;
    }
    default:
      return false; // audio etc. not drawn to video frame
  }
}

/** 哪些轨道的内容适合进层缓存（内容只依赖缓存键里的输入） */
function isCacheableTrack(track: Track): boolean {
  return track.kind === 'video' || track.kind === 'image'
    || track.kind === 'text' || track.kind === 'caption' || track.kind === 'shape';
}

/**
 * P-04（PRD §2 P2）：取片段在时刻 t 的**插值后**变换。
 *
 * 旧实现手柄用 `getClipTransform`（静态 metadata），画面却用关键帧插值后的
 * tf → 带位置/缩放关键帧的片段，手柄框停在原位、画面在别处。渲染（drawClipToPreview）
 * 与手柄（drawTransformOverlay）必须用同一个插值结果。
 */
function interpolatedTransformAt(clip: Clip, t: number): Transform2D {
  const localT = clip.duration_sec > 0 ? (t - clip.start_sec) / clip.duration_sec : 0;
  const tf: Transform2D = { ...getClipTransform(clip) };
  const kfs = Array.isArray(clip.keyframes) ? clip.keyframes : [];
  if (kfs.length > 0) {
    const props = interpolateProperties(kfs, localT);
    tf.scale = props.scale ?? tf.scale;
    tf.x = props.position_x ?? tf.x;
    tf.y = props.position_y ?? tf.y;
    tf.rotation = props.rotation ?? tf.rotation;
  }
  return tf;
}

/**
 * 绘制变换手柄与吸附参考线（O-变换手柄）。
 *
 * 只在"选中了 video/image 片段、且播放头落在该片段内、预览未播放"时显示——
 * 播放中画手柄会跟着抖，也容易误拖。
 */
function drawTransformOverlay(
  ctx: CanvasRenderingContext2D,
  timeline: Timeline,
  t: number,
  frame: FrameRect,
  selectedClipIds: string[],
  guides: SnapGuide[],
) {
  const id = selectedClipIds[0];
  if (!id) return;
  let target: Clip | null = null;
  for (const track of timeline.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.id !== id) continue;
      if (clip.kind !== 'video' && clip.kind !== 'image') return;
      if (t < clip.start_sec || t >= clip.start_sec + clip.duration_sec) return;
      target = clip;
    }
  }
  if (!target) return;

  // P-04：手柄用与画面渲染相同的插值变换
  const layout = transformHandleLayout(frame, interpolatedTransformAt(target, t));

  // 吸附参考线（先画，手柄压在上面）
  if (guides.length > 0) {
    ctx.save();
    ctx.strokeStyle = '#34D399';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const guide of guides) {
      ctx.beginPath();
      if (guide.axis === 'v') {
        ctx.moveTo(guide.at + 0.5, frame.fy);
        ctx.lineTo(guide.at + 0.5, frame.fy + frame.fh);
      } else {
        ctx.moveTo(frame.fx, guide.at + 0.5);
        ctx.lineTo(frame.fx + frame.fw, guide.at + 0.5);
      }
      ctx.stroke();
      ctx.fillStyle = '#34D399';
      ctx.font = "500 11px 'Inter','Noto Sans SC',sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      if (guide.axis === 'v') ctx.fillText(guide.label, guide.at + 4, frame.fy + frame.fh - 4);
      else ctx.fillText(guide.label, frame.fx + 4, guide.at - 3);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 元素轮廓（旋转后的四边形）
  ctx.save();
  ctx.strokeStyle = '#4F8CFF';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  layout.corners.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();

  // 旋转手柄的连线
  const rotateHandle = layout.handles.find((h) => h.anchor === 'rotate');
  const topMid = [(layout.corners[0][0] + layout.corners[1][0]) / 2, (layout.corners[0][1] + layout.corners[1][1]) / 2];
  if (rotateHandle) {
    ctx.beginPath();
    ctx.moveTo(topMid[0], topMid[1]);
    ctx.lineTo(rotateHandle.x, rotateHandle.y);
    ctx.stroke();
  }

  // 手柄
  for (const handle of layout.handles) {
    ctx.beginPath();
    if (handle.anchor === 'rotate') {
      ctx.fillStyle = '#34D399';
      ctx.arc(handle.x, handle.y, 5, 0, Math.PI * 2);
    } else {
      ctx.fillStyle = '#4F8CFF';
      ctx.rect(handle.x - 5, handle.y - 5, 10, 10);
    }
    ctx.fill();
    ctx.strokeStyle = '#0E101A';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 预览保真度角标（O-特效预览还原度）。
 *
 * 选中片段带"导出有/预览没有"或"预览有/导出没有"的特性时，在预览区角上标出来——
 * 用户不会误以为"预览什么样、成片就什么样"。
 */
function FidelityBadges() {
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds);
  const timeline = useTimelineStore((s) => s.timeline);
  const clip = useMemo(() => {
    const id = selectedClipIds[0];
    if (!id) return null;
    for (const track of timeline.tracks) {
      for (const c of track.clips) if (c.id === id) return c;
    }
    return null;
  }, [selectedClipIds, timeline]);
  const badges = useMemo(() => fidelityBadges(clip), [clip]);
  if (badges.length === 0) return null;
  return (
    <div className="absolute right-2 top-2 z-30 flex flex-col items-end gap-1 pointer-events-none"
         data-testid="fidelity-badges">
      {badges.map((text) => (
        <span key={text}
          className="rounded-cw-xs border border-warn/40 bg-surface-dim/85 px-1.5 py-0.5 text-caption text-warn backdrop-blur">
          {text}
        </span>
      ))}
    </div>
  );
}

/** 预览循环时钟（performance.now 优先） */
function perfNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * 媒体版本号（模块级）：素材注册/加载/报错时自增。
 *
 * 预览 effect 里的局部计数器只负责「要不要重绘」；**缓存键**必须看这个全局版本，
 * 否则素材重新加载后旧帧仍会被命中（画面停在过时的帧上）。
 */
let previewMediaVersion = 0;

/** 素材状态变化时递增媒体版本（供缓存键失效） */
export function bumpPreviewMediaVersion(): number {
  previewMediaVersion += 1;
  return previewMediaVersion;
}

/** 当前媒体版本（诊断/测试用） */
export function getPreviewMediaVersion(): number {
  return previewMediaVersion;
}

function drawClipToPreview(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  track: Track,
  fx: number, fy: number, fw: number, fh: number,
  t: number,
  dpr = 1,
  perf?: FramePerf,
  /** 是否连续播放（devplan T1.4）：播放中不 seek，只画元素当前已解码帧 */
  playing = false,
) {
  const localT = (t - clip.start_sec) / clip.duration_sec; // 0-1
  const color = TRACK_COLORS[track.kind] ?? '#4F8CFF';

  // Apply keyframe interpolation for opacity/transform if present
  let opacity = clip.opacity;
  const tf: Transform2D = { ...getClipTransform(clip) };
  let speed = clip.speed;
  if (clip.keyframes.length > 0) {
    const props = interpolateProperties(clip.keyframes, localT);
    opacity = props.opacity ?? opacity;
    tf.scale = props.scale ?? tf.scale;
    tf.x = props.position_x ?? tf.x;
    tf.y = props.position_y ?? tf.y;
    tf.rotation = props.rotation ?? tf.rotation;
    // M5: 时间重映射 — 关键帧驱动的变速（预览层）
    if (props.speed !== undefined) speed = props.speed;
  }

  // M11: 转场可见性 — 在进/出转场窗口内对透明度做渐变（淡入淡出/溶解类预览）
  opacity = applyTransitionAlpha(opacity, clip, localT);

  // O-特效预览还原度：静态图 Ken Burns 缓慢推近。
  // 与导出对齐：ffmpeg `zoompan=z='min(1+0.10/frames*on, 1.10)'` 即从 1.0 线性到 1.10，
  // 预览按 clip 内进度做同样的线性放大（此前预览完全没有这个推近，看着"导出才有动效"）。
  if (clip.kind === 'image' && (clip.metadata as { kenburns?: boolean } | undefined)?.kenburns !== false) {
    const zoom = 1 + 0.10 * Math.min(1, Math.max(0, localT));
    tf.scale *= zoom;
  }

  // O6: resolve 阶段——素材查找单独计时（缓存命中时这段整块被跳过，正是收益来源）
  const resolveStart = perfNow();
  const entry = mediaManager.get(clip.asset_id);
  if (perf) {
    perf.resolveMs += perfNow() - resolveStart;
    perf.layers += 1;
  }

  const env: ClipPaintEnv = { tf, localT, speed, color, opacity, entry, perf, now: perfNow, playing };

  ctx.save();
  ctx.globalAlpha = clamp(opacity, 0, 1);
  if (clip.blend_mode && clip.blend_mode !== 'normal') {
    (ctx as CanvasRenderingContext2D).globalCompositeOperation = clip.blend_mode as GlobalCompositeOperation;
  }

  // 轮76：几何转场（slide 位移 / wipe 擦除）——与 alpha 路径互斥
  const geo = transitionGeometry(clip, localT, fw, fh);
  if (geo.clipW !== null) {
    ctx.beginPath();
    ctx.rect(fx, fy, Math.max(0, geo.clipW), fh);
    ctx.clip();
  }
  if (geo.dx) ctx.translate(geo.dx, 0);

  // M4: 蒙版 — 裁剪到矩形/椭圆内
  applyMaskClip(ctx, clip, fx, fy, fw, fh);

  const fxStr = buildFilter(clip);
  if (fxStr) {
    ctx.filter = fxStr;
  }

  if (isCacheableTrack(track)) {
    // O6：内容层缓存。缓存键必须覆盖一切影响像素的输入：
    // 素材/源帧号/媒体版本（素材重新加载自动失效）、几何（面板尺寸与缩放）、变换、文字样式。
    // 视频按**源帧号**量化（时间线 fps）——播放头在同一帧内移动（60Hz rAF 跑 30fps 时间线）时命中。
    const sourceFps = (clip.metadata?.source_fps as number | undefined) || 30;
    const sourceFrame = track.kind === 'video' && entry?.videoEl
      ? secondsToFrame((t - clip.start_sec) * speed + clip.source_offset_sec, sourceFps)
      : -1;
    const key = contentKey('media', [
      track.kind, clip.asset_id, clip.id, sourceFrame, previewMediaVersion,
      quantize(fx, 1), quantize(fy, 1), quantize(fw, 1), quantize(fh, 1), quantize(dpr, 2),
      quantize(tf.x), quantize(tf.y), quantize(tf.scale), quantize(tf.rotation),
      clip.text ?? '', clip.font ?? '', clip.font_size ?? '', clip.font_weight ?? '',
      clip.font_italic ? 1 : 0, clip.letter_spacing ?? 0, clip.font_color ?? '',
      clip.text_align ?? '', clip.stroke_width ?? 0, clip.stroke_color ?? '',
      clip.shadow_blur ?? 0, clip.shadow_color ?? '', clip.shadow_x ?? 0, clip.shadow_y ?? 0,
      clip.glow_width ?? 0, clip.glow_color ?? '', clip.fill ?? '',
      (clip.metadata?.position as string) ?? '', (clip.metadata?.shape as string) ?? clip.shape ?? '',
      clip.kind,
    ]);
    const painted = getPreviewLayerCache().draw(
      ctx, key, { x: fx, y: fy, w: fw, h: fh }, dpr,
      (layerCtx) => paintClipContent(layerCtx, clip, track, fx, fy, fw, fh, t, env),
    );
    if (perf) {
      if (painted.hit) perf.cacheHits += 1; else perf.cacheMisses += 1;
    }
  } else {
    paintClipContent(ctx, clip, track, fx, fy, fw, fh, t, env);
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

/**
 * C1: 画布双击命中测试 — 返回 playhead 处、命中框内最顶层的 text/caption 片段。
 * 命中框以文本锚点为中心：左右 fw*0.45、上下 fh*0.3。
 */
export function hitTestTextClipForEdit(
  px: number, py: number,
  frame: FrameRect,
  tracks: Track[],
  t: number,
): { clip: Clip; x: number; y: number } | null {
  const sorted = orderTracksForComposite(tracks).slice().reverse();
  for (const track of sorted) {
    if (track.hidden) continue;
    if (track.kind !== 'text' && track.kind !== 'caption') continue;
    const clip = track.clips.find((c) => t >= c.start_sec && t < c.start_sec + c.duration_sec && c.enabled !== false);
    if (!clip) continue;
    // X3: 命中框锚点与渲染层 textLayout 一致（position/轨序/堆叠语义）
    const stackIndex = track.clips
      .slice(0, track.clips.indexOf(clip))
      .filter((c) => (c.kind === 'text' || c.kind === 'caption') && !c.metadata?.position)
      .length;
    const layout = textLayout({
      position: (clip.metadata?.position as string) ?? (clip.metadata?.style as { position?: string } | undefined)?.position ?? null,
      textAlign: clip.text_align,
      isCaption: track.kind === 'caption' || clip.kind === 'caption',
      stackIndex,
      fontSize: captionFontSize(clip.font_size ?? 48, frame.fw, frame.fh, 1),
      fw: frame.fw,
      fh: frame.fh,
      trackIndex: track.index,
    });
    const tf = getClipTransform(clip);
    const ax = frame.fx + layout.x + tf.x * frame.fw;
    const ay = frame.fy + layout.y + tf.y * frame.fh;
    if (Math.abs(px - ax) < frame.fw * 0.45 && Math.abs(py - ay) < frame.fh * 0.3) {
      return { clip, x: ax, y: ay };
    }
  }
  return null;
}

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
 * Build a canvas-safe font-family token from a single family name.
 * Multi-word families (e.g. "Noto Sans SC") must be quoted; null → default stack.
 */
function quoteFontFamily(family: string | null | undefined): string {
  if (!family) return "'Noto Sans SC','PingFang SC',sans-serif";
  if (/^['"]/.test(family)) return family; // already quoted / a full stack
  return family.includes(' ') ? `'${family}'` : family;
}

/**
 * Draw a "素材加载失败" placeholder for media that failed to load (entry.error).
 * Dark box + centered label — deliberately minimal (fillRect + fillText).
 */
function drawErrorPlaceholder(
  ctx: CanvasRenderingContext2D,
  fx: number, fy: number, fw: number, fh: number,
) {
  ctx.fillStyle = '#16181F';
  ctx.fillRect(fx, fy, fw, fh);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = "500 14px 'Inter','Noto Sans SC',sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('素材加载失败', fx + fw / 2, fy + fh / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
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
  // Clip to the frame rect so scaled/offset/rotated media doesn't bleed into the letterbox
  ctx.beginPath();
  ctx.rect(fx, fy, fw, fh);
  ctx.clip();
  ctx.translate(centerX + tf.x * fw, centerY + tf.y * fh);
  if (tf.rotation !== 0) ctx.rotate((tf.rotation * Math.PI) / 180);
  try {
    ctx.drawImage(src, cx, cy, cw, ch, -dw / 2, -dh / 2, dw, dh);
  } catch { /* frame not ready */ }
  ctx.restore();
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

/**
 * P-07（PRD §2 P2）：全屏内的迷你控制条（仅全屏时显示，悬停出现）。
 * 提供 播放/暂停、静音、退出全屏、时间码——全屏 wrapRef 只含画布区域，
 * 头部工具栏不在其中，旧实现全屏后没有任何控件。
 */
function FullscreenMiniBar() {
  const isFullscreen = usePreviewStore((s) => s.isFullscreen);
  const isPlaying = usePreviewStore((s) => s.isPlaying);
  const isMuted = usePreviewStore((s) => s.isMuted);
  const toggleMute = usePreviewStore((s) => s.toggleMute);
  const setFullscreen = usePreviewStore((s) => s.setFullscreen);
  const timeline = useTimelineStore((s) => s.timeline);
  const currentTimeSec = usePreviewStore((s) => s.currentTimeSec);
  if (!isFullscreen) return null;
  return (
    <div
      data-testid="fullscreen-mini-bar"
      className="absolute left-1/2 -translate-x-1/2 bottom-3 z-30 flex items-center gap-2 px-3 py-1.5
        rounded-cw-md bg-black/70 text-white backdrop-blur-sm opacity-0 group-hover/preview:opacity-100
        transition-opacity duration-short3"
    >
      <button
        type="button"
        aria-label={isPlaying ? '暂停' : '播放'}
        onClick={() => usePreviewStore.getState().togglePlay()}
        className="p-1 hover:text-primary cursor-pointer"
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button
        type="button"
        aria-label={isMuted ? '取消静音' : '静音'}
        onClick={toggleMute}
        className="p-1 hover:text-primary cursor-pointer"
      >
        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>
      <span className="font-mono text-caption tabular-nums">
        {formatTimecode(currentTimeSec, timeline.fps)}
      </span>
      <button
        type="button"
        aria-label="退出全屏"
        onClick={() => {
          try { void document.exitFullscreen?.(); } catch { /* ignore */ }
          setFullscreen(false);
        }}
        className="p-1 hover:text-primary cursor-pointer"
      >
        <Minimize className="w-4 h-4" />
      </button>
    </div>
  );
}

function AudioLevelMeter() {
  const canvasRef = useRef2<HTMLCanvasElement>(null);
  const rafRef = useRef2(0);
  // P-08（PRD §2 P3）：暂停/静音时降频到 500ms（电平表无输入，全速 rAF 是浪费）；
  // 播放中保持每帧。isPlaying 从 store 读取（小组件独立订阅，不影响整树）。
  const isPlaying = usePreviewStore((s) => s.isPlaying);

  useEffect2(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
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
    };

    if (isPlaying) {
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        draw();
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    }
    // 静止态：500ms 一次（衰减到零之后画面不再变化，成本低）
    draw();
    const iv = setInterval(draw, 500);
    return () => clearInterval(iv);
  }, [isPlaying]);

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

/**
 * 播放速度循环：从 speeds 列表中选择下一个档位。
 * 若当前值不在列表中（例如来自其他路径的自定义速度），从头档开始。
 * Advance the play-speed cycle: pick the next entry in `speeds`.
 * If `current` is not present (a custom value from another path), start from speeds[0].
 * Empty list → return `current` unchanged (graceful no-op).
 */
export function nextPlaybackSpeed(current: number, speeds: number[]): number {
  if (speeds.length === 0) return current;
  const idx = speeds.indexOf(current);
  const nextIndex = idx === -1 ? 0 : (idx + 1) % speeds.length;
  return speeds[nextIndex];
}









