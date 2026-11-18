import type { AnimationCall, AnimationContext } from './contextApi';

export function ContextInspector({ ctx }: { ctx: AnimationContext | null }) {
  if (!ctx) return <div style={{ opacity: 0.6, fontSize: 12 }}>暂无上下文</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <div><b>brief</b><pre style={{ whiteSpace: 'pre-wrap', opacity: 0.8 }}>{JSON.stringify(ctx.blackboard.brief ?? {}, null, 2)}</pre></div>
      <div><b>风格</b><pre style={{ whiteSpace: 'pre-wrap', opacity: 0.8 }}>{JSON.stringify(ctx.blackboard.style ?? {}, null, 2)}</pre></div>
      <div><b>历史摘要</b><div style={{ opacity: 0.8 }}>{ctx.history_summary || '暂无摘要'}</div></div>
      <div><b>do_not_repeat</b><pre style={{ whiteSpace: 'pre-wrap', opacity: 0.8 }}>{JSON.stringify(ctx.blackboard.do_not_repeat ?? [], null, 2)}</pre></div>
    </div>
  );
}

export function BlackboardPanel({ ctx }: { ctx: AnimationContext | null }) {
  if (!ctx) return <div style={{ opacity: 0.6, fontSize: 12 }}>暂无黑板</div>;
  return (
    <div style={{ fontSize: 12 }}>
      <div>version: {ctx.version}</div>
      <div>shots: {Array.isArray((ctx.blackboard as { shots?: unknown[] }).shots) ? (ctx.blackboard as { shots: unknown[] }).shots.length : 0}</div>
      <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto', opacity: 0.8 }}>{JSON.stringify(ctx.blackboard, null, 2)}</pre>
    </div>
  );
}

export function CallDetailDrawer({ call, onClose }: { call: AnimationCall | null; onClose: () => void }) {
  if (!call) return null;
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, width: 360, maxHeight: '60vh', overflow: 'auto', background: '#111827', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, padding: 12, zIndex: 50, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{call.name}</b><button onClick={onClose}>×</button></div>
      <div style={{ opacity: 0.7 }}>{call.kind} · {call.status} · {call.duration_ms ?? 0}ms</div>
      <div style={{ marginTop: 6 }}>{call.input_summary}</div>
      <div style={{ marginTop: 6 }}>{call.output_summary}</div>
      {call.artifact_ref ? <div style={{ marginTop: 6, opacity: 0.7 }}>artifact: {call.artifact_ref}</div> : null}
      {call.error ? <div style={{ marginTop: 6, color: '#f87171' }}>{call.error}</div> : null}
    </div>
  );
}

export function QAReportPanel({ ctx }: { ctx: AnimationContext | null }) {
  const shots = Array.isArray((ctx?.blackboard as { shots?: unknown[] } | undefined)?.shots)
    ? ((ctx?.blackboard as { shots: Array<Record<string, unknown>> }).shots) : [];
  if (!shots.length) return <div style={{ opacity: 0.6, fontSize: 12 }}>暂无 QA 记录</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      {shots.map((s, i) => {
        const qa = (s.last_qa as { ok?: boolean; text_issues?: string[]; motion_issues?: string[] } | undefined) ?? {};
        return (
          <div key={i} style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, padding: 6 }}>
            <div><b>shot {String(s.index ?? i + 1)}</b> · <span style={{ color: qa.ok ? '#16a34a' : '#dc2626' }}>{qa.ok ? 'passed' : 'qa_failed'}</span></div>
            {(qa.text_issues ?? []).map((x, j) => <div key={j} style={{ color: '#fbbf24' }}>{x}</div>)}
            {(qa.motion_issues ?? []).map((x, j) => <div key={j} style={{ color: '#fbbf24' }}>{x}</div>)}
          </div>
        );
      })}
    </div>
  );
}
