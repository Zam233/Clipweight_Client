/**
 * 定时调度客户端（PRD B8 / G4）。
 *
 * 后端 `/api/scheduler` 早就有 CRUD + toggle + tick（`clipwright/api/scheduler.py`），
 * 前端一直没有入口。这里只做 typed client；**触发（tick）与删除都是破坏性/花钱动作**，
 * 调用方（SchedulerPage）必须二次确认。
 */
import { getApiClient } from './client';

export interface ScheduleRecord {
  schedule_id: string;
  name: string;
  /** >0 时按间隔触发；与 daily_hhmm 二选一 */
  interval_sec: number;
  /** 每日时刻 HH:MM（服务端按 Host 本地时区解释） */
  daily_hhmm: string;
  payload: Record<string, unknown>;
  owner_id?: string;
  active: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  created_at?: string;
}

export interface CreateScheduleBody {
  name: string;
  interval_sec?: number;
  daily_hhmm?: string;
  payload?: Record<string, unknown>;
}

export const schedulerApi = {
  async list(): Promise<ScheduleRecord[]> {
    const { data } = await getApiClient().get('/api/scheduler/schedules');
    return Array.isArray(data) ? (data as ScheduleRecord[]) : [];
  },

  async create(body: CreateScheduleBody): Promise<ScheduleRecord> {
    const { data } = await getApiClient().post('/api/scheduler/schedules', {
      name: body.name,
      interval_sec: body.interval_sec ?? 0,
      daily_hhmm: body.daily_hhmm ?? '',
      payload: body.payload ?? {},
    });
    return data as ScheduleRecord;
  },

  async toggle(scheduleId: string, active: boolean): Promise<{ status: string; active: boolean }> {
    const { data } = await getApiClient().post(
      `/api/scheduler/schedules/${encodeURIComponent(scheduleId)}/toggle`,
      null,
      { params: { active } },
    );
    return data as { status: string; active: boolean };
  },

  async remove(scheduleId: string): Promise<{ status: string; schedule_id: string }> {
    const { data } = await getApiClient().delete(
      `/api/scheduler/schedules/${encodeURIComponent(scheduleId)}`,
    );
    return data as { status: string; schedule_id: string };
  },

  /** 手动触发一次到期扫描（运维/调试）——会真的派发任务，必须二次确认 */
  async tick(): Promise<{ fired: number; schedules: string[] }> {
    const { data } = await getApiClient().post('/api/scheduler/tick');
    const payload = (data ?? {}) as { fired?: number; schedules?: unknown[] };
    return {
      fired: Number(payload.fired ?? 0),
      schedules: Array.isArray(payload.schedules) ? payload.schedules.map((s) => String(s)) : [],
    };
  },
};
