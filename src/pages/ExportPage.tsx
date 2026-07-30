import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTimelineStore } from '@/stores/timelineStore';
import { useProjectStore } from '@/stores/projectStore';
import { renderApi } from '@/services/api';
import { StandardLayout } from '@/layouts/StandardLayout';
import { Button, Badge } from '@/components/ui';
import { uid, formatTimecode } from '@/lib/utils';
import type { ExportSettings, RenderProgress } from '@/types/api';
import {
  Download, Clapperboard, Gauge, Cpu, Film, Loader2, CheckCircle2,
  XCircle, ArrowLeft, HardDrive, Zap,
} from 'lucide-react';

const PRESETS: Record<string, { name: string; width: number; height: number; fps: number; bitrate: string; icon: string }> = {
  bilibili: { name: 'Bilibili 1080p', width: 1920, height: 1080, fps: 30, bitrate: '6M', icon: '📺' },
  bilibili_4k: { name: 'Bilibili 4K', width: 3840, height: 2160, fps: 30, bitrate: '20M', icon: '🎞️' },
  youtube: { name: 'YouTube 1080p', width: 1920, height: 1080, fps: 30, bitrate: '8M', icon: '▶️' },
  tiktok: { name: '抖音竖屏', width: 1080, height: 1920, fps: 30, bitrate: '4M', icon: '📱' },
  weibo: { name: '微博 720p', width: 1280, height: 720, fps: 25, bitrate: '3M', icon: '🌐' },
  custom: { name: '自定义', width: 1920, height: 1080, fps: 30, bitrate: '5M', icon: '⚙️' },
};

interface QueueItem extends RenderProgress {
  label: string;
  presetName: string;
  startedAt: string;
  filename?: string;
}

/**
 * ExportPage — render console. Preset selection, custom params, and a live
 * render queue driven by SSE progress events.
 */
export function ExportPage() {
  const navigate = useNavigate();
  const timeline = useTimelineStore((s) => s.timeline);
  const projectName = useProjectStore((s) => s.projectName);

  const [presetId, setPresetId] = useState('bilibili');
  const [settings, setSettings] = useState<ExportSettings>({
    preset: 'bilibili', width: 1920, height: 1080, fps: 30, bitrate: '6M',
  });
  const [apiPresets, setApiPresets] = useState<Record<string, any> | null>(null);
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const esRefs = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    renderApi.getPresets()
      .then((presets) => {
        if (presets && typeof presets === 'object' && !Array.isArray(presets)) {
          setApiPresets(presets as Record<string, unknown>);
        }
      })
      .catch(() => {
        setApiPresets(null);
      })
      .finally(() => setLoadingPresets(false));
  }, []);

  // 刷新后从后端恢复在途渲染任务并重新挂接进度流
  useEffect(() => {
    let alive = true;
    renderApi.listQueue()
      .then((tasks) => {
        if (!alive) return;
        const active = tasks.filter((t) => t.status === 'queued' || t.status === 'rendering');
        if (active.length === 0) return;
        setQueue((q) => {
          const known = new Set(q.map((it) => it.task_id));
          const restored: QueueItem[] = active
            .filter((t) => !known.has(t.task_id))
            .map((t) => ({
              task_id: t.task_id,
              status: t.status,
              progress: t.progress ?? 0,
              label: '恢复的任务',
              presetName: '—',
              startedAt: new Date().toLocaleTimeString(),
            }));
          return [...restored, ...q];
        });
        active.forEach((t) => openSSE(t.task_id));
      })
      .catch(() => { /* offline：跳过恢复 */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const presets = apiPresets && Object.keys(apiPresets).length > 0 ? { ...PRESETS, ...apiPresets } : PRESETS;

  const applyPreset = (id: string) => {
    const p = presets[id];
    setPresetId(id);
    setSettings({ preset: id, width: p.width, height: p.height, fps: p.fps, bitrate: p.bitrate });
  };

  const submitRender = async () => {
    if (timeline.tracks.length === 0) return;
    setSubmitting(true);
    const taskId = uid('render');
    const filename = `${projectName.replace(/\s+/g, '_')}_${settings.width}x${settings.height}.mp4`;
    const item: QueueItem = {
      task_id: taskId, status: 'pending', progress: 0,
      label: projectName, presetName: presets[presetId].name,
      startedAt: new Date().toLocaleTimeString(), filename,
    };
    setQueue((q) => [item, ...q]);

    try {
      const res = await renderApi.submitQueue({
        timeline: useTimelineStore.getState().exportTimeline(),
        output_path: `renders/${filename}`,
        settings,
      });
      // 后端返回真实 task_id（render_N_ts）；替换本地占位 ID 后再挂接进度流
      const realId = res.task_id ?? taskId;
      if (realId !== taskId) updateQueue(taskId, { task_id: realId });
      openSSE(realId);
    } catch {
      // Offline: simulate render progress
      simulateRender(taskId);
    } finally {
      setSubmitting(false);
    }
  };

  const openSSE = (taskId: string) => {
    if (esRefs.current.has(taskId)) return;
    const es = new EventSource(renderApi.getQueueStreamUrl(taskId));
    esRefs.current.set(taskId, es);
    // 后端发送的是未命名 data 消息（{type: progress/completed/failed/timeout}）
    es.onmessage = (e) => {
      let d: { type?: string; progress?: number; phase?: string; detail?: string };
      try {
        d = JSON.parse((e as MessageEvent).data);
      } catch {
        return;
      }
      if (d.type === 'progress') {
        updateQueue(taskId, { progress: d.progress ?? 0, phase: d.phase, detail: d.detail, status: 'rendering' });
      } else if (d.type === 'completed') {
        updateQueue(taskId, { status: 'completed', progress: 100 });
        es.close();
        esRefs.current.delete(taskId);
      } else if (d.type === 'failed') {
        updateQueue(taskId, { status: 'failed' });
        es.close();
        esRefs.current.delete(taskId);
      } else if (d.type === 'timeout') {
        updateQueue(taskId, { status: 'failed', detail: '进度流超时' });
        es.close();
        esRefs.current.delete(taskId);
      }
    };
    es.onerror = () => {
      // 连接错误：若任务仍在本地队列中显示为进行中，保留状态等待下次恢复
      es.close();
      esRefs.current.delete(taskId);
    };
  };

  const simulateTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const simulateRender = (taskId: string) => {
    updateQueue(taskId, { status: 'rendering', progress: 0 });
    const phases = [
      { p: 'trim', until: 40 },
      { p: 'concat', until: 70 },
      { p: 'text', until: 88 },
      { p: 'audio', until: 100 },
    ];
    let prog = 0;
    const timer = setInterval(() => {
      prog += 2 + Math.random() * 3;
      const phase = phases.find((ph) => prog <= ph.until) ?? phases[phases.length - 1];
      if (prog >= 100) {
        clearInterval(timer);
        simulateTimers.current.delete(taskId);
        updateQueue(taskId, { status: 'completed', progress: 100, phase: 'done' });
      } else {
        updateQueue(taskId, { status: 'rendering', progress: Math.round(prog), phase: phase.p });
      }
    }, 180);
    simulateTimers.current.set(taskId, timer);
  };

  const updateQueue = (taskId: string, patch: Partial<QueueItem>) => {
    setQueue((q) => q.map((it) => (it.task_id === taskId ? { ...it, ...patch } : it)));
  };

  useEffect(() => () => {
    esRefs.current.forEach((es) => es.close());
    simulateTimers.current.forEach((timer) => clearInterval(timer));
  }, []);

  const estSize = estimateSize(timeline.duration_sec, settings.bitrate);

  return (
    <StandardLayout title="导出与渲染">
      <button
        onClick={() => {
          const pid = useProjectStore.getState().projectId;
          if (pid) { navigate({ to: '/editor/$projectId', params: { projectId: pid } }); }
          else { navigate({ to: '/' }); }
        }}
        className="flex items-center gap-1.5 text-label-sm text-on-surface-variant hover:text-primary transition-colors mb-5 cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> 返回编辑器
      </button>

      <div className="grid grid-cols-12 gap-6 max-w-[1100px]">
        {/* ── Settings console ── */}
        <div className="col-span-12 lg:col-span-5 space-y-5">
          {/* project summary strip */}
          <div className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-4 flex items-center gap-4">
            <div className="w-11 h-11 rounded-cw-sm bg-primary-container flex items-center justify-center shrink-0">
              <Clapperboard className="w-5 h-5 text-on-primary-container" />
            </div>
            <div className="min-w-0">
              <p className="text-body-sm font-semibold text-on-surface truncate">{projectName}</p>
              <p className="text-caption text-on-surface-variant font-mono">
                {formatTimecode(timeline.duration_sec, timeline.fps)} · {timeline.tracks.length} 轨 · {timeline.width}×{timeline.height}
              </p>
            </div>
          </div>

          {/* preset grid */}
          <div>
            <h3 className="flex items-center gap-2 text-label font-medium text-on-surface-variant uppercase tracking-wide mb-2.5">
              <Film className="w-3.5 h-3.5" /> 导出预设
            </h3>
            <div className="grid grid-cols-2 gap-2" aria-busy={loadingPresets}>
              {Object.entries(presets).map(([id, p]) => (
                <button
                  key={id}
                  onClick={() => applyPreset(id)}
                  className={`text-left px-3 py-2.5 rounded-cw-sm border transition-all duration-short3 cursor-pointer ${
                    presetId === id
                      ? 'border-primary bg-primary/10 shadow-md shadow-primary/10'
                      : 'border-outline-variant/40 bg-surface-container hover:border-outline'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-body">{p.icon}</span>
                    <span className={`text-body-sm font-medium ${presetId === id ? 'text-on-surface' : 'text-on-surface-variant'}`}>{p.name}</span>
                  </span>
                  <span className="block text-caption text-on-surface-variant/70 font-mono mt-0.5 ml-6">
                    {p.width}×{p.height} · {p.fps}fps · {p.bitrate}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* custom params */}
          <div className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-4 space-y-3.5">
            <h3 className="flex items-center gap-2 text-label font-medium text-on-surface-variant uppercase tracking-wide">
              <Gauge className="w-3.5 h-3.5" /> 参数
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="宽度" value={settings.width} onChange={(v) => setSettings({ ...settings, width: v })} min={320} max={7680} step={2} />
              <NumField label="高度" value={settings.height} onChange={(v) => setSettings({ ...settings, height: v })} min={240} max={4320} step={2} />
              <NumField label="帧率" value={settings.fps} onChange={(v) => setSettings({ ...settings, fps: v })} min={1} max={120} step={0.01} />
              <div>
                <label className="block text-label text-on-surface-variant mb-1">码率</label>
                <select
                  value={settings.bitrate}
                  onChange={(e) => setSettings({ ...settings, bitrate: e.target.value })}
                  className="w-full bg-surface rounded-cw-xs px-2 py-1.5 text-body-sm font-mono text-on-surface outline-none border border-outline-variant/30 focus:border-primary cursor-pointer"
                >
                  {['2M', '3M', '5M', '6M', '8M', '12M', '20M'].map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-outline-variant/20">
              <span className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
                <HardDrive className="w-3.5 h-3.5" /> 预估体积
              </span>
              <span className="font-mono text-body-sm text-primary">{estSize}</span>
            </div>
          </div>

          <Button size="lg" className="w-full group" onClick={submitRender} disabled={submitting || timeline.tracks.length === 0}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {submitting ? '提交中…' : '加入渲染队列'}
          </Button>
          {timeline.tracks.length === 0 && (
            <p className="text-caption text-error text-center">时间轴为空，请先在编辑器中添加内容</p>
          )}
        </div>

        {/* ── Render queue ── */}
        <div className="col-span-12 lg:col-span-7">
          <h3 className="flex items-center gap-2 text-label font-medium text-on-surface-variant uppercase tracking-wide mb-2.5">
            <Cpu className="w-3.5 h-3.5" /> 渲染队列
            <Badge variant="default" className="ml-1">{queue.filter((q) => q.status === 'rendering' || q.status === 'pending').length} 进行中</Badge>
          </h3>

          {queue.length === 0 ? (
            <div className="bg-surface-container border border-dashed border-outline-variant/40 rounded-cw-md p-10 text-center">
              <Cpu className="w-8 h-8 text-on-surface-variant/40 mx-auto mb-2" />
              <p className="text-body-sm text-on-surface-variant">队列为空</p>
              <p className="text-caption text-on-surface-variant/60 mt-1">选择预设并点击「加入渲染队列」开始</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {queue.map((item) => (
                <QueueCard key={item.task_id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </StandardLayout>
  );
}

function QueueCard({ item }: { item: QueueItem }) {
  const active = item.status === 'rendering' || item.status === 'pending';
  return (
    <div className={`bg-surface-container border rounded-cw-md p-3.5 transition-colors duration-short3 ${
      item.status === 'completed' ? 'border-track-audio/40'
        : item.status === 'failed' ? 'border-error/40'
        : 'border-outline-variant/30'
    }`}>
      <div className="flex items-center gap-3">
        <span className={`w-8 h-8 rounded-cw-sm flex items-center justify-center shrink-0 ${
          item.status === 'completed' ? 'bg-track-audio/15 text-track-audio'
            : item.status === 'failed' ? 'bg-error/15 text-error'
            : 'bg-primary/15 text-primary'
        }`}>
          {item.status === 'completed' ? <CheckCircle2 className="w-4 h-4" />
            : item.status === 'failed' ? <XCircle className="w-4 h-4" />
            : <Loader2 className="w-4 h-4 animate-spin" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-medium text-on-surface truncate">{item.label}</p>
          <p className="text-caption text-on-surface-variant font-mono">
            {item.presetName} · {item.startedAt}
            {active && item.phase ? ` · ${phaseLabel(item.phase)}` : ''}
          </p>
        </div>
        <span className={`font-mono text-body-sm shrink-0 ${
          item.status === 'completed' ? 'text-track-audio' : 'text-on-surface-variant'
        }`}>
          {item.status === 'failed' ? '失败' : `${item.progress}%`}
        </span>
        {item.status === 'completed' && item.filename && (
          <a
            href={renderApi.getDownloadUrl(item.filename)}
            className="p-2 rounded-cw-sm bg-track-audio/15 text-track-audio hover:bg-track-audio/25 transition-colors"
            title="下载"
          >
            <Download className="w-4 h-4" />
          </a>
        )}
      </div>
      {/* progress bar */}
      <div className="mt-2.5 h-1.5 bg-surface rounded-cw-full overflow-hidden">
        <div
          className={`h-full rounded-cw-full transition-all duration-medium2 ${
            item.status === 'failed' ? 'bg-error'
              : item.status === 'completed' ? 'bg-track-audio'
              : 'bg-primary'
          }`}
          style={{ width: `${item.progress}%` }}
        />
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <div>
      <label className="block text-label text-on-surface-variant mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min} max={max} step={step}
        className="w-full bg-surface rounded-cw-xs px-2 py-1.5 text-body-sm font-mono text-on-surface outline-none border border-outline-variant/30 focus:border-primary"
      />
    </div>
  );
}

function phaseLabel(p: string): string {
  const map: Record<string, string> = { trim: '裁剪', concat: '拼接', text: '文字', audio: '音频', done: '完成' };
  return map[p] ?? p;
}

function estimateSize(durationSec: number, bitrate: string): string {
  const mbps = parseFloat(bitrate.replace('M', '')) || 5;
  const mb = (mbps * durationSec) / 8;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}
