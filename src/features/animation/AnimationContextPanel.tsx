import { useEffect, useState } from 'react';
import { AnimationActivityFeed } from './AnimationActivityFeed';
import { BlackboardPanel, CallDetailDrawer, ContextInspector } from './ContextPanels';
import { getAnimationContext, type AnimationCall, type AnimationContext } from './contextApi';

export function AnimationContextPanel({ sessionId, taskId }: { sessionId: string; taskId: string }) {
  const [ctx, setCtx] = useState<AnimationContext | null>(null);
  const [tab, setTab] = useState<'activity' | 'context' | 'blackboard'>('activity');
  const [selected, setSelected] = useState<AnimationCall | null>(null);

  useEffect(() => {
    let alive = true;
    getAnimationContext(sessionId, taskId).then((v) => { if (alive) setCtx(v); }).catch(() => { if (alive) setCtx(null); });
    return () => { alive = false; };
  }, [sessionId, taskId]);

  const tabStyle = (on: boolean) => ({ padding: '4px 10px', cursor: 'pointer', borderBottom: on ? '2px solid #38bdf8' : '2px solid transparent', opacity: on ? 1 : 0.6 });
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <div style={tabStyle(tab === 'activity')} onClick={() => setTab('activity')}>活动</div>
        <div style={tabStyle(tab === 'context')} onClick={() => setTab('context')}>上下文</div>
        <div style={tabStyle(tab === 'blackboard')} onClick={() => setTab('blackboard')}>黑板</div>
      </div>
      {tab === 'activity' ? <div onClick={(e) => { const el = (e.target as HTMLElement).closest('[data-call]'); if (el) setSelected((ctx?.calls ?? []).find((c) => c.call_id === el.getAttribute('data-call')) ?? null); }}><AnimationActivityFeed calls={ctx?.calls ?? []} /></div> : null}
      {tab === 'context' ? <ContextInspector ctx={ctx} /> : null}
      {tab === 'blackboard' ? <BlackboardPanel ctx={ctx} /> : null}
      <CallDetailDrawer call={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
