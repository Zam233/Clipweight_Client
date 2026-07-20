import { useSelectionStore } from '@/stores/selectionStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useHistoryStore } from '@/stores/historyStore';
import { Slider, Badge } from '@/components/ui';
import { TRACK_COLORS } from '@/types/timeline';
import type { Clip } from '@/types/timeline';
import { SlidersHorizontal, Type, Film, Music, Diamond } from 'lucide-react';

/**
 * PropertiesPanel — inspects and edits the selected clip's attributes.
 */
export function PropertiesPanel() {
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds);
  const timeline = useTimelineStore((s) => s.timeline);
  const updateClip = useTimelineStore((s) => s.updateClip);

  // Resolve first selected clip
  let clip: Clip | null = null;
  let trackKind = 'video';
  if (selectedClipIds.length > 0) {
    outer: for (const track of timeline.tracks) {
      for (const c of track.clips) {
        if (c.id === selectedClipIds[0]) {
          clip = c;
          trackKind = track.kind;
          break outer;
        }
      }
    }
  }

  const pushHistory = () =>
    useHistoryStore.getState().pushState(useTimelineStore.getState().timeline, 'property');

  const set = (updates: Partial<Clip>) => {
    if (clip) updateClip(clip.id, updates);
  };

  const color = TRACK_COLORS[trackKind as keyof typeof TRACK_COLORS] ?? '#4F8CFF';

  return (
    <div className="flex flex-col h-full bg-surface-container-low">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/30 shrink-0">
        <SlidersHorizontal className="w-4 h-4 text-on-surface-variant" />
        <span className="text-label font-medium text-on-surface-variant uppercase tracking-wide">
          属性
        </span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {!clip ? (
          <NoSelection />
        ) : (
          <div className="p-3 space-y-4">
            {/* Clip identity */}
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-cw-full shrink-0" style={{ background: color }} />
              <div className="flex-1 min-w-0">
                <p className="text-body-sm font-medium text-on-surface truncate">
                  {clipLabel(clip, trackKind)}
                </p>
                <p className="text-caption text-on-surface-variant font-mono">{clip.id}</p>
              </div>
              <Badge variant="info">{trackKind}</Badge>
            </div>

            {/* Timing */}
            <Section title="时间">
              <Row label="起点 (s)">
                <NumberInput value={round2(clip.start_sec)} onChange={(v) => { pushHistory(); set({ start_sec: Math.max(0, v) }); }} />
              </Row>
              <Row label="时长 (s)">
                <NumberInput value={round2(clip.duration_sec)} onChange={(v) => { pushHistory(); set({ duration_sec: Math.max(0.1, v) }); }} />
              </Row>
              <Row label="素材偏移 (s)">
                <NumberInput value={round2(clip.source_offset_sec)} onChange={(v) => { pushHistory(); set({ source_offset_sec: Math.max(0, v) }); }} />
              </Row>
            </Section>

            {/* Playback */}
            <Section title="播放">
              <Slider label="速度" min={0.25} max={4} step={0.25} value={clip.speed}
                onChange={(v) => { pushHistory(); set({ speed: v }); }} />
              <Slider label="音量" min={0} max={1} step={0.05} value={round2(clip.volume)}
                onChange={(v) => { pushHistory(); set({ volume: v }); }} />
              <Slider label="不透明度" min={0} max={1} step={0.05} value={round2(clip.opacity)}
                onChange={(v) => { pushHistory(); set({ opacity: v }); }} />
            </Section>

            {/* Text properties */}
            {(trackKind === 'text' || trackKind === 'caption') && (
              <Section title="文字" icon={<Type className="w-3 h-3" />}>
                <Row label="内容">
                  <textarea
                    value={clip.text ?? ''}
                    onChange={(e) => set({ text: e.target.value })}
                    rows={2}
                    className="w-full bg-surface-container rounded-cw-xs px-2 py-1.5 text-body-sm text-on-surface
                      outline-none border border-outline-variant/30 focus:border-primary resize-none"
                  />
                </Row>
                <Row label="字号">
                  <NumberInput value={clip.font_size ?? 48} onChange={(v) => { pushHistory(); set({ font_size: Math.max(8, v) }); }} />
                </Row>
                <Row label="颜色">
                  <input
                    type="color"
                    value={clip.font_color ?? '#FFFFFF'}
                    onChange={(e) => { pushHistory(); set({ font_color: e.target.value }); }}
                    className="w-8 h-7 rounded-cw-xs border border-outline-variant/40 bg-transparent cursor-pointer"
                  />
                </Row>
              </Section>
            )}

            {/* Transitions */}
            <Section title="转场">
              <Row label="入场">
                <TransitionSelect value={clip.transition_in ?? ''} onChange={(v) => { pushHistory(); set({ transition_in: v || null }); }} />
              </Row>
              <Row label="出场">
                <TransitionSelect value={clip.transition_out ?? ''} onChange={(v) => { pushHistory(); set({ transition_out: v || null }); }} />
              </Row>
              {clip.transition_in && (
                <Slider label="转场时长" min={0.1} max={2} step={0.1} value={round2(clip.transition_duration_sec ?? 0.5)}
                  onChange={(v) => { pushHistory(); set({ transition_duration_sec: v }); }} />
              )}
            </Section>

            {/* Keyframes */}
            <Section title="关键帧" icon={<Diamond className="w-3 h-3" />}>
              {clip.keyframes.length === 0 ? (
                <p className="text-label-sm text-on-surface-variant">无关键帧。在属性值旁点击菱形添加。</p>
              ) : (
                <div className="space-y-1">
                  {clip.keyframes.map((kf, i) => (
                    <div key={i} className="flex items-center gap-2 text-label-sm font-mono text-on-surface-variant bg-surface-container rounded-cw-xs px-2 py-1">
                      <Diamond className="w-3 h-3 text-keyframe-dot" />
                      <span>t={kf.time.toFixed(2)}</span>
                      <span className="truncate flex-1">{Object.entries(kf.properties).map(([k, v]) => `${k}:${v}`).join(' ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}
      </div>

      {selectedClipIds.length > 1 && (
        <div className="px-3 py-2 border-t border-outline-variant/30 text-label-sm text-on-surface-variant shrink-0">
          已选择 {selectedClipIds.length} 个片段（显示第一个）
        </div>
      )}
    </div>
  );
}

function NoSelection() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="w-12 h-12 rounded-cw-full bg-surface-container flex items-center justify-center mb-3">
        <SlidersHorizontal className="w-5 h-5 text-on-surface-variant/50" />
      </div>
      <p className="text-body-sm text-on-surface font-medium mb-1">未选择片段</p>
      <p className="text-label-sm text-on-surface-variant leading-relaxed">
        在时间轴上点击任意片段，即可在此查看和编辑其属性。
      </p>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-label font-medium text-on-surface-variant uppercase tracking-wide mb-2">
        {icon}
        {title}
      </h3>
      <div className="space-y-2 bg-surface-container/50 rounded-cw-sm p-2.5 border border-outline-variant/20">
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-label text-on-surface-variant whitespace-nowrap">{label}</span>
      <div className="flex items-center gap-1 flex-1 justify-end">{children}</div>
    </div>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      step={0.1}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-20 bg-surface-container rounded-cw-xs px-2 py-1 text-body-sm font-mono text-on-surface
        outline-none border border-outline-variant/30 focus:border-primary text-right"
    />
  );
}

const TRANSITIONS = ['', 'hard_cut', 'fade', 'dissolve', 'glitch', 'pixel_dissolve', 'slide', 'wipe'];
function TransitionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-28 bg-surface-container rounded-cw-xs px-2 py-1 text-body-sm text-on-surface
        outline-none border border-outline-variant/30 focus:border-primary cursor-pointer"
    >
      {TRANSITIONS.map((t) => (
        <option key={t} value={t}>{t === '' ? '无' : t}</option>
      ))}
    </select>
  );
}

function clipLabel(clip: Clip, kind: string): string {
  if ((kind === 'text' || kind === 'caption') && clip.text) return clip.text;
  if (clip.metadata && typeof clip.metadata.title === 'string') return clip.metadata.title as string;
  if (clip.asset_id) return clip.asset_id;
  return kind;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
