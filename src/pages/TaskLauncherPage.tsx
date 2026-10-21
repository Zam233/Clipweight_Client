/**
 * 任务入口页（`/task`）—— 首页的"一句话出片"落点。
 *
 * 大胆的做法：它**直接创建任务并把用户送进工作台**，不再弹一堆配置表单。
 * 因为 Q3 已经把"先看计划"变成了默认：用户先付出的是注意力，不是钱。
 */

import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';

import { Badge, Button } from '@/components/ui';
import { useTaskStore } from '@/stores/taskStore';

import { durationText, statusLabel } from '@/features/task/labels';

export function TaskLauncherPage() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [duration, setDuration] = useState('60');
  const [busy, setBusy] = useState(false);
  const createTask = useTaskStore((s) => s.createTask);
  const list = useTaskStore((s) => s.list);
  const loadList = useTaskStore((s) => s.loadList);
  const error = useTaskStore((s) => s.error);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const submit = async () => {
    const text = topic.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const task = await createTask({
        topic: text,
        duration_sec: Number(duration) || 0,
        plan_only: true,
      });
      if (task) navigate({ to: '/task/$taskId', params: { taskId: task.id } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-surface text-on-surface">
      <div className="mx-auto max-w-2xl px-6 py-10 space-y-5">
        <header className="space-y-1">
          <h1 className="text-title text-on-surface flex items-center gap-2">
            <Sparkles className="w-5 h-5" /> 一句话出片
          </h1>
          <p className="text-caption text-on-surface-variant">
            主 Agent 会先给你一份计划（几步、用什么能力、大概多少钱），你点「按计划执行」它才开始干活。
          </p>
        </header>

        <textarea
          className="w-full min-h-[96px] bg-surface-container rounded-cw-md p-3 text-body-sm text-on-surface
            outline-none border border-outline-variant/30 focus:border-primary"
          placeholder="例如：做一个 1 分钟的短视频，讲清县域经济为什么能撑起半个制造业"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          aria-label="需求描述"
        />

        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-caption text-on-surface-variant flex items-center gap-2">
            目标时长
            <input
              className="w-20 bg-surface-container rounded-cw-sm px-2 py-1 text-caption text-on-surface
                outline-none border border-outline-variant/30"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              aria-label="目标时长秒"
            />
            秒
          </label>
          <Button size="sm" onClick={() => void submit()} disabled={!topic.trim() || busy}>
            {busy ? '正在规划…' : '生成计划'}
          </Button>
          {error && <span className="text-caption text-error">{error}</span>}
        </div>

        {list.length > 0 && (
          <section className="space-y-1.5">
            <h2 className="text-body-sm font-semibold text-on-surface">最近的任务</h2>
            <ul className="space-y-1">
              {list.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-cw-sm
                      bg-surface-container hover:bg-surface-container-high text-caption"
                    onClick={() => navigate({ to: '/task/$taskId', params: { taskId: item.id } })}
                  >
                    <Badge variant="default">{statusLabel(item.status)}</Badge>
                    <span className="text-on-surface truncate flex-1">{item.topic}</span>
                    <span className="text-on-surface-variant">{item.steps} 步</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-caption text-on-surface-variant">
          预算未配置时只记账不阻断；回合/调用数/时长三道闸始终生效（默认 30 回合 · 80 次调用 ·{' '}
          {durationText(3600)}）。
        </p>
      </div>
    </div>
  );
}
