import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, Upload, Loader2, Film, Image as ImageIcon, Music, AlertTriangle } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { connectSseStream, type SseStreamHandle } from '@/services/api/sseStream';
import {
  workspaceApi, type WorkspaceStatus, type WorkspaceMaterial, type WorkspaceEvent,
} from '@/services/api';

/**
 * 工作区素材面板（PRD docs/workspace-prd-2026-10-24.md；PRD B2 2026-10-29 增强）。
 *
 * 三件事：显示工作区状态、触发扫描（**带逐条进度**）、上传素材。
 *
 * B2 之前：扫描只有一个 loading 转圈 + 一句汇总，看不到进度；`workspaceApi.eventsUrl()`
 * 拼的是 JSON 端点且全仓 0 处调用（死方法）。现在：首屏用 `/events`（JSON 快照）回填，
 * 点扫描时订阅 `/events/stream`（SSE，按 seq 去重、从 last_seq 续传），失败项单独列出。
 */

const KIND_ICON: Record<string, typeof Film> = { video: Film, image: ImageIcon, audio: Music };
/** 进度列表最多留这么多条（长扫描上千条，全渲染会卡） */
const MAX_PROGRESS = 200;
const PROGRESS_SHOWN = 8;

function fmtSize(n: number): string {
  if (!n) return '0B';
  if (n > 1 << 30) return `${(n / (1 << 30)).toFixed(1)}GB`;
  if (n > 1 << 20) return `${(n / (1 << 20)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

/** 只认工作区事件形状（有 seq），其余丢弃——不猜。 */
export function toWorkspaceEvent(raw: unknown): WorkspaceEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const ev = raw as Partial<WorkspaceEvent>;
  if (typeof ev.seq !== 'number') return null;
  return {
    seq: ev.seq,
    ts: typeof ev.ts === 'number' ? ev.ts : 0,
    level: String(ev.level ?? 'info'),
    message: String(ev.message ?? ''),
    detail: (ev.detail as Record<string, unknown>) ?? {},
  };
}

/** 合并事件并按 seq 去重（重连会重发同样的帧）。 */
export function mergeEvents(prev: WorkspaceEvent[], incoming: WorkspaceEvent[]): WorkspaceEvent[] {
  const seen = new Set(prev.map((e) => e.seq));
  const merged = [...prev];
  for (const ev of incoming) {
    if (seen.has(ev.seq)) continue;
    seen.add(ev.seq);
    merged.push(ev);
  }
  merged.sort((a, b) => a.seq - b.seq);
  return merged.slice(-MAX_PROGRESS);
}

export interface ScanFailure { rel: string; reason: string; sha256?: string }

/**
 * 从扫描报告 + 事件 detail 里收集失败项。
 *
 * 后端**没有**单文件重试端点（只有整批 scan / upload），所以这里只做可见性：
 * 用户能看到"哪个文件（sha256 前 8 位）、为什么失败"，再决定是否整批重扫。
 */
export function collectFailures(
  report: { items?: Array<{ rel: string; status?: string; vision?: string; sha256?: string }> } | null,
  events: WorkspaceEvent[],
): ScanFailure[] {
  const out = new Map<string, ScanFailure>();
  for (const item of report?.items ?? []) {
    if (item.status === 'failed') {
      out.set(item.rel, { rel: item.rel, reason: item.vision || '索引失败', sha256: item.sha256 });
    }
  }
  for (const ev of events) {
    if (ev.level !== 'error' && ev.level !== 'warning') continue;
    const failed = (ev.detail || {}).failed;
    if (!Array.isArray(failed)) continue;
    for (const f of failed) {
      if (typeof f === 'string') {
        out.set(f, { rel: f, reason: ev.message });
        continue;
      }
      if (f && typeof f === 'object') {
        const rec = f as Record<string, unknown>;
        const rel = String(rec.rel ?? rec.path ?? '');
        if (rel) out.set(rel, { rel, reason: String(rec.reason ?? ev.message) });
      }
    }
  }
  return Array.from(out.values()).slice(0, 50);
}

export function WorkspaceMaterialsPanel({ projectId, compact = false }: {
  projectId: string;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [items, setItems] = useState<WorkspaceMaterial[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // PRD B2：扫描/索引进度与失败项
  const [progress, setProgress] = useState<WorkspaceEvent[]>([]);
  const [failures, setFailures] = useState<ScanFailure[]>([]);
  const lastSeqRef = useRef(0);
  const streamRef = useRef<SseStreamHandle | null>(null);

  const appendEvents = useCallback((incoming: WorkspaceEvent[]) => {
    if (!incoming.length) return;
    setProgress((prev) => mergeEvents(prev, incoming));
    for (const ev of incoming) {
      if (ev.seq > lastSeqRef.current) lastSeqRef.current = ev.seq;
    }
    const found = collectFailures(null, incoming);
    if (found.length) {
      setFailures((prev) => {
        const map = new Map(prev.map((f) => [f.rel, f]));
        for (const f of found) map.set(f.rel, f);
        return Array.from(map.values()).slice(0, 50);
      });
    }
  }, []);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const st = await workspaceApi.get(projectId);
      setStatus(st);
      const list = await workspaceApi.materials(projectId);
      setItems(list.items ?? []);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(String(err?.response?.data?.detail ?? err?.message ?? e));
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  // 首屏回填：JSON 快照（刷新/断线后也能看到最近发生过什么）
  useEffect(() => {
    let alive = true;
    if (!projectId) return undefined;
    lastSeqRef.current = 0;
    setProgress([]);
    workspaceApi.events(projectId, 0)
      .then((batch) => {
        if (!alive) return;
        appendEvents(batch.events ?? []);
        if (batch.last_seq > lastSeqRef.current) lastSeqRef.current = batch.last_seq;
      })
      .catch(() => { /* 事件端点不可用不阻断素材列表 */ });
    return () => { alive = false; };
  }, [projectId, appendEvents]);

  // 卸载/切项目必须关流（否则 EventSource 泄漏、事件串台）
  useEffect(() => () => {
    streamRef.current?.close();
    streamRef.current = null;
  }, [projectId]);

  const scan = async () => {
    setBusy(true);
    setNote(null);
    setFailures([]);
    // 先订阅再触发扫描：扫描很快结束时也不会丢掉最早几帧
    const since = lastSeqRef.current;
    streamRef.current?.close();
    try {
      streamRef.current = connectSseStream({
        url: workspaceApi.eventsStreamUrl(projectId, since),
        onMessage: (raw) => {
          const ev = toWorkspaceEvent(raw);
          if (ev) appendEvents([ev]);
        },
      });
    } catch {
      /* SSE 不可用时仍可扫描，只是没有逐条进度 */
    }
    try {
      const rep = await workspaceApi.scan(projectId);
      setNote(`扫描 ${rep.scanned} 个文件：新增 ${rep.new}，索引 ${rep.indexed}，去重 ${rep.deduped}，失败 ${rep.failed}`);
      const found = collectFailures(rep, []);
      if (found.length) {
        setFailures((prev) => {
          const map = new Map(prev.map((f) => [f.rel, f]));
          for (const f of found) map.set(f.rel, f);
          return Array.from(map.values()).slice(0, 50);
        });
      }
      await reload();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(String(err?.response?.data?.detail ?? err?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setNote(null);
    try {
      const res = await workspaceApi.upload(projectId, file);
      setNote(`已上传 ${file.name}（${res.kind}），索引 ${res.scan.indexed} 个`);
      setFailures(collectFailures(res.scan, []));
      await reload();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(String(err?.response?.data?.detail ?? err?.message ?? e));
    } finally {
      setUploading(false);
    }
  };

  if (!projectId) {
    return <p className="text-caption text-on-surface-variant/70">工作区会在启动制作时按项目创建。</p>;
  }

  const counts = status?.counts;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-caption text-on-surface-variant">
          <FolderOpen className="w-3.5 h-3.5" />
          <code className="font-mono text-caption break-all">{status?.root || '（未创建）'}</code>
        </span>
        {status?.health === 'degraded' && <Badge variant="warning">目录不可写</Badge>}
        <span className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={scan} disabled={busy || !status?.exists}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            立即扫描
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              className="hidden"
              accept=".mp4,.mov,.mkv,.webm,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a,.flac"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }}
            />
            <Button size="sm" variant="outline" disabled={uploading || !status?.exists}
              onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement)?.click()}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              上传
            </Button>
          </label>
        </span>
      </div>

      {counts && (
        <p className="text-caption text-on-surface-variant">
          素材 {counts.total}（视频 {counts.video} / 图 {counts.image} / 音 {counts.audio}）·
          已索引 {counts.indexed} · 待索引 {counts.pending}
          {status?.scan?.last_scan_at ? ` · 最近扫描 ${status.scan.last_scan_at.replace('T', ' ').replace('Z', '')}` : ''}
          {status?.index?.vision ? ` · 视觉解读 ${status.index.provider || 'clip'}` : ' · 视觉解读已关闭'}
        </p>
      )}

      {note && <p className="text-caption text-primary">{note}</p>}
      {error && <p className="text-caption text-error">{error}</p>}

      {/* PRD B2：逐条进度（来自 /events/stream，按 seq 去重，最多展示最近 8 条） */}
      {progress.length > 0 && (
        <div data-testid="workspace-progress" className="rounded-cw-sm bg-surface-container px-2.5 py-1.5">
          <p className="text-caption text-on-surface-variant/70">
            索引进度（最近 {Math.min(progress.length, PROGRESS_SHOWN)} 条 · 共 {progress.length} 条）
          </p>
          <ul className="mt-1 space-y-0.5">
            {progress.slice(-PROGRESS_SHOWN).map((ev) => (
              <li
                key={ev.seq}
                data-event-seq={ev.seq}
                className={
                  ev.level === 'error'
                    ? 'font-mono text-caption text-error'
                    : ev.level === 'warning'
                      ? 'font-mono text-caption text-warning'
                      : 'font-mono text-caption text-on-surface-variant'
                }
              >
                #{ev.seq} {ev.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* PRD B2：失败项明细（后端无单文件重试端点，这里只做可见性 + 整批重扫） */}
      {failures.length > 0 && (
        <div data-testid="workspace-failures" className="rounded-cw-sm bg-error/8 px-2.5 py-1.5">
          <p className="flex items-center gap-1.5 text-caption text-error">
            <AlertTriangle className="w-3.5 h-3.5" />
            {failures.length} 个文件索引失败（可整批重扫；单项重试需后端新端点）
          </p>
          <ul className="mt-1 space-y-0.5">
            {failures.slice(0, 20).map((f) => (
              <li key={f.rel} className="font-mono text-caption text-on-surface-variant break-all">
                {f.sha256 && <span className="mr-1 text-on-surface-variant/50">{f.sha256.slice(0, 8)}</span>}
                {f.rel} — {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length > 0 && (
        <div className={compact ? 'max-h-40 overflow-auto' : 'max-h-72 overflow-auto'}>
          <table className="w-full text-left text-caption">
            <thead className="sticky top-0 bg-surface-container-high">
              <tr className="text-on-surface-variant">
                <th className="px-2 py-1 font-mono">素材</th>
                <th className="px-2 py-1">类型</th>
                <th className="px-2 py-1">状态</th>
                <th className="px-2 py-1">标签</th>
                <th className="px-2 py-1">画面（视觉解读）</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 50).map((m) => {
                const Icon = KIND_ICON[m.kind] ?? Film;
                const vision = m.vision;
                const degraded = vision?.status === 'degraded' || vision?.source === 'filename';
                const visionText = vision?.summary || (vision?.tags ?? []).join('、');
                return (
                  <tr key={m.sha256} className="border-t border-outline-variant/20">
                    <td className="px-2 py-1 max-w-[240px] truncate" title={m.path}>{m.rel || m.path}</td>
                    <td className="px-2 py-1"><Icon className="w-3 h-3 inline mr-1" />{m.kind}</td>
                    <td className="px-2 py-1">
                      <span className={m.status === 'indexed' ? 'text-primary' : 'text-on-surface-variant'}>
                        {m.status}
                      </span>
                      {vision?.status && vision.status !== 'ok' && (
                        <span className="text-on-surface-variant/60"> · vision:{vision.status}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 max-w-[220px] truncate text-on-surface-variant">
                      {(m.tags ?? []).slice(0, 4).join('、') || '—'}
                    </td>
                    <td
                      className="px-2 py-1 max-w-[260px] truncate"
                      title={visionText ? `${vision?.source ? `[${vision.source}] ` : ''}${visionText}` : ''}
                    >
                      {visionText ? (
                        <span className={degraded ? 'text-amber-600' : 'text-on-surface'}>
                          {vision?.source && (
                            <span className="text-caption text-on-surface-variant/70 mr-1">
                              {vision.source === 'llm' ? '模型' : vision.source === 'filename' ? '未读画面' : vision.source}
                            </span>
                          )}
                          {visionText}
                        </span>
                      ) : (
                        <span className="text-on-surface-variant/60">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
