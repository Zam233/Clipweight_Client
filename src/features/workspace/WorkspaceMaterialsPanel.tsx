import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Upload, Loader2, Film, Image as ImageIcon, Music } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { workspaceApi, type WorkspaceStatus, type WorkspaceMaterial } from '@/services/api';

/**
 * 工作区素材面板（PRD docs/workspace-prd-2026-10-24.md）。
 *
 * 只做三件事：显示工作区状态、触发扫描、上传素材。
 * 「用户手动往 materials/ 丢文件 → 自动索引」是后端轮询负责的；这里给的是
 * 可见性与手动补一刀的能力（尤其是后端没开轮询/刚丢完想立刻看到结果时）。
 */

const KIND_ICON: Record<string, typeof Film> = { video: Film, image: ImageIcon, audio: Music };

function fmtSize(n: number): string {
  if (!n) return '0B';
  if (n > 1 << 30) return `${(n / (1 << 30)).toFixed(1)}GB`;
  if (n > 1 << 20) return `${(n / (1 << 20)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
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

  const scan = async () => {
    setBusy(true);
    setNote(null);
    try {
      const rep = await workspaceApi.scan(projectId);
      setNote(`扫描 ${rep.scanned} 个文件：新增 ${rep.new}，索引 ${rep.indexed}，去重 ${rep.deduped}，失败 ${rep.failed}`);
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
