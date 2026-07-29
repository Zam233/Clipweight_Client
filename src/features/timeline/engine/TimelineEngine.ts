/**
 * TimelineEngine — Canvas 2D multi-track timeline engine.
 * Manages viewport (zoom/scroll), the render loop, and all pointer interactions
 * (scrub, select, marquee, move, trim, snap, pan).
 */
import type { Track, Clip } from '@/types/timeline';
import { useTimelineStore } from '@/stores/timelineStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useHistoryStore } from '@/stores/historyStore';
import {
  makeLayout, xToTime, yToTrackIndex, timeToX, trackToY,
  makeDragState, scrollbarGeom, MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM, TRIM_HANDLE_PX,
  type TimelineLayout, type DragState,
} from './types';
import {
  drawBackground, drawTrackLanes, drawRuler, drawTrackHeaders,
  drawClip, drawPlayhead, drawMarkers, drawSnapGuide, drawMarquee, drawEmptyState,
  drawHorizontalScrollbar,
} from './renderers';
import { collectSnapTargets, applySnap } from './snap';
import { clamp } from '@/lib/utils';
import { mediaManager } from '@/services/media/mediaManager';

export class TimelineEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;

  // Viewport
  zoom = DEFAULT_ZOOM;
  scrollX = 0;
  scrollY = 0;

  // Interaction
  private drag: DragState = makeDragState();
  private hoveredClipId: string | null = null;
  private hoveredTrackId: string | null = null;
  private scrollbarHover = false;
  markers: number[] = [];

  private rafId = 0;
  private dirty = true;
  private disposed = false;
  private unsubscribers: (() => void)[] = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;

    this.resize();
    this.bindStoreSubscriptions();
    this.bindPointerEvents();
    this.bindWheelEvent();
    this.bindResizeObserver();
    this.loop();
  }

  // ── lifecycle ────────────────────────────────────────
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.unsubscribers.forEach((u) => u());
    this.removePointerEvents();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  requestRender() {
    this.dirty = true;
  }

  resize() {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.clampScroll();
    this.dirty = true;
  }

  private bindResizeObserver() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.disposed) return;
      this.resize();
    });
    this.resizeObserver.observe(parent);
  }

  // ── store subscriptions ──────────────────────────────
  private bindStoreSubscriptions() {
    const mark = () => this.requestRender();
    this.unsubscribers.push(useTimelineStore.subscribe(mark));
    this.unsubscribers.push(useSelectionStore.subscribe(mark));
    this.unsubscribers.push(usePreviewStore.subscribe(mark));
    this.unsubscribers.push(useSettingsStore.subscribe(mark));
    this.unsubscribers.push(mediaManager.onChange(mark));
  }

  private layout(): TimelineLayout {
    return makeLayout(this.cssW, this.cssH, this.zoom, this.scrollX, this.scrollY);
  }

  // ── render loop ──────────────────────────────────────
  private loop = () => {
    if (this.disposed) return;
    if (this.dirty) {
      this.dirty = false;
      try {
        this.render();
      } catch (err) {
        // A single bad frame must never kill the render loop permanently —
        // log it and keep the loop alive so the next frame can recover.
        console.error('[TimelineEngine] render error:', err);
      }
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private render() {
    const { ctx, dpr } = this;
    const L = this.layout();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const timeline = useTimelineStore.getState().timeline;
    const selection = useSelectionStore.getState();
    const playhead = usePreviewStore.getState().currentTimeSec;
    const tracks = timeline.tracks;

    drawBackground(ctx, L);
    drawTrackLanes(ctx, L, tracks, selection.selectedTrackId);

    // Clips (with drag ghosts)
    if (tracks.length === 0) {
      drawEmptyState(ctx, L);
    } else {
      const isMoving = this.drag.mode === 'move-clip';
      for (let i = 0; i < tracks.length; i++) {
        for (const clip of tracks[i].clips) {
          const isDragged = isMoving && this.drag.origClips.has(clip.id);
          if (isDragged) continue; // draw ghosts after, on top
          drawClip(ctx, L, tracks[i], i, clip, {
            selected: selection.selectedClipIds.includes(clip.id),
            hovered: clip.id === this.hoveredClipId,
          });
        }
      }
      // Draw dragged ghosts on top
      if (isMoving) {
        for (const [id, orig] of this.drag.origClips) {
          const track = tracks.find((t) => t.clips.some((c) => c.id === id))
            ?? tracks.find((t) => t.id === orig.track_id);
          if (!track) continue;
          const tIdx = tracks.indexOf(track);
          drawClip(ctx, L, track, tIdx, orig, {
            selected: true,
            hovered: false,
            isDragGhost: true,
            ghostDeltaTime: this.drag.deltaTime,
            ghostDeltaTrack: this.drag.deltaTrack,
          });
        }
      }
      // Trim ghost
      if ((this.drag.mode === 'trim-start' || this.drag.mode === 'trim-end') && this.drag.trimOrig) {
        const orig = this.drag.trimOrig;
        const track = tracks.find((t) => t.id === orig.track_id);
        if (track) {
          const tIdx = tracks.indexOf(track);
          const ghost = this.computeTrimGhost();
          if (ghost) {
            drawClip(ctx, L, track, tIdx, ghost, {
              selected: true, hovered: false, isDragGhost: true,
            });
          }
        }
      }
    }

    drawMarkers(ctx, L, this.markers);
    if (this.drag.snapX !== null) drawSnapGuide(ctx, L, this.drag.snapX);
    if (this.drag.marquee) drawMarquee(ctx, this.drag.marquee);
    drawTrackHeaders(ctx, L, tracks, selection.selectedTrackId, this.hoveredTrackId);
    drawRuler(ctx, L, timeline.fps);
    drawPlayhead(ctx, L, playhead);

    // Horizontal scrollbar — drawn last so it sits on top
    const sbState = this.drag.mode === 'scrollbar' ? 'drag' : this.scrollbarHover ? 'hover' : 'idle';
    drawHorizontalScrollbar(ctx, L, timeline.duration_sec * L.zoom, sbState);
  }

  // ── pointer interactions ─────────────────────────────
  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const L = this.layout();
    const { x, y } = this.localPos(e);
    const timeline = useTimelineStore.getState().timeline;
    const selection = useSelectionStore.getState();
    const preview = usePreviewStore.getState();

    this.drag = makeDragState();
    this.drag.startMouse = { x, y };
    this.drag.startTime = xToTime(x, L);

    // Middle button → pan
    if (e.button === 1) {
      this.drag.mode = 'pan';
      return;
    }

    // Ruler → scrub
    if (y < L.rulerH) {
      this.drag.mode = 'scrub';
      preview.setCurrentTime(Math.max(0, xToTime(x, L)));
      return;
    }

    // Header → select track
    if (x < L.headerW) {
      const tIdx = yToTrackIndex(y, L);
      if (tIdx >= 0 && tIdx < timeline.tracks.length) {
        selection.selectTrack(timeline.tracks[tIdx].id);
      }
      return;
    }

    // Horizontal scrollbar → drag to scroll
    if (y >= L.height - L.scrollbarH && x >= L.headerW) {
      const g = this.hScrollbar();
      if (g.maxX > 0) {
        this.drag.mode = 'scrollbar';
        if (x >= g.thumbX && x <= g.thumbX + g.thumbW) {
          // Grab the thumb directly
          this.drag.scrollbarGrabOffset = x - g.thumbX;
        } else {
          // Click on the track → jump so the thumb centres on the click, then drag
          this.drag.scrollbarGrabOffset = g.thumbW / 2;
          this.applyScrollbarScroll(x);
        }
      }
      return;
    }

    const hit = this.hitTestClip(x, y);

    // Razor tool → split
    if (selection.toolMode === 'razor' && hit) {
      const t = xToTime(x, L);
      useHistoryStore.getState().pushState(timeline, 'split');
      useTimelineStore.getState().splitClip(hit.clip.id, t);
      return;
    }

    if (hit) {
      const { clip, track } = hit;
      // Select
      if (!selection.selectedClipIds.includes(clip.id)) {
        selection.selectClip(clip.id, e.shiftKey);
      } else if (e.shiftKey) {
        selection.selectClip(clip.id, true); // toggle off
        return;
      }
      selection.selectTrack(track.id);

      // Determine move vs trim
      const clipX = timeToX(clip.start_sec, L);
      const clipW = clip.duration_sec * L.zoom;
      const selIds = useSelectionStore.getState().selectedClipIds;

      if (selIds.includes(clip.id) && x - clipX < TRIM_HANDLE_PX) {
        this.drag.mode = 'trim-start';
        this.drag.trimClipId = clip.id;
        this.drag.trimOrig = clip;
        useHistoryStore.getState().pushState(useTimelineStore.getState().timeline, 'trim');
        this.drag.historyPushed = true;
      } else if (selIds.includes(clip.id) && clipX + clipW - x < TRIM_HANDLE_PX) {
        this.drag.mode = 'trim-end';
        this.drag.trimClipId = clip.id;
        this.drag.trimOrig = clip;
        useHistoryStore.getState().pushState(useTimelineStore.getState().timeline, 'trim');
        this.drag.historyPushed = true;
      } else {
        // Begin move for all selected clips
        this.drag.mode = 'move-clip';
        const tl = useTimelineStore.getState().timeline;
        for (const id of useSelectionStore.getState().selectedClipIds) {
          for (const tr of tl.tracks) {
            const c = tr.clips.find((cc) => cc.id === id);
            if (c) this.drag.origClips.set(id, c);
          }
        }
        if (!this.drag.historyPushed) {
          useHistoryStore.getState().pushState(tl, 'move');
          this.drag.historyPushed = true;
        }
      }
    } else {
      // Empty area → marquee
      this.drag.mode = 'marquee';
      this.drag.marquee = { x0: x, y0: y, x1: x, y1: y };
      if (!e.shiftKey) selection.deselectAll();
    }

    this.requestRender();
  };

  private onPointerMove = (e: PointerEvent) => {
    const L = this.layout();
    const { x, y } = this.localPos(e);

    if (this.drag.mode === 'none') {
      this.updateHover(x, y);
      this.updateCursor(x, y);
      return;
    }

    const settings = useSettingsStore.getState();

    switch (this.drag.mode) {
      case 'scrub': {
        usePreviewStore.getState().setCurrentTime(Math.max(0, xToTime(x, L)));
        break;
      }
      case 'pan': {
        const dx = x - this.drag.startMouse.x;
        const dy = y - this.drag.startMouse.y;
        this.scrollX = Math.max(0, this.scrollX - dx);
        this.scrollY = Math.max(0, this.scrollY - dy);
        this.drag.startMouse = { x, y };
        this.clampScroll();
        this.requestRender();
        break;
      }
      case 'scrollbar': {
        this.canvas.style.cursor = 'grabbing';
        this.applyScrollbarScroll(x);
        break;
      }
      case 'marquee': {
        this.drag.marquee = { ...this.drag.marquee!, x1: x, y1: y };
        this.requestRender();
        break;
      }
      case 'move-clip': {
        const rawDelta = xToTime(x, L) - this.drag.startTime;
        const tl = useTimelineStore.getState().timeline;
        const ids = new Set(this.drag.origClips.keys());
        const targets = collectSnapTargets(
          tl.tracks, ids,
          usePreviewStore.getState().currentTimeSec,
          this.markers,
        );
        // Candidate edges = min start and max end of dragged clips
        let minStart = Infinity, maxEnd = -Infinity;
        for (const c of this.drag.origClips.values()) {
          minStart = Math.min(minStart, c.start_sec);
          maxEnd = Math.max(maxEnd, c.start_sec + c.duration_sec);
        }
        const snapped = settings.snapEnabled
          ? applySnap([minStart, maxEnd], rawDelta, targets, L, settings.snapThresholdPx)
          : { deltaTime: rawDelta, snapX: null };

        // Prevent moving before 0
        const minDelta = -minStart;
        this.drag.deltaTime = Math.max(minDelta, snapped.deltaTime);
        this.drag.snapX = snapped.snapX;

        // Vertical track delta
        const startTrackIdx = this.trackIndexOf(this.drag.origClips.values().next().value?.track_id);
        const curTrackIdx = yToTrackIndex(y, L);
        this.drag.deltaTrack = curTrackIdx - startTrackIdx;

        this.requestRender();
        break;
      }
      case 'trim-start':
      case 'trim-end': {
        this.drag.snapX = null;
        this.requestRender();
        break;
      }
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const L = this.layout();
    const { x, y } = this.localPos(e);
    const store = useTimelineStore.getState();

    switch (this.drag.mode) {
      case 'move-clip': {
        const dt = this.drag.deltaTime;
        const dtr = this.drag.deltaTrack;
        if (Math.abs(dt) > 0.001 || dtr !== 0) {
          const tl = store.timeline;
          for (const [id, orig] of this.drag.origClips) {
            let targetTrackId = orig.track_id;
            if (dtr !== 0) {
              const origIdx = this.trackIndexOf(orig.track_id);
              const newIdx = clamp(origIdx + dtr, 0, tl.tracks.length - 1);
              const candidate = tl.tracks[newIdx];
              // Only move across tracks of the same kind
              if (candidate && candidate.kind === tl.tracks[origIdx].kind) {
                targetTrackId = candidate.id;
              }
            }
            store.moveClip(id, targetTrackId, Math.max(0, orig.start_sec + dt));
          }
        }
        break;
      }
      case 'trim-start': {
        const ghost = this.computeTrimGhost();
        if (ghost && this.drag.trimOrig) {
          store.updateClip(this.drag.trimOrig.id, {
            start_sec: ghost.start_sec,
            duration_sec: ghost.duration_sec,
            source_offset_sec: ghost.source_offset_sec,
          });
        }
        break;
      }
      case 'trim-end': {
        const ghost = this.computeTrimGhost();
        if (ghost && this.drag.trimOrig) {
          store.updateClip(this.drag.trimOrig.id, { duration_sec: ghost.duration_sec });
        }
        break;
      }
      case 'marquee': {
        if (this.drag.marquee) {
          const m = this.drag.marquee;
          const t0 = xToTime(Math.min(m.x0, m.x1), L);
          const t1 = xToTime(Math.max(m.x0, m.x1), L);
          const tr0 = yToTrackIndex(Math.min(m.y0, m.y1), L);
          const tr1 = yToTrackIndex(Math.max(m.y0, m.y1), L);
          const tl = store.timeline;
          const trackIds = tl.tracks
            .filter((_, i) => i >= tr0 && i <= tr1)
            .map((t) => t.id);
          useSelectionStore.getState().selectClipsInRange(t0, t1, trackIds);
        }
        break;
      }
    }

    this.drag = makeDragState();
    this.requestRender();
  };

  private computeTrimGhost(): Clip | null {
    const orig = this.drag.trimOrig;
    if (!orig) return null;
    const L = this.layout();
    const { x } = this.lastMouse;
    const t = xToTime(x, L);

    if (this.drag.mode === 'trim-start') {
      const end = orig.start_sec + orig.duration_sec;
      const newStart = clamp(t, 0, end - 0.1);
      const delta = newStart - orig.start_sec;
      return {
        ...orig,
        start_sec: newStart,
        duration_sec: end - newStart,
        source_offset_sec: Math.max(0, orig.source_offset_sec + delta * orig.speed),
      };
    }
    if (this.drag.mode === 'trim-end') {
      const newEnd = Math.max(orig.start_sec + 0.1, t);
      return { ...orig, duration_sec: newEnd - orig.start_sec };
    }
    return null;
  }

  private lastMouse = { x: 0, y: 0 };

  private hitTestClip(x: number, y: number): { clip: Clip; track: Track } | null {
    const L = this.layout();
    const tl = useTimelineStore.getState().timeline;
    const tIdx = yToTrackIndex(y, L);
    if (tIdx < 0 || tIdx >= tl.tracks.length) return null;
    const track = tl.tracks[tIdx];
    if (track.locked) return null;
    const t = xToTime(x, L);
    for (const clip of track.clips) {
      if (t >= clip.start_sec && t <= clip.start_sec + clip.duration_sec) {
        return { clip, track };
      }
    }
    return null;
  }

  private trackIndexOf(trackId?: string): number {
    if (!trackId) return 0;
    const idx = useTimelineStore.getState().timeline.tracks.findIndex((t) => t.id === trackId);
    return idx === -1 ? 0 : idx;
  }

  private updateHover(x: number, y: number) {
    const L = this.layout();
    // Don't highlight clips/tracks while the pointer is over the scrollbar
    if (y >= L.height - L.scrollbarH && x >= L.headerW) {
      if (this.hoveredClipId !== null || this.hoveredTrackId !== null) {
        this.hoveredClipId = null;
        this.hoveredTrackId = null;
        this.requestRender();
      }
      return;
    }
    const hit = this.hitTestClip(x, y);
    const newHover = hit?.clip.id ?? null;
    const tIdx = yToTrackIndex(y, L);
    const tl = useTimelineStore.getState().timeline;
    const newTrackHover = tIdx >= 0 && tIdx < tl.tracks.length ? tl.tracks[tIdx].id : null;

    if (newHover !== this.hoveredClipId || newTrackHover !== this.hoveredTrackId) {
      this.hoveredClipId = newHover;
      this.hoveredTrackId = newTrackHover;
      this.requestRender();
    }
  }

  private updateCursor(x: number, y: number) {
    const L = this.layout();
    // Scrollbar hover → brighten thumb + grab cursor
    const inScrollbar = y >= L.height - L.scrollbarH && x >= L.headerW && this.hScrollbar().maxX > 0;
    if (inScrollbar !== this.scrollbarHover) {
      this.scrollbarHover = inScrollbar;
      this.requestRender();
    }
    if (inScrollbar) {
      this.canvas.style.cursor = 'grab';
      return;
    }
    if (y < L.rulerH) {
      this.canvas.style.cursor = 'text';
      return;
    }
    const hit = this.hitTestClip(x, y);
    if (!hit) {
      this.canvas.style.cursor = 'default';
      return;
    }
    const clipX = timeToX(hit.clip.start_sec, L);
    const clipW = hit.clip.duration_sec * L.zoom;
    if (x - clipX < TRIM_HANDLE_PX || clipX + clipW - x < TRIM_HANDLE_PX) {
      this.canvas.style.cursor = 'ew-resize';
    } else {
      this.canvas.style.cursor = 'grab';
    }
  }

  // ── zoom / scroll ─────────────────────────────────────
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const L = this.layout();
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+wheel → zoom to cursor (README: Ctrl+滚轮=缩放)
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const timeAtCursor = xToTime(x, L);
      this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      this.scrollX = Math.max(0, timeAtCursor * this.zoom - (x - L.headerW));
    } else if (e.shiftKey) {
      // Shift+wheel → horizontal scroll (browser puts delta in deltaX for Shift+wheel)
      const dx = e.deltaX || e.deltaY;
      this.scrollX = Math.max(0, this.scrollX + dx * 3);
    } else {
      // Plain wheel / trackpad pan: deltaX → horizontal, deltaY → vertical.
      // A mouse wheel emits deltaX=0 (vertical only); a trackpad two-finger
      // swipe emits real deltaX/deltaY, so horizontal swipes scroll sideways.
      if (e.deltaX) this.scrollX = Math.max(0, this.scrollX + e.deltaX);
      if (e.deltaY) this.scrollY = Math.max(0, this.scrollY + e.deltaY);
    }
    this.clampScroll();
    this.requestRender();
  };

  private clampScroll() {
    const tl = useTimelineStore.getState().timeline;
    const L = this.layout();
    const maxX = Math.max(0, tl.duration_sec * L.zoom - (L.width - L.headerW));
    const maxY = Math.max(0, tl.tracks.length * L.trackH - (L.height - L.rulerH - L.scrollbarH));
    this.scrollX = clamp(this.scrollX, 0, maxX);
    this.scrollY = clamp(this.scrollY, 0, maxY);
  }

  /** Horizontal scrollbar geometry for the current viewport & timeline. */
  private hScrollbar() {
    const L = this.layout();
    const contentW = useTimelineStore.getState().timeline.duration_sec * L.zoom;
    return scrollbarGeom(L, contentW);
  }

  /** Map a mouse X position to scrollX while dragging the scrollbar thumb. */
  private applyScrollbarScroll(mouseX: number) {
    const g = this.hScrollbar();
    const free = g.trackW - g.thumbW;
    if (free <= 0 || g.maxX <= 0) return;
    const thumbX = mouseX - this.drag.scrollbarGrabOffset - g.trackX;
    this.scrollX = clamp((thumbX / free) * g.maxX, 0, g.maxX);
    this.clampScroll();
    this.requestRender();
  }

  // ── public API ───────────────────────────────────────
  zoomIn() { this.setZoom(this.zoom * 1.3); }
  zoomOut() { this.setZoom(this.zoom / 1.3); }
  zoomToFit(durationSec: number) {
    if (durationSec <= 0) return;
    const L = this.layout();
    const avail = L.width - L.headerW - 40;
    this.setZoom(avail / durationSec);
    this.scrollX = 0;
    this.clampScroll();
  }
  private setZoom(z: number) {
    const L = this.layout();
    const centerTime = xToTime(L.headerW + (L.width - L.headerW) / 2, L);
    this.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.scrollX = Math.max(0, centerTime * this.zoom - (L.width - L.headerW) / 2);
    this.clampScroll();
    this.requestRender();
  }

  addMarkerAtPlayhead() {
    const t = usePreviewStore.getState().currentTimeSec;
    if (!this.markers.some((m) => Math.abs(m - t) < 0.01)) {
      this.markers.push(t);
      this.markers.sort((a, b) => a - b);
      this.requestRender();
    }
  }

  /** Remove the marker nearest to the playhead (within 0.5s). */
  removeMarkerNearest() {
    const t = usePreviewStore.getState().currentTimeSec;
    let bestIdx = -1;
    let bestDist = 0.5;
    this.markers.forEach((m, i) => {
      const d = Math.abs(m - t);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    if (bestIdx >= 0) {
      this.markers.splice(bestIdx, 1);
      this.requestRender();
    }
  }

  clearMarkers() {
    this.markers = [];
    this.requestRender();
  }

  get markerCount() {
    return this.markers.length;
  }

  /**
   * Handle an asset dropped from the asset panel.
   * Computes the drop time/track from canvas coordinates and inserts a clip.
   */
  dropAssetAt(
    canvasX: number,
    canvasY: number,
    asset: { id: string; kind: string; filename: string; duration: number },
  ) {
    const L = this.layout();
    const store = useTimelineStore.getState();
    const dropTime = Math.max(0, xToTime(canvasX, L));
    const dropTrackIdx = yToTrackIndex(canvasY, L);

    const clipKind = asset.kind as import('@/types/timeline').ClipKind;

    // Prefer the dropped-on track if its kind matches; else find/create one
    const tracks = store.timeline.tracks;
    let targetTrack =
      dropTrackIdx >= 0 && dropTrackIdx < tracks.length && tracks[dropTrackIdx].kind === clipKind
        ? tracks[dropTrackIdx]
        : tracks.find((t) => t.kind === clipKind);

    if (!targetTrack) {
      const tid = store.addTrack(clipKind);
      targetTrack = useTimelineStore.getState().timeline.tracks.find((t) => t.id === tid);
    }
    if (!targetTrack) return;

    // Snap drop time to a sensible grid (0.1s)
    const startSec = Math.round(dropTime * 10) / 10;
    useHistoryStore.getState().pushState(store.timeline, 'drop');
    const clipId = store.addClip(targetTrack.id, {
      kind: clipKind,
      asset_id: asset.id,
      start_sec: startSec,
      duration_sec: asset.duration || 5,
      metadata: { title: asset.filename },
    });
    // Select the dropped clip, not just the track
    if (clipId) {
      useSelectionStore.getState().selectClip(clipId);
    } else {
      useSelectionStore.getState().selectTrack(targetTrack.id);
    }
    this.requestRender();
  }

  scrollToPlayhead() {
    const L = this.layout();
    const t = usePreviewStore.getState().currentTimeSec;
    const x = timeToX(t, L);
    if (x < L.headerW || x > L.width) {
      this.scrollX = Math.max(0, t * this.zoom - (L.width - L.headerW) / 3);
      this.clampScroll();
      this.requestRender();
    }
  }

  // ── event binding ────────────────────────────────────
  private localPos(e: PointerEvent | MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.lastMouse = { x, y };
    return { x, y };
  }

  private bindPointerEvents() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
  }
  private removePointerEvents() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
  }
  private bindWheelEvent() {
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }
}
