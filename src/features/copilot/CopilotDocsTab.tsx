/**
 * 文档标签（PRD §19.6 / 需求 2、3）：子 agent 的报告 + 需求阶段的 brief/plan。
 *
 * 只读展示：编辑权在主 agent 的 `edit_file` 与用户的对话改写，前端不提供编辑。
 */
import React from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { workspaceApi, type WorkspaceDoc, type WorkspaceReport } from '@/services/api';

export function CopilotDocsTab({ projectId }: { projectId: string }) {
  const [docs, setDocs] = React.useState<WorkspaceDoc[]>([]);
  const [reports, setReports] = React.useState<WorkspaceReport[]>([]);
  const [openSeq, setOpenSeq] = React.useState<number | null>(null);
  const [content, setContent] = React.useState('');
  const [openDoc, setOpenDoc] = React.useState<string>('');
  const [note, setNote] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setNote('');
    try {
      const [d, r] = await Promise.all([
        workspaceApi.docs(projectId).catch(() => ({ docs: [] as WorkspaceDoc[] })),
        workspaceApi.reports(projectId).catch(() => ({ reports: [] as WorkspaceReport[] })),
      ]);
      setDocs(d.docs ?? []);
      setReports(r.reports ?? []);
    } catch (e) {
      setNote(`加载失败：${String((e as Error)?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const readReport = async (seq: number) => {
    setOpenSeq(seq);
    setOpenDoc('');
    try {
      const res = await workspaceApi.report(projectId, seq);
      setContent(res.content);
    } catch (e) {
      setContent(`读取失败：${String((e as Error)?.message || e)}`);
    }
  };

  const pickDoc = (doc: WorkspaceDoc) => {
    setOpenSeq(null);
    setOpenDoc(doc.name);
    setContent(doc.content);
  };

  /** PRD B9：报告/文档要能回链到具体产物（路径可见 + 可复制），而不是只有正文 */
  const copyPath = (path: string) => { void navigator.clipboard?.writeText(path); };
  const openPath = openSeq != null
    ? reports.find((r) => r.seq === openSeq)?.path ?? ''
    : docs.find((d) => d.name === openDoc)?.path ?? '';

  if (!projectId) {
    return <div className="p-3 text-caption text-on-surface-variant">尚未绑定项目。</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="docs-tab">
      <div className="flex items-center justify-between border-b border-outline-variant/20 px-3 py-1.5">
        <span className="text-label-sm text-on-surface">工作区文档</span>
        <button
          type="button"
          className="rounded p-1 text-on-surface-variant hover:bg-surface-container"
          aria-label="刷新文档"
          onClick={() => void load()}
        >
          <RefreshCw className={loading ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
        </button>
      </div>
      {note && <p className="px-3 py-1 text-caption text-error">{note}</p>}

      <div className="max-h-40 overflow-auto border-b border-outline-variant/20 px-3 py-1">
        <p className="mb-1 text-caption text-on-surface-variant/70">需求文档</p>
        {docs.length === 0 && <p className="text-caption text-on-surface-variant/60">（还没有 docs/*.md）</p>}
        {docs.map((d) => (
          <button
            key={d.path}
            type="button"
            data-doc={d.name}
            className="mr-2 inline-flex items-center gap-1 text-caption text-primary hover:underline"
            onClick={() => pickDoc(d)}
          >
            <FileText className="h-3 w-3" />{d.name}
          </button>
        ))}
      </div>

      <div className="max-h-40 overflow-auto border-b border-outline-variant/20 px-3 py-1">
        <p className="mb-1 text-caption text-on-surface-variant/70">子 agent 报告</p>
        {reports.length === 0 && <p className="text-caption text-on-surface-variant/60">（还没有报告）</p>}
        {reports.map((r) => (
          <button
            key={r.seq}
            type="button"
            data-report={r.seq}
            className="block w-full truncate text-left text-caption hover:text-primary"
            onClick={() => void readReport(r.seq)}
          >
            #{r.seq} {r.stage}（{r.status}）— {r.next_for || r.preview || r.headline}
          </button>
        ))}
      </div>

      {openPath && (
        <div className="flex items-center gap-2 border-b border-outline-variant/20 px-3 py-1">
          <code className="min-w-0 flex-1 truncate font-mono text-caption text-on-surface-variant/70" data-testid="docs-open-path">
            {openPath}
          </code>
          <button
            type="button"
            data-testid="docs-copy-path"
            className="shrink-0 rounded-cw-xs border border-outline-variant/40 px-2 py-0.5 text-caption text-on-surface-variant hover:border-outline hover:text-on-surface cursor-pointer"
            onClick={() => copyPath(openPath)}
          >
            复制路径
          </button>
        </div>
      )}

      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 text-caption text-on-surface">
        {content || (openSeq || openDoc ? '' : '点上面的条目看内容（只读）。')}
      </pre>
    </div>
  );
}
