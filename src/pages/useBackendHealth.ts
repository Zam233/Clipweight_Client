import { useEffect, useState } from 'react';
import { healthApi } from '@/services/api';
import type { HealthResponse } from '@/types/api';
import { useSettingsStore } from '@/stores/settingsStore';

export type BackendStatus = 'checking' | 'online' | 'offline';

/** 后端 `/health` 里各组件状态的自有字段（service/status 之外的部件）。 */
export type BackendComponent = 'mongodb' | 'llm' | 'ffmpeg' | 'hyperframes' | 'queue';

export interface BackendHealthDetail {
  status: BackendStatus;
  /** 原始响应（离线/未上报时为空） */
  detail: HealthResponse | null;
}

// G5: 心跳轮询间隔（毫秒）——后端中途挂掉时前端能及时反映离线
const POLL_INTERVAL_MS = 30_000;

/**
 * 探测后端连接状态**与组件健康**：挂载时立即检查一次，随后每 30s 轮询一次（G5），
 * 让运行中后端离线也能被及时反映；apiBaseUrl 变化时重新探测。卸载时清除定时器。
 *
 * 为什么保留整份响应：`/health` 不只回 `status`——它还逐项报告 mongodb / llm /
 * ffmpeg / hyperframes / 队列积压。前端此前只读 `status`，等于把后端辛苦探测的
 * 组件信息全丢了（"连上了，但哪一部分不可用"看不见）。
 */
export function useBackendHealthDetail(): BackendHealthDetail {
  const [state, setState] = useState<BackendHealthDetail>({
    status: 'checking',
    detail: null,
  });
  const apiBaseUrl = useSettingsStore((s) => s.apiBaseUrl);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = () => {
      healthApi
        .check()
        .then((data) => {
          if (alive) setState({ status: 'online', detail: data ?? null });
        })
        .catch(() => {
          if (alive) setState({ status: 'offline', detail: null });
        });
    };

    check(); // 立即检查一次
    timer = setInterval(check, POLL_INTERVAL_MS);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [apiBaseUrl]);

  return state;
}

/**
 * 只要连接状态时用这个（Agent 面板等）。内部复用 detail 版本，避免两个轮询器。
 */
export function useBackendHealth(): BackendStatus {
  return useBackendHealthDetail().status;
}

/** 组件状态的展示口径：ok 绿、未配置/未找到 黄、错误/断开 红、其余灰。 */
export function componentTone(value?: string): 'ok' | 'warn' | 'error' | 'idle' {
  const status = (value ?? '').toLowerCase();
  if (!status) return 'idle';
  if (['ok', 'ready', 'idle'].includes(status)) return 'ok';
  if (['no_key', 'not_found', 'checking', 'disabled', 'skipped'].includes(status)) return 'warn';
  return 'error';
}

export interface HealthComponentChip {
  key: BackendComponent;
  label: string;
  value: string;
  valueLabel: string;
  tone: 'ok' | 'warn' | 'error' | 'idle';
}

const COMPONENT_LABELS: Record<BackendComponent, string> = {
  mongodb: '数据库',
  llm: '大模型',
  ffmpeg: 'FFmpeg',
  hyperframes: 'HTML 渲染',
  queue: '渲染队列',
};

const VALUE_LABELS: Record<string, string> = {
  ok: '就绪',
  ready: '就绪',
  no_key: '未配密钥',
  not_found: '未安装',
  checking: '探测中',
  disconnected: '未连接',
  error: '异常',
  idle: '空闲',
  disabled: '已禁用',
};

/**
 * 把 `/health` 的组件字段翻成可展示的 chip（**只翻译后端给的，不推测**）。
 * 缺字段就不出现——后端没上报的组件不该在界面上装成"正常"。
 */
export function buildHealthComponents(detail: HealthResponse | null): HealthComponentChip[] {
  if (!detail) return [];
  const chips: HealthComponentChip[] = [];
  const order: BackendComponent[] = ['mongodb', 'llm', 'ffmpeg', 'hyperframes', 'queue'];
  for (const key of order) {
    let raw: unknown = detail[key];
    if (key === 'queue') {
      // 后端没上报队列就不出现（不让"没探测"伪装成"空闲"）
      if (
        detail.queue === undefined
        && detail.queue_pending === undefined
        && detail.queue_running === undefined
      ) {
        continue;
      }
      const pending = detail.queue_pending ?? 0;
      const running = detail.queue_running ?? 0;
      raw = detail.queue ?? 'idle';
      const value = String(raw);
      chips.push({
        key,
        label: COMPONENT_LABELS[key],
        value,
        valueLabel:
          pending || running
            ? `${VALUE_LABELS[value] ?? value} ${running}/${pending}`
            : VALUE_LABELS[value] ?? value,
        tone: componentTone(value),
      });
      continue;
    }
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw);
    chips.push({
      key,
      label: COMPONENT_LABELS[key],
      value,
      valueLabel: VALUE_LABELS[value] ?? value,
      tone: componentTone(value),
    });
  }
  return chips;
}
