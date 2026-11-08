/**
 * 工作区媒体库（按目录结构列出工作区里**全部**媒体文件）。
 *
 * 2026-11-02 用户要求：左侧资源库不能只看"索引注册表"——工作区里用户自己建的目录
 * （`materials/实拍/`、`materials/参考/`…）要按**原本的目录样式**呈现，而且未索引的
 * 视频/图片/音频同样要能看见。
 *
 * 数据源：`GET /api/workspace/{project_id}/media-tree`（实时目录树，不是注册表）。
 * 系统目录（assets/cache/logs/artifacts/reports/docs…）由后端跳过，不会混进来。
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Film, Image as ImageIcon, Music, RefreshCw, FolderOpen } from 'lucide-react';

import { workspaceApi } from '@/services/api';
import { useProjectStore } from '@/stores/projectStore';
import { asText } from '@/lib/render';

interface MediaFile {
  path: string; rel: string; name: string; kind: string; size: number; mtime: number;
}
interface MediaDir { dir: string; count: number; files: MediaFile[] }
interface MediaTree { root: string; count: number; kinds: Record<string, number>; dirs: MediaDir[] }

const KIND_ICON: Record<string, typeof Film> = {
  video: Film, image: ImageIcon, audio: Music,
};
const KIND_CN: Record<string, string> = { video: '视频', image: '图片', audio: '音频' };

function sizeText(bytes: number): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function WorkspaceMediaTree({ search = '' }: { search?: string }) {
  const projectId = useProjectStore((s) => s.projectId);
  const [tree, setTree] = useState<MediaTree | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  // 旧素材库里"不在工作区"的文件数（0 = 没有要迁的，不显示任何入口）
  const [legacyPending, setLegacyPending] = useState(0);

  const load = async () => {
    if (!projectId) { setTree(null); return; }
    setBusy(true);
    setError('');
    try {
      const data = await workspaceApi.mediaTree(projectId);
      setTree(data as MediaTree);
      // 顺带问一次旧库（失败不影响主流程：旧库可能根本不存在）
      try {
        const legacy = await workspaceApi.legacyAssets(projectId);
        setLegacyPending((legacy.assets || []).filter((a) => !a.in_workspace && a.exists).length);
      } catch {
        setLegacyPending(0);
      }
    } catch (e) {
      setError(`读取工作区失败：${asText((e as Error)?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 显式迁移旧素材（devplan T3.3）。
   *
   * 两步走：先 dry-run 拿"将复制几个 / 复用几个"，把数字摆给用户看；确认后才真复制。
   * 迁移是**复制**（不移动、不删源），所以即使中途失败也不会丢素材。
   */
  const importLegacy = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const plan = await workspaceApi.legacyImport(projectId, true);
      const willCopy = (plan.planned || []).filter((p) => p.status === 'planned' || p.status === 'copy').length;
      if (willCopy === 0) {
        setLegacyPending(0);
        setBusy(false);
        return;
      }
      const ok = window.confirm(
        `把旧素材库的 ${willCopy} 个文件复制到工作区 materials/？\n`
        + '（只复制不移动，源文件保留；同内容文件会被去重跳过）',
      );
      if (!ok) { setBusy(false); return; }
      const res = await workspaceApi.legacyImport(projectId, false);
      setLegacyPending(
        res.migrated + res.failed > 0 ? Math.max(0, legacyPending - res.migrated) : legacyPending,
      );
      await load();
    } catch (e) {
      setError(`导入旧素材失败：${asText((e as Error)?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  // 只随 projectId 重取：load 的身份每次渲染都会变，进依赖会自激
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [projectId]);

  const kw = search.trim().toLowerCase();
  const dirs = useMemo(() => {
    const rows = tree?.dirs ?? [];
    if (!kw) return rows;
    return rows
      .map((d) => ({ ...d, files: d.files.filter((f) => f.name.toLowerCase().includes(kw)) }))
      .filter((d) => d.files.length > 0);
  }, [tree, kw]);

  if (!projectId) {
    return <p className="p-3 text-caption text-on-surface-variant">打开一个项目后才能浏览工作区素材。</p>;
  }

  return (
    <div className="space-y-2" data-testid="workspace-media-tree">
      <div className="flex items-center gap-2 text-caption text-on-surface-variant">
        <FolderOpen className="h-3 w-3 shrink-0" />
        <span className="truncate" title={tree?.root || ''}>
          {tree ? `${asText(tree.root)}` : '读取工作区…'}
        </span>
        <span className="shrink-0 text-on-surface-variant/60">
          {tree ? `${tree.count} 个媒体` : ''}
          {tree && Object.keys(tree.kinds).length > 0
            ? `（${Object.entries(tree.kinds).map(([k, n]) => `${KIND_CN[k] || k} ${n}`).join(' · ')}）`
            : ''}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto shrink-0 rounded-cw-xs border border-outline-variant/40 p-0.5 hover:border-primary"
          title="重新扫描工作区"
          data-testid="workspace-media-refresh"
        >
          <RefreshCw className={busy ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
        </button>
      </div>

      {error && <p className="text-caption text-error">{error}</p>}

      {/* devplan T3.3/T3.4：旧素材库的**显式**迁移入口。
          为什么不自动搬：旧库里可能是几十 GB 的素材，静默复制会吃掉磁盘；
          迁移只复制不移动，源文件永远留着。先 dry-run 拿计划，再确认执行。 */}
      {legacyPending > 0 && (
        <div className="flex items-center gap-2 rounded-cw-xs border border-outline-variant/40 px-1.5 py-1"
          data-testid="legacy-assets-banner">
          <span className="text-caption text-on-surface-variant/80">
            旧素材库里还有 {legacyPending} 个文件不在工作区
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void importLegacy()}
            className="ml-auto shrink-0 rounded-cw-xs border border-primary/50 px-1.5 py-0.5 text-caption text-primary hover:bg-primary/10 disabled:opacity-50"
            data-testid="legacy-import-button"
          >
            导入到工作区
          </button>
        </div>
      )}

      {tree && tree.count === 0 && (
        <p className="text-caption text-on-surface-variant/70">
          工作区里还没有媒体文件：上传或让 Agent 跑一轮后，这里会按目录结构列出来。
        </p>
      )}

      {dirs.map((d) => {
        const key = d.dir || '(根目录)';
        const isFolded = folded[key] === true;
        return (
          <section key={key} data-dir={d.dir}>
            <button
              type="button"
              onClick={() => setFolded((prev) => ({ ...prev, [key]: !isFolded }))}
              className="flex w-full items-center gap-1 rounded-cw-xs px-1 py-0.5 text-caption font-mono text-on-surface-variant hover:bg-surface-container"
            >
              {isFolded ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              <span className="truncate">{asText(key)}</span>
              <span className="ml-auto shrink-0 text-on-surface-variant/50">{d.count}</span>
            </button>
            {!isFolded && (
              <ul className="mt-0.5 space-y-0.5 pl-4">
                {d.files.slice(0, 200).map((f) => {
                  const Icon = KIND_ICON[f.kind] || Film;
                  return (
                    <li
                      key={f.path}
                      data-media-path={f.path}
                      className="flex items-center gap-1.5 rounded-cw-xs px-1 py-0.5 text-caption text-on-surface hover:bg-surface-container"
                      title={`${asText(f.path)}\n${KIND_CN[f.kind] || f.kind} · ${sizeText(f.size)}`}
                    >
                      <Icon className="h-3 w-3 shrink-0 text-on-surface-variant/70" />
                      <span className="truncate">{asText(f.name)}</span>
                      <span className="ml-auto shrink-0 text-on-surface-variant/50">{sizeText(f.size)}</span>
                    </li>
                  );
                })}
                {d.files.length > 200 && (
                  <li className="pl-1 text-caption text-on-surface-variant/50">
                    还有 {d.files.length - 200} 个文件（用搜索缩小范围）
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
