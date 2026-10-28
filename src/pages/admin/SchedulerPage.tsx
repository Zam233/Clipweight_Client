/**
 * 定时调度页（PRD B8 / G4）。
 *
 * 后端 `/api/scheduler` 一直有 CRUD + toggle + tick，但前端从未接入，用户只能手工调 API。
 * 三条纪律：
 * 1. **触发（tick）会真的派发任务**（可能花钱）→ 二次确认 + 显式说明"会立即扫描到期任务"；
 * 2. **删除**不可撤销 → 二次确认，并回显被删的名字；
 * 3. 时区/触发时间以后端 `next_run_at` 为准，前端不推断（只做 HH:MM 与间隔的格式校验）。
 */
import { useCallback, useEffect, useState } from 'react';
import { ConsoleShell, ConsoleHeading } from './ConsoleShell';
import { Button } from '@/components/ui';
import { schedulerApi, type ScheduleRecord } from '@/services/api/scheduler';
import { cn } from '@/lib/utils';
import { Loader2, Plus, RefreshCw, Trash2, PlayCircle, Clock } from 'lucide-react';

const INPUT = 'w-full bg-surface rounded-cw-sm px-3 py-2 text-body-sm text-on-surface '
  + 'outline-none border border-outline-variant/30 focus:border-primary';

/** HH:MM 校验（只做格式，语义交给后端）。注意：本模块只导出一个组件，
 *  lazyPage 要求模块导出全为组件，工具函数保持模块内私有。 */
function isValidHhmm(v: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

export function SchedulerPage() {
  const [items, setItems] = useState<ScheduleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [intervalSec, setIntervalSec] = useState('');
  const [dailyHhmm, setDailyHhmm] = useState('');
  const [formErr, setFormErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await schedulerApi.list());
    } catch (e) {
      setError((e as Error)?.message || '加载定时任务失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setFormErr(null);
    if (!name.trim()) {
      setFormErr('请填写任务名');
      return;
    }
    const interval = Number(intervalSec || 0);
    if (intervalSec && (!Number.isFinite(interval) || interval < 0)) {
      setFormErr('间隔秒必须是非负数字');
      return;
    }
    if (dailyHhmm && !isValidHhmm(dailyHhmm)) {
      setFormErr('每日时刻格式应为 HH:MM（00:00–23:59）');
      return;
    }
    if (!interval && !dailyHhmm) {
      setFormErr('间隔秒与每日时刻至少填一个');
      return;
    }
    setCreating(true);
    try {
      await schedulerApi.create({
        name: name.trim(),
        interval_sec: interval,
        daily_hhmm: dailyHhmm.trim(),
      });
      setName('');
      setIntervalSec('');
      setDailyHhmm('');
      setNote('已创建定时任务');
      await load();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (e as Error)?.message ?? '创建失败';
      setFormErr(String(detail));
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (s: ScheduleRecord) => {
    setBusyId(s.schedule_id);
    try {
      await schedulerApi.toggle(s.schedule_id, !s.active);
      await load();
    } catch (e) {
      setError((e as Error)?.message || '切换失败');
    } finally {
      setBusyId('');
    }
  };

  const remove = async (s: ScheduleRecord) => {
    if (!window.confirm(`删除定时任务「${s.name}」？此操作不可撤销。`)) return;
    setBusyId(s.schedule_id);
    try {
      await schedulerApi.remove(s.schedule_id);
      setNote(`已删除「${s.name}」`);
      await load();
    } catch (e) {
      setError((e as Error)?.message || '删除失败');
    } finally {
      setBusyId('');
    }
  };

  const tick = async () => {
    if (!window.confirm('立即扫描一次到期任务？到期的任务会被真的派发（可能产生费用）。')) return;
    setBusyId('tick');
    try {
      const res = await schedulerApi.tick();
      setNote(`已触发：${res.fired} 个任务${res.schedules.length ? `（${res.schedules.join('、')}）` : ''}`);
      await load();
    } catch (e) {
      setError((e as Error)?.message || '触发失败');
    } finally {
      setBusyId('');
    }
  };

  return (
    <ConsoleShell>
      <div className="flex items-start justify-between gap-4">
        <ConsoleHeading
          kicker="Ops / Scheduler"
          title="定时调度"
          desc="按间隔或每日时刻自动派发任务。触发与删除都是不可撤销动作，均需二次确认；触发时间以后端返回的「下次触发」为准。"
        />
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => void tick()} disabled={busyId === 'tick'}>
            {busyId === 'tick' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            立即触发一次
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            刷新
          </Button>
        </div>
      </div>

      {note && <p className="mb-3 text-caption text-primary" data-testid="scheduler-note">{note}</p>}
      {error && (
        <div className="mb-3 flex items-center justify-between rounded-cw-md border border-error/30 bg-error/10 px-3 py-2">
          <span className="text-label-sm text-error" data-testid="scheduler-error">{error}</span>
          <button type="button" className="text-label-sm text-error hover:opacity-80 cursor-pointer" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      <section className="mb-5 max-w-[900px] rounded-cw-md border border-outline-variant/30 bg-surface-container p-4">
        <h3 className="mb-2 text-label-sm text-on-surface">新建定时任务</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[180px]">
            <span className="mb-1 block text-caption text-on-surface-variant">任务名</span>
            <input className={INPUT} data-testid="schedule-name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="w-32">
            <span className="mb-1 block text-caption text-on-surface-variant">间隔秒</span>
            <input className={INPUT} data-testid="schedule-interval" value={intervalSec}
              inputMode="numeric" onChange={(e) => setIntervalSec(e.target.value)} placeholder="如 3600" />
          </label>
          <label className="w-32">
            <span className="mb-1 block text-caption text-on-surface-variant">每日时刻</span>
            <input className={INPUT} data-testid="schedule-hhmm" value={dailyHhmm}
              onChange={(e) => setDailyHhmm(e.target.value)} placeholder="HH:MM" />
          </label>
          <Button size="sm" onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            创建
          </Button>
        </div>
        {formErr && <p className="mt-2 text-caption text-error" data-testid="schedule-form-err">{formErr}</p>}
        <p className="mt-2 text-caption text-on-surface-variant/60">
          间隔秒与每日时刻至少填一个；两个都填时以后端调度规则为准。
        </p>
      </section>

      <section className="max-w-[900px]">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-cw-sm bg-surface-container" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-caption text-on-surface-variant" data-testid="scheduler-empty">
            还没有定时任务。填好上面表单点「创建」即可。
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="scheduler-list">
            {items.map((s) => (
              <li
                key={s.schedule_id}
                data-schedule-id={s.schedule_id}
                data-active={s.active ? 'true' : 'false'}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-cw-sm border px-3 py-2 text-caption',
                  s.active ? 'border-outline-variant/30 bg-surface-container' : 'border-outline-variant/15 bg-surface-container/60 opacity-70',
                )}
              >
                <span className="font-mono text-on-surface">{s.name}</span>
                <span className="text-on-surface-variant/70">
                  {s.interval_sec > 0 ? `每 ${s.interval_sec}s` : ''}
                  {s.interval_sec > 0 && s.daily_hhmm ? ' · ' : ''}
                  {s.daily_hhmm ? `每日 ${s.daily_hhmm}` : ''}
                </span>
                <span className="flex items-center gap-1 text-on-surface-variant/70">
                  <Clock className="w-3 h-3" />
                  {s.next_run_at ? `下次 ${s.next_run_at.replace('T', ' ').slice(0, 16)}` : '未排期'}
                  {s.last_run_at ? ` · 上次 ${s.last_run_at.replace('T', ' ').slice(0, 16)}` : ''}
                </span>
                <span className={s.active ? 'text-primary' : 'text-on-surface-variant/60'}>
                  {s.active ? '运行中' : '已停用'}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="outline" disabled={busyId === s.schedule_id}
                    onClick={() => void toggle(s)}>
                    {s.active ? '停用' : '启用'}
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`删除定时任务 ${s.name}`}
                    disabled={busyId === s.schedule_id} onClick={() => void remove(s)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ConsoleShell>
  );
}
