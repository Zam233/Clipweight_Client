import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useTimelineStore } from '@/stores/timelineStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useOverlayStore } from './overlayStore';
import { buildOverlayPlan } from './mgDomPlan';
import { overlayEligibility } from './overlayEligibility';
import { transformCss, has3D } from './mgLayout';
import { mgSpecOf, resolveElementProps } from '../mgRenderer';
import { computePreviewFrameRect, type FrameRect } from '../frameGeometry';
import { useProjectStore } from '@/stores/projectStore';
import { isMotionSpec3DEnabled } from '@/features/textMotion/rollout';
import { verdictForClip } from './fidelity';

function propsOfElement(el: Record<string, unknown>, local: number): Record<string, unknown> {
  // resolveElementProps returns interpolated numbers; add element static values.
  const f = { unsupportedTypes: [], blockedResources: [], unknownEasings: [], missingSpec: false, unsupportedProps: [], approxProps: [] };
  return { ...el, ...resolveElementProps(el as never, local, f as never) };
}

export function MotionSpecOverlay({ wrapRef }: { wrapRef: RefObject<HTMLDivElement | null> }) {
  const timeline = useTimelineStore((s) => s.timeline);
  const projectId = useProjectStore((s) => s.projectId);
  const enabled = isMotionSpec3DEnabled(projectId);
  const t = usePreviewStore((s) => s.currentTimeSec);
  const playing = usePreviewStore((s) => s.isPlaying);
  const zoom = usePreviewStore((s) => s.zoomLevel);
  const [frame, setFrame] = useState<FrameRect | null>(null);
  const requestOverlay = useOverlayStore((s) => s.requestOverlay);
  const releaseOverlay = useOverlayStore((s) => s.releaseOverlay);
  const generation = useOverlayStore((s) => s.generation);
  const canvasGeneration = useOverlayStore((s) => s.canvasGeneration);
  const stageKey = useRef('');
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const animsRef = useRef<Array<{ a: Animation; clipId: string; start: number; speed: number; offset: number }>>([]);
  useEffect(() => {
    if (!enabled || !wrapRef.current) return;
    const update = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      setFrame(computePreviewFrameRect(rect.width, rect.height, timeline.width, timeline.height, zoom));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [enabled, timeline.width, timeline.height, zoom, wrapRef]);

  const active = useMemo(() => {
    if (!enabled || playing) return [];
    return timeline.tracks
      .filter((tr) => tr.kind === 'text' && !tr.hidden)
      .flatMap((tr) => tr.clips.map((c) => ({ c, tr })))
      .filter(({ c, tr }) => overlayEligibility(c, tr, t, playing).ok)
      .map(({ c }) => c)
      .filter((c) => {
        const spec = mgSpecOf(c.metadata);
        return !!spec && (spec.elements ?? []).some((el) => (el.keyframes ?? []).some(
          (k) => has3D({ ...el, ...(k.properties as Record<string, unknown>), ...k } as Record<string, unknown>),
        ));
      });
  }, [enabled, timeline, t, playing]);

  const clipIds = active.map((c) => c.id).join('|');
  useEffect(() => {
    if (!clipIds) { releaseOverlay(); return () => {}; }
    requestOverlay(clipIds.split('|'));
    return () => releaseOverlay();
  }, [clipIds, requestOverlay, releaseOverlay]);
  const visible = generation > 0 && canvasGeneration >= generation;

  // WAAPI：暂停态只 seek currentTime，不 play；播放态由 Canvas 接管。
  useEffect(() => {
    animsRef.current.forEach(({ a }) => a.cancel());
    animsRef.current = [];
    if (playing || active.length === 0) return () => {};
    for (const clip of active) {
      const spec = mgSpecOf(clip.metadata);
      if (!spec) continue;
      const plan = buildOverlayPlan(spec as never, {}, { width: timeline.width, height: timeline.height, fps: timeline.fps });
      plan.elements.forEach((pe, i) => {
        const el = nodeRefs.current.get(`${clip.id}-${i}`);
        if (!el || pe.tag === 'img' || typeof el.animate !== 'function') return;
        const frames = pe.keyframes.map((k) => ({
          offset: k.offset,
          transform: `${pe.baseStyle.transform ?? ''} ${k.transform ?? ''}`.trim(),
          opacity: k.opacity ?? '1',
          ...(k.filter ? { filter: k.filter } : {}),
          easing: 'linear',
        }));
        const a = el.animate(frames as Keyframe[], {
          duration: Math.max(1, pe.durationSec * 1000), fill: 'both', easing: 'linear',
        });
        a.pause();
        animsRef.current.push({ a, clipId: clip.id, start: clip.start_sec, speed: clip.speed, offset: clip.source_offset_sec });
      });
    }
    return () => { animsRef.current.forEach(({ a }) => a.cancel()); animsRef.current = []; };
  }, [clipIds, playing, timeline]);

  useEffect(() => {
    for (const it of animsRef.current) {
      const local = Math.max(0, (t - it.start) * it.speed + it.offset);
      try { it.a.currentTime = local * 1000; } catch { /* disposed */ }
    }
  }, [t, active]);

  if (!frame || active.length === 0) return null;
  const u = frame.fw / timeline.width;
  return (
    <div
      data-testid="mg-overlay"
      style={{
        position: 'absolute', left: frame.fx, top: frame.fy, width: frame.fw, height: frame.fh,
        overflow: 'hidden', pointerEvents: 'none', zIndex: 15, isolation: 'isolate',
        visibility: visible ? 'visible' : 'hidden',
      }}
    >
      <div style={{
        position: 'absolute', top: 8, left: 8, zIndex: 20, pointerEvents: 'none',
        background: 'rgba(14,16,26,.72)', color: '#9fd0ff', borderRadius: 4,
        padding: '2px 6px', fontSize: 11,
      }}>
        CSS3D · {verdictForClip(active[0], 'css3d-pause').approx.length ? `近似 (${verdictForClip(active[0], 'css3d-pause').approx.join('/')})` : '精确'}
      </div>
      <div style={{ position: 'absolute', left: 0, top: 0, width: timeline.width, height: timeline.height, transformOrigin: '0 0', transform: `scale(${u})` }}>
        {active.map((clip) => {
          const spec = mgSpecOf(clip.metadata);
          const plan = spec ? buildOverlayPlan(spec as never, {}, { width: timeline.width, height: timeline.height, fps: timeline.fps }) : null;
          if (!spec || !plan) return null;
          const local = Math.max(0, (t - clip.start_sec) * clip.speed + clip.source_offset_sec);
          return (
            <div key={clip.id} style={{ position: 'absolute', inset: 0, opacity: clip.opacity }}>
              {plan.elements.map((pe, i) => {
                const raw = (spec.elements ?? [])[i] as Record<string, unknown>;
                if (!raw) return null;
                const p = propsOfElement(raw, local);
                const tr = transformCss(p);
                const baseTransform = plan.elements[i].baseStyle.transform;
                const style: React.CSSProperties = {
                  ...(plan.elements[i].baseStyle as React.CSSProperties),
                  transform: `${baseTransform ?? ''} ${tr}`.trim(),
                  opacity: Number(p.opacity ?? 1),
                  filter: p.blur !== undefined ? `blur(${Number(p.blur)}px)` : undefined,
                };
                return pe.tag === 'img'
                  ? <img key={`${clip.id}-${i}`} ref={(el) => { if (el) nodeRefs.current.set(`${clip.id}-${i}`, el); }} src={pe.attrs.src} alt="" style={style} />
                  : <div key={`${clip.id}-${i}`} ref={(el) => { if (el) nodeRefs.current.set(`${clip.id}-${i}`, el); }} style={style}>{pe.text}</div>;
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
