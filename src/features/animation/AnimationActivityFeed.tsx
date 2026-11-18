import type { AnimationCall } from './contextApi';

const statusColor = (status: string) => {
  if (status === 'success' || status === 'ok') return '#16a34a';
  if (status === 'failed' || status === 'error') return '#dc2626';
  return '#d97706';
};

export function AnimationActivityFeed({ calls }: { calls: AnimationCall[] }) {
  if (!calls.length) return <div style={{ opacity: 0.6, fontSize: 12 }}>暂无 Tool / Skill 调用</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {calls.map((c) => (
        <div key={c.call_id} style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, padding: '6px 8px', fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: statusColor(c.status), fontWeight: 600 }}>{c.status}</span>
            <span style={{ opacity: 0.65 }}>{c.kind}</span>
            <span style={{ fontWeight: 600 }}>{c.name}</span>
            {c.duration_ms ? <span style={{ marginLeft: 'auto', opacity: 0.55 }}>{c.duration_ms}ms</span> : null}
          </div>
          {c.input_summary ? <div style={{ opacity: 0.7, marginTop: 2 }}>{c.input_summary}</div> : null}
          {c.output_summary ? <div style={{ opacity: 0.85, marginTop: 2 }}>{c.output_summary}</div> : null}
          {c.error ? <div style={{ color: '#f87171', marginTop: 2 }}>{c.error}</div> : null}
        </div>
      ))}
    </div>
  );
}
