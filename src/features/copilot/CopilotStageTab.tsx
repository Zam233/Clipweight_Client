/**
 * 阶段详情标签（PRD §19.10）：该阶段的报告卡（来自 docs/reports）+ 事件摘要。
 */
import React from 'react';
import { workspaceApi, type WorkspaceReport } from '@/services/api';
import { asText } from '@/lib/render';

export function CopilotStageTab({ projectId, stage }: { projectId?: string; stage?: string }) {
  const [reports, setReports] = React.useState<WorkspaceReport[]>([]);
  const [content, setContent] = React.useState('');
  const [openSeq, setOpenSeq] = React.useState<number | null>(null);
  const [nextOffset, setNextOffset] = React.useState<number | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [protoError, setProtoError] = React.useState('');
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    if (!projectId || !stage) return undefined;
    const load = async () => {
      try {
        const res = await workspaceApi.reports(projectId, 200);
        if (!alive) return;
        setReports((res.reports ?? []).filter((r) => r.stage === stage));
      } catch (e) {
        if (alive) setNote(`加载失败：${String((e as Error)?.message || e)}`);
      }
    };
    void load();
    return () => { alive = false; };
  }, [projectId, stage]);

  const readReport = async (seq: number) => {
    setOpenSeq(seq);
    setNextOffset(null);
    setProtoError('');
    setContent('');
    try {
      const res = await workspaceApi.report(projectId ?? '', seq);
      if (res.schema_version !== 2) {
        setProtoError(`协议错误：报告 DTO schema_version=${String(res.schema_version)}`);
      }
      setContent(res.content ?? '');
      setNextOffset(res.next_offset ?? null);
    } catch (e) {
      setProtoError(`读取失败：${String((e as Error)?.message || e)}`);
    }
  };

  const loadMore = async () => {
    if (openSeq == null || nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await workspaceApi.report(projectId ?? '', openSeq, { offset: nextOffset });
      setContent((prev) => `${prev}${res.content ?? ''}`);
      setNextOffset(res.next_offset ?? null);
    } catch (e) {
      setProtoError(`续读失败：${String((e as Error)?.message || e)}`);
    } finally {
      setLoadingMore(false);
    }
  };

  if (!projectId || !stage) {
    return <div className="p-3 text-caption text-on-surface-variant">缺少阶段或项目标识。</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-3 text-caption" data-testid="stage-tab">
      <p className="mb-1 text-label-sm text-on-surface">阶段：{stage}</p>
      {note && <p className="text-error">{note}</p>}
      {reports.length === 0 && <p className="text-on-surface-variant">该阶段还没有报告（或未运行过）。</p>}
      <ul className="mb-2 space-y-1">
        {reports.map((r) => (
          <li key={r.seq}>
            <button
              type="button"
              className="text-left text-primary hover:underline"
              onClick={() => void readReport(r.seq)}
            >
              #{r.seq} {asText(r.status)} — {r.schema_version !== 2
                ? '协议错误'
                : (asText(r.summary || r.handoff_summary)
                  || (r.report_state === 'unavailable' ? '正文不可读'
                  : r.report_state === 'not_applicable' ? '（无需报告）'
                  : '（无摘要）'))}
            </button>
          </li>
        ))}
      </ul>
      {protoError && (
        <p className="text-error" data-testid="stage-report-error">{protoError}</p>
      )}
      {openSeq != null && nextOffset != null && (
        <button
          type="button"
          data-testid="stage-report-more"
          className="mb-1 w-fit rounded-cw-xs border border-outline-variant/40 px-2 py-0.5 text-caption text-on-surface-variant disabled:opacity-50"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? '加载中…' : '继续读取'}
        </button>
      )}
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-surface-container p-2">
        {content}
      </pre>
    </div>
  );
}
