import { useTaskStore } from '@/stores/taskStore';
import { AnimationContextPanel } from './AnimationContextPanel';

export function AnimationContextMount() {
  const task = useTaskStore((s) => s.task);
  if (!task?.session_id) return null;
  return (
    <div className="border-t border-outline-variant/20 min-h-0 overflow-auto" data-testid="animation-context-mount">
      <AnimationContextPanel sessionId={task.session_id} taskId={task.id} />
    </div>
  );
}
