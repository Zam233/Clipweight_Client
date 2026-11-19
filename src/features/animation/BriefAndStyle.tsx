import type { AnimationContext } from './contextApi';

export function AnimationBriefCard({ ctx }: { ctx: AnimationContext | null }) {
  const brief = (ctx?.blackboard as { brief?: Record<string, unknown> } | undefined)?.brief ?? {};
  const topic = String(brief.topic ?? '');
  const style = String(brief.style_id ?? '');
  const signature = String(brief.signature ?? '');
  const forbidden = Array.isArray(brief.forbidden) ? brief.forbidden.map(String) : [];
  const palette = Array.isArray(brief.palette) ? brief.palette.map(String) : [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
      <div><b>Brief</b></div>
      <div>topic: {topic || '—'}</div>
      <div>style: {style || '—'}</div>
      <div>signature: {signature || '—'}</div>
      <div>palette: {palette.length ? palette.join(' / ') : '—'}</div>
      <div>forbidden: {forbidden.length ? forbidden.join('; ') : '—'}</div>
    </div>
  );
}

export function StyleFramePicker({ frames = [], selectedId = '', onSelect }: { frames?: Array<{ id: string; name: string; palette?: string[] }>; selectedId?: string; onSelect?: (id: string) => void }) {
  if (!frames.length) return <div style={{ opacity: 0.6, fontSize: 12 }}>未请求风格帧；Agent 可按 Brief 直接生成。</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
      {frames.map((f) => (
        <button key={f.id} type="button" onClick={() => onSelect?.(f.id)}
          style={{ border: f.id === selectedId ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,.15)', background: '#0b1220', color: '#fff', borderRadius: 6, padding: 8, cursor: 'pointer', textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{f.name || f.id}</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            {(f.palette ?? []).slice(0, 3).map((c) => <span key={c} style={{ width: 16, height: 16, background: c, borderRadius: 3, display: 'inline-block' }} />)}
          </div>
        </button>
      ))}
    </div>
  );
}
