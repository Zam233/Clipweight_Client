import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useTimelineStore } from '@/stores/timelineStore';
import { useTaskStore } from '@/stores/taskStore';
import { usePluginContributions } from '@/features/plugins/usePluginSlots';
import { useProjectStore } from '@/stores/projectStore';
import { renderApi, projectApi, assetApi, toolApi } from '@/services/api';
import { connectSseStream, type SseStreamHandle } from '@/services/api/sseStream';
import { toast } from '@/stores/toastStore';
import { createEmptyTimeline, type Timeline } from '@/types/timeline';
import { StandardLayout } from '@/layouts/StandardLayout';
import { Button, Badge } from '@/components/ui';
import { uid, formatTimecode } from '@/lib/utils';
import { asText } from '@/lib/render';
import { resolveContainerExt, sanitizePluginPreset, type ExportPresetDef } from './exportPreset';
import { clampPreroll, prerollPayload } from '@/services/api/preroll';
import { fingerprintLabel, timelineChanged, timelineFingerprint } from './exportSnapshot';
import type { ExportSettings, RenderProgress } from '@/types/api';
import {
  Download, Clapperboard, Gauge, Cpu, Film, Loader2, CheckCircle2,
  XCircle, ArrowLeft, HardDrive, Zap, RotateCcw, Wand2,
} from 'lucide-react';

interface PresetDef extends ExportPresetDef {
  icon: string;
}

const PRESETS: Record<string, PresetDef> = {
  bilibili: { name: 'Bilibili 1080p', width: 1920, height: 1080, fps: 30, bitrate: '6M', icon: '📺' },
  youtube: { name: 'YouTube 1080p', width: 1920, height: 1080, fps: 30, bitrate: '8M', icon: '▶️' },
  tiktok: { name: '抖音竖屏', width: 1080, height: 1920, fps: 30, bitrate: '4M', icon: '📱' },
  weibo: { name: '微博竖屏', width: 720, height: 1280, fps: 24, bitrate: '3M', icon: '🌐' },
  // 质量档（后端把 cq/crf 语法翻译成恒定质量编码，体积约为固定码率的一半）
  '1080p': { name: '标准 1080p（CQ26 推荐）', width: 1920, height: 1080, fps: 30, bitrate: 'cq26', icon: '✨' },
  web_cq26: { name: '网页交付（CQ26 小体积）', width: 1920, height: 1080, fps: 30, bitrate: 'cq26', icon: '🌐' },
  master_cq18: { name: '高质量母版（CQ18）', width: 1920, height: 1080, fps: 30, bitrate: 'cq18', icon: '🎞️' },
  web_cq30: { name: '极限压缩（CQ30 预览）', width: 1920, height: 1080, fps: 30, bitrate: 'cq30', icon: '📉' },
  custom: { name: '自定义', width: 1920, height: 1080, fps: 30, bitrate: 'cq26', icon: '⚙️' },
  // 批C：以下预设仅存在于后端（_EXPORT_PRESETS），提交时携带 preset 名由后端解析
  prores422hq: { name: 'ProRes 422 HQ（母带 .mov）', width: 1920, height: 1080, fps: 30, bitrate: '12M', icon: '🎬' },
  h265_10bit: { name: 'H.265 10bit', width: 1920, height: 1080, fps: 30, bitrate: '12M', icon: '🧊' },
  '720p': { name: '标准 720p', width: 1280, height: 720, fps: 30, bitrate: '3M', icon: '🖥️' },
  '480p': { name: '标准 480p', width: 854, height: 480, fps: 24, bitrate: '1.5M', icon: '🖥️' },
};

interface QueueItem extends RenderProgress {
  label: string;
  presetName: string;
  startedAt: string;
  filename?: string;
  output_path?: string;
  simulated?: boolean;
  /** 批C：非致命渲染告警与平台封面（后端 result/cover_paths 此前被丢弃） */
  warnings?: string[];
  coverPaths?: string[];
  /** 重试所需的原始提交参数（U14） */
  retrySettings?: ExportSettings;
  retryFilename?: string;
  /** 提交时的时间线快照 + 指纹：重试跑快照（可比较），不是跑"现在的"时间线 */
  retryTimeline?: Timeline;
  retryFingerprint?: string;
  /** 提交时的类型插件 id：重试沿用，避免后改类型导致规格漂移 */
  retryCategoryId?: string;
}

/**
 * ExportPage — render console. Preset selection, custom params, and a live
 * render queue driven by SSE progress events.
 */
export function ExportPage() {
  const navigate = useNavigate();
  const { projectId } = useParams({ from: '/export/$projectId' });
  const timeline = useTimelineStore((s) => s.timeline);
  const projectName = useProjectStore((s) => s.projectName);

  // 刷新后 store 会重置：从 URL 的 projectId 重新加载项目，保证导出页始终持有项目上下文
  useEffect(() => {
    let alive = true;
    (async () => {
      const st = useProjectStore.getState();
      if (st.projectId === projectId && useTimelineStore.getState().timeline.tracks.length > 0) return;
      try {
        const project = await projectApi.load(projectId);
        if (!alive) return;
        useProjectStore.getState().setProjectId(project.id);
        useProjectStore.getState().setProjectName(project.name);
        useTimelineStore.getState().setTimeline(project.timeline ?? createEmptyTimeline());
      } catch {
        // 离线或项目不存在：仅设置 id，时间轴保持当前（可能为空）
        if (alive) useProjectStore.getState().setProjectId(projectId);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  // 无头浏览器状态（chrome-headless-shell）：未装时提示并支持一键安装
  const [browserState, setBrowserState] = useState<{
    installed: boolean;
    installing: boolean;
    message: string;
  }>({ installed: true, installing: false, message: '' });

  // 用户 2026-10-28：默认恒定质量 CQ26（体积约固定码率的一半，画质无差）
  const [presetId, setPresetId] = useState('1080p');
  const [settings, setSettings] = useState<ExportSettings>({
    preset: '1080p', width: 1920, height: 1080, fps: 30, bitrate: 'cq26',
  });
  // W11: BGM 素材源 — 从素材库选音频作为背景音乐
  const [bgmPath, setBgmPath] = useState('');
  // V32: 负时间片头（0 = 无片头）；后端上限 15s
  const [prerollSec, setPrerollSec] = useState(0);
  const [audioAssets, setAudioAssets] = useState<{ id: string; name: string; path: string }[]>([]);
  // 无头浏览器探测 + 安装进度轮询（装了就不用管）
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const st = await renderApi.getBrowser();
        if (!alive) return;
        setBrowserState({
          installed: st.headless_shell.installed,
          installing: st.headless_shell.installing,
          message: st.headless_shell.last_result?.message ?? '',
        });
      } catch {
        if (alive) setBrowserState((s) => ({ ...s, installed: true }));
      }
    };
    void tick();
    const timer = window.setInterval(tick, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    assetApi.list(useProjectStore.getState().projectId ?? undefined)
      .then((list) => {
        if (!alive) return;
        const audios = (Array.isArray(list) ? list : [])
          .filter((a) => a.kind === 'audio')
          .map((a) => ({ id: a.id, name: a.filename || a.id, path: a.path || a.id }));
        setAudioAssets(audios);
      })
      .catch(() => { /* 离线：无 BGM 可选 */ });
    return () => { alive = false; };
  }, []);
  // C6: 自定义导出预设（localStorage）
  const [savedPresets, setSavedPresets] = useState<{ name: string; width: number; height: number; fps: number; bitrate: string }[]>(() => {
    try {
      const raw = localStorage.getItem('cw_export_presets');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [presetName, setPresetName] = useState('');
  const [apiPresets, setApiPresets] = useState<Record<string, Partial<PresetDef>> | null>(null);
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // E3: EventSource → 共享 SSE 工具句柄（自动重连 + 手动重连）
  const esRefs = useRef<Map<string, SseStreamHandle>>(new Map());

  useEffect(() => {
    renderApi.getPresets()
      .then((presets) => {
        if (presets && typeof presets === 'object' && !Array.isArray(presets)) {
          setApiPresets(presets);
        }
      })
      .catch(() => {
        setApiPresets(null);
      })
      .finally(() => setLoadingPresets(false));
  }, []);

  // 刷新后从后端恢复渲染任务并重新挂接进度流。
  // 除了在跑的任务，**刚完成的**也要带回来：终态记录 60s 后会被后端清理，
  // 刷新一次就再也点不到「下载」（E2E 2026-10-29 实测：渲染完成即失联）。
  useEffect(() => {
    let alive = true;
    renderApi.listQueue()
      .then((tasks) => {
        if (!alive) return;
        const live = tasks.filter((t) => t.status === 'queued' || t.status === 'rendering');
        const finished = tasks.filter((t) => t.status === 'completed');
        if (live.length === 0 && finished.length === 0) return;
        setQueue((q) => {
          const known = new Set(q.map((it) => it.task_id));
          const restored: QueueItem[] = [...finished, ...live]
            .filter((t) => !known.has(t.task_id))
            .map((t) => {
              // U18: 尽量从后端任务的文件名恢复原始项目名与预设信息
              const parsed = parseRestoredTask(t);
              const done = t.status === 'completed';
              return {
                task_id: t.task_id,
                status: t.status,
                progress: t.progress ?? (done ? 100 : 0),
                label: parsed.label,
                presetName: parsed.presetName,
                startedAt: new Date().toLocaleTimeString(),
                filename: parsed.filename,
                ...(done && (t as { output_path?: string }).output_path
                  ? { output_path: (t as { output_path?: string }).output_path }
                  : {}),
              };
            });
          return [...restored, ...q];
        });
        live.forEach((t) => openSSE(t.task_id));
      })
      .catch(() => { /* offline：跳过恢复 */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // D-3h：插件贡献的导出预设（kind=export_preset）——键前缀 plugin:，
  // 提交时置空 preset 名走显式参数（后端 _EXPORT_PRESETS 不含插件 id，
  // 避免 P1-06 的「未知导出预设 400」陷阱）
  const pluginPresets = usePluginContributions('export_preset');

  // 合并后端预设与内置预设；后端字段缺失时回落到内置默认值，避免 NaN/undefined 设置
  const presets = useMemo(() => {
    const withPlugins: Record<string, PresetDef> = { ...PRESETS };
    for (const c of pluginPresets) {
      // C4：插件预设 payload 逐字段校验（正整数宽高 / 有限正 fps / 字符串 bitrate /
      // 容器白名单），非法预设整条忽略，不让任意值混入导出设置。
      const safe = sanitizePluginPreset(c.payload, { id: c.id, title: c.title, icon: c.icon });
      if (!safe) continue;
      withPlugins[`plugin:${c.id}`] = safe;
    }
    if (!apiPresets || Object.keys(apiPresets).length === 0) return withPlugins;
    const merged: Record<string, PresetDef> = { ...withPlugins };
    for (const [id, p] of Object.entries(apiPresets)) {
      // 过滤 undefined 字段：后端预设缺 name/icon 时保留内置预设的值（U15）
      const clean = Object.fromEntries(
        Object.entries(p).filter(([, v]) => v !== undefined),
      ) as Partial<PresetDef>;
      const fallback: PresetDef = {
        name: id, icon: merged[id]?.icon ?? '📦',
        width: 1920, height: 1080, fps: 30, bitrate: '6M',
      };
      merged[id] = { ...(merged[id] ?? fallback), ...clean };
    }
    return merged;
  }, [apiPresets, pluginPresets]);

  const applyPreset = (id: string) => {
    const p = presets[id];
    if (!p) return;
    setPresetId(id);
    // P1-06：custom 与插件预设都不是后端合法 preset 名（未知预设 400）——置空串走显式参数分支
    setSettings({
      preset: id === 'custom' || id.startsWith('plugin:') ? '' : id,
      width: p.width, height: p.height, fps: p.fps, bitrate: p.bitrate,
    });
  };

  const submitRender = async () => {
    if (timeline.tracks.length === 0) return;
    setSubmitting(true);
    // 类型插件 id：后端只在显式收到时才让类型插件改规格（如 shortform 竖屏）。
    // 取当前任务的 category_plugin_id；没有任务（手导入工程）就不传，走默认。
    const categoryId = useTaskStore.getState().task?.request?.category_plugin_id ?? '';
    const taskId = uid('render');
    // 文件名消毒：去掉路径分隔符与非法字符，空名称用默认值兜底
    const safeName = (projectName.trim() || 'project').replace(/[\\/:*?"<>|\s]+/g, '_');
    // 批C：容器扩展名跟随预设（ProRes=MOV——MP4 容器装不下 prores 编码），
    // 并加时间戳避免同名任务互相覆盖
    const presetDef = presets[presetId];
    const ext = resolveContainerExt(presetId, presetDef);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const filename = `${safeName}_${settings.width}x${settings.height}_${stamp}.${ext}`;
    // 提交时冻结时间线：重试要跑"当时提交的那份"，否则改完时间线再点重试
    // 会让人以为在重试，其实跑的是新内容（旧实现就是这么干的）
    const snapshot = useTimelineStore.getState().exportTimeline();
    const item: QueueItem = {
      task_id: taskId, status: 'pending', progress: 0,
      label: projectName, presetName: presetDef?.name ?? '自定义',
      startedAt: new Date().toLocaleTimeString(), filename,
      retrySettings: { ...settings }, retryFilename: filename,
      retryTimeline: snapshot, retryFingerprint: timelineFingerprint(snapshot),
      retryCategoryId: categoryId || undefined,
    };
    setQueue((q) => [item, ...q]);

    try {
      const res = await renderApi.submitQueue({
        timeline: snapshot,
        output_path: `renders/${filename}`,
        settings,
        // W11: BGM 素材源（用户从素材库选择；无则后端走无 BGM 路径）
        ...(bgmPath ? { bgm_file_path: bgmPath } : {}),
        // V32: 负时间片头（0 不传，保持后端默认）
        ...prerollPayload(prerollSec),
        // 显式类型（空串不传，保持旧客户端语义）
        ...(categoryId ? { category_id: categoryId } : {}),
      });
      // 后端返回真实 task_id（render_N_ts）；替换本地占位 ID 后再挂接进度流
      const realId = res.task_id ?? taskId;
      if (realId !== taskId) updateQueue(taskId, { task_id: realId });
      openSSE(realId);
    } catch (e) {
      // 批C：区分 HTTP 错误与网络离线——旧实现把 400（如未知预设）伪装成
      // "后端离线"并跑假进度到 100%
      const anyE = e as { code?: string; userMessage?: string; response?: { status?: number; data?: { detail?: unknown } } };
      const isNetwork = anyE?.code === 'ERR_NETWORK' || anyE?.code === 'ECONNABORTED';
      if (isNetwork) {
        toast('后端离线，无法真实渲染，已进入演示模式', 'error');
        simulateRender(taskId);
      } else {
        // P1-07：422 的 detail 是 [{loc,msg,type}] 数组——拼接字段级原因，
        // 优先取 client 拦截器归一化的 userMessage，不再笼统显示「提交失败」
        const rawDetail = anyE?.response?.data?.detail;
        let detail: string | undefined;
        if (typeof rawDetail === 'string') {
          detail = rawDetail;
        } else if (Array.isArray(rawDetail)) {
          detail = (rawDetail as { loc?: unknown[]; msg?: string }[])
            .slice(0, 3)
            .map((it) => `${(it.loc ?? []).filter((x) => x !== 'body').join('.')}: ${it.msg ?? '无效'}`)
            .join('；');
        }
        const userMessage = anyE.userMessage;
        // 字段级 detail 优先：client 拦截器把 422 归一成 userMessage 时只留第一条 msg，
        // 会丢掉字段路径和前 3 条错误（旧实现 `userMessage || detail` 永远走不到 detail）
        const shown = detail || userMessage;
        updateQueue(taskId, { status: 'failed', detail: shown || '提交失败' });
        toast(shown || '渲染提交失败', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * U14 / PRD §20：重试拆成两条路。
   *
   * - `snapshot`：用提交时冻结的时间线重跑（真正意义上的"重试"，结果可比较）；
   * - `current`：时间线已被改过，跑当前版本——这不是重试，是重新提交，按钮文案要说清。
   */
  const retryRender = async (taskId: string, mode: 'snapshot' | 'current' = 'snapshot') => {
    const item = queue.find((it) => it.task_id === taskId);
    if (!item?.retrySettings || !item.retryFilename) return;
    const live = useTimelineStore.getState().exportTimeline();
    const snapshot = item.retryTimeline;
    let timelineToRun: Timeline;
    if (mode === 'current') {
      timelineToRun = live;
    } else if (snapshot) {
      timelineToRun = snapshot;
    } else {
      // 老队列项没有快照：如实按当前时间线跑，但文案已经标明是"当前时间线"
      timelineToRun = live;
    }
    updateQueue(taskId, { status: 'pending', progress: 0, detail: undefined, phase: undefined, simulated: undefined });
    try {
      const res = await renderApi.submitQueue({
        timeline: timelineToRun,
        output_path: `renders/${item.retryFilename}`,
        settings: item.retrySettings,
        // 重试沿用提交时的类型，避免后改任务类型把重试跑成另一种规格
        ...(item.retryCategoryId ? { category_id: item.retryCategoryId } : {}),
      });
      const realId = res.task_id ?? taskId;
      if (realId !== taskId) updateQueue(taskId, { task_id: realId });
      openSSE(realId);
    } catch {
      updateQueue(taskId, { status: 'failed', detail: '重试失败 — 后端不可达' });
      toast('重试失败 — 后端不可达', 'error');
    }
  };

  const openSSE = (taskId: string) => {
    if (esRefs.current.has(taskId)) return;
    // E3: 共享 SSE 工具 — 一次性 token + 自动重连（3s 退避、5 次上限），
    // 网络抖动不再立即判失败；重连期间显示"重连中"，上限后手动重试
    const handle = connectSseStream({
      url: renderApi.getQueueStreamUrl(taskId),
      onMessage: (raw) => {
        let d: { type?: string; progress?: number; phase?: string; detail?: string; output_path?: string; message?: string; result?: { warnings?: string[]; cover_paths?: string[] } };
        if (typeof raw === 'string') {
          try {
            d = JSON.parse(raw);
          } catch {
            return;
          }
        } else {
          d = raw as typeof d;
        }
        if (d.type === 'progress') {
          updateQueue(taskId, { progress: d.progress ?? 0, phase: d.phase, detail: d.detail, status: 'rendering' });
        } else if (d.type === 'completed') {
          // 批C：采集后端 result 中的非致命告警与平台封面
          const warns = d.result?.warnings ?? [];
          const covers = d.result?.cover_paths ?? [];
          updateQueue(taskId, {
            status: 'completed', progress: 100, output_path: d.output_path,
            ...(warns.length ? { warnings: warns } : {}),
            ...(covers.length ? { coverPaths: covers } : {}),
          });
          esRefs.current.get(taskId)?.close();
          esRefs.current.delete(taskId);
        } else if (d.type === 'failed') {
          updateQueue(taskId, { status: 'failed', detail: d.detail ?? '渲染失败', output_path: d.output_path });
          esRefs.current.get(taskId)?.close();
          esRefs.current.delete(taskId);
        } else if (d.type === 'cancelled') {
          // 批C：取消是中性结果（旧实现无分支 → SSE 重连耗尽误报失败）
          updateQueue(taskId, { status: 'cancelled', detail: '已取消' });
          esRefs.current.get(taskId)?.close();
          esRefs.current.delete(taskId);
        } else if (d.type === 'error') {
          updateQueue(taskId, { status: 'failed', detail: String(d.message ?? '任务不存在或已清理') });
          esRefs.current.get(taskId)?.close();
          esRefs.current.delete(taskId);
        } else if (d.type === 'timeout') {
          updateQueue(taskId, { status: 'failed', detail: '进度流超时' });
          esRefs.current.get(taskId)?.close();
          esRefs.current.delete(taskId);
        }
      },
      onRetry: () => {
        setQueue((q) => q.map((it) =>
          it.task_id === taskId && (it.status === 'pending' || it.status === 'rendering')
            ? { ...it, detail: '连接中断，重连中…' }
            : it,
        ));
      },
      onGiveUp: () => {
        esRefs.current.delete(taskId);
        setQueue((q) => q.map((it) =>
          it.task_id === taskId && (it.status === 'pending' || it.status === 'rendering')
            ? { ...it, status: 'failed', detail: '进度流多次重连失败，请重试' }
            : it,
        ));
      },
    });
    esRefs.current.set(taskId, handle);
  };

  const simulateTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const simulateRender = (taskId: string) => {
    updateQueue(taskId, { status: 'rendering', progress: 0, simulated: true });
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

  const timelineEmpty = !timeline.duration_sec || timeline.tracks.length === 0;
  const estSize = timelineEmpty ? '—' : estimateSize(timeline.duration_sec, settings.bitrate);

  return (
    <StandardLayout title="导出与渲染">
      <button
        onClick={() => navigate({ to: '/editor/$projectId', params: { projectId } })}
        className="flex items-center gap-1.5 text-label-sm text-on-surface-variant hover:text-primary transition-colors mb-5 cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> 返回编辑器
      </button>

      {/* 无头浏览器提示（用户 2026-10-28）：未装 chrome-headless-shell 时提示下载并安装 */}
      {!browserState.installed && (
        <div className="mb-5 max-w-[1100px] rounded-cw-md border border-warning/40 bg-warning-container/30 px-4 py-3 flex flex-wrap items-center gap-3">
          <Download className="w-4 h-4 text-warning shrink-0" />
          <div className="min-w-0 flex-1 text-body-sm text-on-surface">
            <p className="font-medium">建议安装 chrome-headless-shell（无头动画渲染器）</p>
            <p className="text-caption text-on-surface-variant mt-0.5">
              {browserState.installing
                ? '正在下载安装（约 100–200MB），完成后动画渲染将自动改用它'
                : browserState.message
                  || '未安装时仍可出片：动画走系统 Chrome 的无头 + CPU 软件渲染，但每次渲染都要冷启动浏览器、速度更慢。'}
            </p>
          </div>
          <button
            onClick={async () => {
              setBrowserState((s) => ({ ...s, installing: true }));
              try {
                await renderApi.installBrowser();
              } catch {
                setBrowserState((s) => ({ ...s, installing: false, message: '安装启动失败，请查看后端日志' }));
              }
            }}
            disabled={browserState.installing}
            className="rounded-cw-xs bg-primary text-on-primary px-3 py-1.5 text-label-sm font-medium disabled:opacity-50"
          >
            {browserState.installing ? '安装中…' : '下载并安装'}
          </button>
        </div>
      )}

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
            {/* C6: 自定义预设保存/应用 */}
            <div className="flex items-center gap-2">
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="预设名称（如 竖屏 4K）"
                className="flex-1 bg-surface rounded-cw-xs px-2 py-1.5 text-body-sm text-on-surface outline-none border border-outline-variant/30 focus:border-primary"
              />
              <button
                onClick={() => {
                  const name = presetName.trim();
                  if (!name) return;
                  const next = [...savedPresets.filter((p) => p.name !== name), { name, width: settings.width, height: settings.height, fps: settings.fps, bitrate: settings.bitrate }];
                  setSavedPresets(next);
                  localStorage.setItem('cw_export_presets', JSON.stringify(next));
                  setPresetName('');
                }}
                className="px-2.5 py-1.5 rounded-cw-xs bg-surface-container-high text-label-sm text-on-surface hover:bg-primary/20 cursor-pointer"
                title="保存当前参数为自定义预设"
              >
                另存为预设
              </button>
            </div>
            {savedPresets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {savedPresets.map((p) => (
                  <span key={p.name}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-cw-full bg-surface-container-high border border-outline-variant/30 text-caption cursor-pointer hover:border-primary/60"
                    title={`${p.width}×${p.height} · ${p.fps}fps · ${p.bitrate}`}
                  >
                    <button onClick={() => { setSettings({ ...settings, preset: '', width: p.width, height: p.height, fps: p.fps, bitrate: p.bitrate }); setPresetId(''); }}
                      className="hover:text-primary">{p.name}</button>
                    <button onClick={() => {
                      const next = savedPresets.filter((x) => x.name !== p.name);
                      setSavedPresets(next);
                      localStorage.setItem('cw_export_presets', JSON.stringify(next));
                    }} className="text-on-surface-variant/50 hover:text-error" aria-label={`删除预设 ${p.name}`}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <NumField label="宽度" value={settings.width} onChange={(v) => setSettings({ ...settings, width: v })} min={320} max={7680} step={2} />
              <NumField label="高度" value={settings.height} onChange={(v) => setSettings({ ...settings, height: v })} min={240} max={4320} step={2} />
              <NumField label="帧率" value={settings.fps} onChange={(v) => setSettings({ ...settings, fps: v })} min={1} max={120} step={0.01} />
              <div>
                <label className="block text-label text-on-surface-variant mb-1">
                  码率 / 质量
                </label>
                <input
                  list="cw-bitrate-options"
                  value={settings.bitrate}
                  onChange={(e) => setSettings({ ...settings, bitrate: e.target.value })}
                  placeholder="cq26"
                  title="恒定质量写 cq18~cq30（推荐 cq26）；固定码率写 3M / 5M / 8M"
                  className="w-full bg-surface rounded-cw-xs px-2 py-1.5 text-body-sm font-mono text-on-surface outline-none border border-outline-variant/30 focus:border-primary"
                />
                <datalist id="cw-bitrate-options">
                  {['cq18', 'cq26', 'cq30', '2M', '3M', '5M', '8M', '12M'].map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
                <p className="mt-1 text-label-sm text-on-surface-variant/70">
                  cq26 = 恒定质量（推荐，体积小）；3M/5M = 固定码率
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-outline-variant/20">
              <span className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
                <HardDrive className="w-3.5 h-3.5" /> 预估体积
              </span>
              <span className="font-mono text-body-sm text-primary">{estSize}</span>
            </div>

            {/* W11: BGM 素材源 */}
            <div className="pt-2 border-t border-outline-variant/20">
              <label className="block text-label text-on-surface-variant mb-1">背景音乐 (BGM)</label>
              <select
                value={bgmPath}
                onChange={(e) => setBgmPath(e.target.value)}
                className="w-full bg-surface rounded-cw-xs px-2 py-1.5 text-body-sm text-on-surface outline-none border border-outline-variant/30 focus:border-primary cursor-pointer"
              >
                <option value="">无（不混入 BGM）</option>
                {audioAssets.map((a) => (
                  <option key={a.id} value={a.path}>{a.name}</option>
                ))}
              </select>
              {audioAssets.length === 0 && (
                <p className="text-caption text-on-surface-variant/60 mt-1">素材库暂无音频（上传音频素材后可选用作 BGM）</p>
              )}
            </div>

            {/* V32: 负时间片头——画面先起、音乐后进；成片总长 = 原时长 + 片头 */}
            <div className="pt-2 border-t border-outline-variant/20">
              <label className="block text-label text-on-surface-variant mb-1">
                片头（秒）
              </label>
              <input
                type="number"
                min={0}
                max={15}
                step={0.5}
                value={prerollSec}
                onChange={(e) => setPrerollSec(clampPreroll(e.target.value))}
                className="w-full bg-surface rounded-cw-xs px-2 py-1.5 text-body-sm text-on-surface outline-none border border-outline-variant/30 focus:border-primary"
              />
              <p className="text-caption text-on-surface-variant/60 mt-1">
                {prerollSec > 0
                  ? `画面先起 ${prerollSec}s，音乐延后同样时长（成片约 +${prerollSec}s）`
                  : '0 = 无片头，音画同起'}
              </p>
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
                <QueueCard
                  key={item.task_id}
                  item={item}
                  currentFingerprint={timelineFingerprint(timeline)}
                  onRetry={(mode) => retryRender(item.task_id, mode)}
                  onCancel={() => renderApi.cancel(item.task_id)
                    .then(() => updateQueue(item.task_id, { status: 'cancelled', detail: '已取消' }))
                    .catch(() => toast('取消失败 — 后端不可达', 'error'))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </StandardLayout>
  );
}

function QueueCard({ item, onRetry, onCancel, currentFingerprint }: {
  item: QueueItem;
  onRetry?: (mode: 'snapshot' | 'current') => void;
  onCancel?: () => void;
  /** 当前时间线指纹：与提交时不同 → 多给一个「用当前时间线提交」 */
  currentFingerprint?: string;
}) {
  const active = item.status === 'rendering' || item.status === 'pending';
  const changed = !!item.retryFingerprint && !!currentFingerprint
    && timelineChanged(item.retryFingerprint, currentFingerprint);
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
            : item.status === 'cancelled' ? 'bg-track-text/15 text-track-text'
            : 'bg-primary/15 text-primary'
        }`}>
          {item.status === 'completed' ? <CheckCircle2 className="w-4 h-4" />
            : item.status === 'failed' ? <XCircle className="w-4 h-4" />
            : <Loader2 className="w-4 h-4 animate-spin" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-medium text-on-surface truncate">{asText(item.label)}</p>
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
        {item.status === 'completed' && item.simulated && (
          <span className="px-2 py-1 rounded-cw-sm border border-track-text/50 bg-track-text/10 text-caption font-medium text-track-text"
            title="演示模式 — 未真实渲染，仅本地模拟进度">
            演示模式
          </span>
        )}
        {item.status === 'completed' && !item.simulated && (item.filename || item.output_path) && (
          <button
            onClick={() => {
              renderApi.downloadFile(item.filename ?? '', item.output_path)
                .catch(() => toast('下载失败 — 请重试', 'error'));
            }}
            className="p-2 rounded-cw-sm bg-track-audio/15 text-track-audio hover:bg-track-audio/25 transition-colors cursor-pointer"
            title="下载"
            aria-label="下载成片"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
        {item.status === 'completed' && (item.warnings?.length || item.coverPaths?.length) ? (
          <div className="col-span-full mt-1 space-y-1">
            {(item.warnings ?? []).slice(0, 4).map((w, wi) => (
              <div key={wi} className="text-caption text-track-text/80">⚠️ {w}</div>
            ))}
            {(item.coverPaths ?? []).length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {(item.coverPaths ?? []).map((cp) => (
                  <a key={cp} href={cp} target="_blank" rel="noreferrer"
                     className="text-caption text-primary hover:underline">封面</a>
                ))}
              </div>
            )}
          </div>
        ) : null}
        {/* P8: 渲染后添加水印（工具级；调用后端 watermark 工具） */}
        {item.status === 'completed' && !item.simulated && (item.filename || item.output_path) && (
          <button
            onClick={() => {
              const base = item.output_path || (item.filename ? `renders/${item.filename}` : '');
              if (!base) { toast('无渲染产物路径', 'error'); return; }
              toast('正在添加水印…', 'info');
              toolApi.execute('watermark', { input_path: base, text: 'ClipWright' })
                .then((res) => {
                  if (res.status === 'success') {
                    toast('水印已添加', 'success');
                  } else {
                    toast(`水印失败：${res.error ?? '未知错误'}`, 'error');
                  }
                })
                .catch(() => toast('水印失败（后端离线）', 'error'));
            }}
            className="p-2 rounded-cw-sm bg-track-text/15 text-track-text hover:bg-track-text/25 transition-colors cursor-pointer"
            title="添加水印"
            aria-label="添加水印"
          >
            <Wand2 className="w-4 h-4" />
          </button>
        )}
        {active && onCancel && (
          <button
            onClick={() => {
              if (!window.confirm('确认取消该渲染任务？')) return;
              onCancel();
            }}
            className="p-2 rounded-cw-sm bg-error/10 text-error hover:bg-error/20 transition-colors cursor-pointer"
            title="取消渲染"
            aria-label="取消渲染"
          >
            <XCircle className="w-4 h-4" />
          </button>
        )}
        {item.status === 'failed' && onRetry && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onRetry('snapshot')}
              className="flex items-center gap-1 px-2 py-1 rounded-cw-sm border border-error/40 bg-error/10 text-caption font-medium text-error hover:bg-error/20 transition-colors cursor-pointer"
              title={item.retryFingerprint
                ? `用提交时的快照重新渲染（快照指纹 ${item.retryFingerprint}）`
                : '用相同参数重新提交渲染'}
              data-testid="export-retry-snapshot"
            >
              <RotateCcw className="w-3 h-3" /> 重试本次提交
            </button>
            {changed && (
              <button
                onClick={() => onRetry('current')}
                className="flex items-center gap-1 px-2 py-1 rounded-cw-sm border border-outline-variant/50 bg-surface-container-high text-caption font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                title={`时间线已改动（当前指纹 ${currentFingerprint}），这不是重试而是重新提交`}
                data-testid="export-retry-current"
              >
                用当前时间线重新提交
              </button>
            )}
          </div>
        )}
      </div>
      {/* 失败详情（U14） */}
      {item.status === 'failed' && item.detail && (
        <p className="mt-1.5 text-caption text-error">{asText(item.detail)}</p>
      )}
      {/* 时间线指纹：让"重试跑的是哪一版"可核对，而不是嘴上说说 */}
      {item.retryFingerprint && (
        <p className="mt-1 text-caption text-on-surface-variant/60" data-testid="export-fingerprint">
          提交快照 {fingerprintLabel(item.retryFingerprint)}
          {changed && currentFingerprint && (
            <span className="text-error/80">
              {' '}· 时间线已改动（当前 {fingerprintLabel(currentFingerprint)}）
            </span>
          )}
        </p>
      )}
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
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  return (
    <div>
      <label className="block text-label text-on-surface-variant mb-1">{label}</label>
      <input
        type="number"
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const raw = Number(text);
          if (text.trim() === '' || !isFinite(raw) || raw <= 0) { setText(String(value)); return; }
          const lo = min ?? raw;
          const hi = max ?? raw;
          onChange(Math.min(Math.max(raw, lo), hi));
        }}
        min={min} max={max} step={step}
        className="w-full bg-surface rounded-cw-xs px-2 py-1.5 text-body-sm font-mono text-on-surface outline-none border border-outline-variant/30 focus:border-primary"
      />
    </div>
  );
}

/**
 * U18: 从恢复的后端任务中解析原始标签与预设名。
 * 文件名形如 `renders/项目名_1920x1080.mp4`：去前缀与 `_WxH.mp4` 后缀恢复项目名，
 * 由高度推导预设名（如 `1080p`）；无法解析时回退到通用占位。
 */
function parseRestoredTask(t: RenderProgress): { label: string; presetName: string; filename?: string } {
  const extra = t as RenderProgress & { filename?: string; output_path?: string };
  const raw = extra.filename ?? extra.output_path;
  if (raw) {
    const base = raw.split(/[/\\]/).filter(Boolean).pop() ?? '';
    const m = base.match(/^(.+)_(\d+)x(\d+)\.mp4$/i);
    if (m) return { label: m[1], presetName: `${m[3]}p`, filename: base };
    if (base) return { label: base.replace(/\.mp4$/i, ''), presetName: '—', filename: base };
  }
  return { label: '恢复的任务', presetName: '—' };
}

function phaseLabel(p: string): string {  const map: Record<string, string> = { prepare: '准备', trim: '裁剪', concat: '拼接', text: '文字', mg: '动画', overlay: '叠加', audio: '音频', done: '完成' };
  return map[p] ?? p;
}

/** CQ/CRF → 经验码率（1080p30 图文/慢镜头的实测中位数）。 */
const CQ_BITRATE_MBPS: Record<number, number> = {
  18: 3.2, 20: 2.6, 22: 2.1, 24: 1.8, 26: 1.5, 28: 1.2, 30: 1.0, 32: 0.8,
};

function estimateSize(durationSec: number, bitrate: string): string {
  const q = /^(?:cq|crf)[:\s]?(\d{1,2})$/i.exec(bitrate.trim());
  const mbps = q
    ? (CQ_BITRATE_MBPS[Number(q[1])] ?? 1.5)
    : (parseFloat(bitrate.replace('M', '')) || 5);
  const mb = (mbps * durationSec) / 8;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}
