/**
 * 调度抽屉（前端 F1/F4/F7）：决策记录 / 诊断书 / 成本 / 子代理 / 执行 / 改派 / 待审。
 *
 * 数据一律来自 `supervisorStore`（由 hydrate + SSE 增量维护），组件本身不发请求；
 * 动作通过 store 的动作发出去，页面级确认（`onAcceptSuggestion`）才上抛。
 */

import { X } from 'lucide-react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { DiagnosisSuggestion, ExecResponse, PendingExecApproval } from '@/types/supervisor';
import { useSupervisorStore, type SupervisorTab } from '@/stores/supervisorStore';
import { useEffect, useState } from 'react';

import { AutoModeSwitch } from './AutoModeSwitch';
import { BudgetBar } from './BudgetBar';
import { DecisionTimeline } from './DecisionTimeline';
import { DiagnosisCard } from './DiagnosisCard';
import { DispatchForm } from './DispatchForm';
import { ExecLevelBadge } from './ExecLevelBadge';
import { ExecLogList } from './ExecLogList';
import { ExecPermissionDialog } from './ExecPermissionDialog';
import { ExecRequestForm } from './ExecRequestForm';
import { SubagentTree } from './SubagentTree';
import { WorkerReviewQueue } from './WorkerReviewQueue';
import { strategyLabel, stageLabel } from './labels';

interface Props {
  onClose?: () => void;
  onAcceptSuggestion?: (suggestion: DiagnosisSuggestion) => void;
  actionPending?: string;
  className?: string;
}

const TABS: { id: SupervisorTab; label: string }[] = [
  { id: 'decisions', label: '决策记录' },
  { id: 'diagnosis', label: '诊断书' },
  { id: 'cost', label: '成本' },
  { id: 'subagents', label: '子代理' },
  { id: 'exec', label: '执行' },
  { id: 'dispatch', label: '改派' },
  { id: 'review', label: '待审' },
];

export function SupervisorDrawer({ onClose, onAcceptSuggestion, actionPending, className }: Props) {
  const ledger = useSupervisorStore((s) => s.ledger);
  const diagnosis = useSupervisorStore((s) => s.diagnosis);
  const budget = useSupervisorStore((s) => s.budget);
  const decisions = useSupervisorStore((s) => s.decisions);
  const activeTab = useSupervisorStore((s) => s.activeTab);
  const setActiveTab = useSupervisorStore((s) => s.setActiveTab);
  const loading = useSupervisorStore((s) => s.loading);
  const error = useSupervisorStore((s) => s.error);
  const pipelineId = useSupervisorStore((s) => s.pipelineId);
  const subagents = useSupervisorStore((s) => s.subagents);
  const execRecords = useSupervisorStore((s) => s.execRecords);
  const pendingReviews = useSupervisorStore((s) => s.pendingReviews);
  const pendingApprovals = useSupervisorStore((s) => s.pendingApprovals);
  const autoMode = useSupervisorStore((s) => s.autoMode);
  const hydrateExecution = useSupervisorStore((s) => s.hydrateExecution);
  const hydrateReviews = useSupervisorStore((s) => s.hydrateReviews);
  const setAutoMode = useSupervisorStore((s) => s.setAutoMode);
  const cancelSubagent = useSupervisorStore((s) => s.cancelSubagent);
  const reviewWorker = useSupervisorStore((s) => s.reviewWorker);
  const dispatchOrder = useSupervisorStore((s) => s.dispatchOrder);
  const requestExec = useSupervisorStore((s) => s.requestExec);
  const approveExec = useSupervisorStore((s) => s.approveExec);
  const rejectExec = useSupervisorStore((s) => s.rejectExec);

  // 改派工单的本地态：结果只在这一屏有意义，没必要入 store
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<{ requires_retry?: boolean } | null>(null);

  // 执行请求与授权弹窗的本地态
  const [execBusy, setExecBusy] = useState(false);
  const [execResult, setExecResult] = useState<ExecResponse | null>(null);
  const [approval, setApproval] = useState<PendingExecApproval | null>(null);

  const submitDispatch = async (order: { target_stage: string; reason: string }) => {
    if (!pipelineId) return;
    setDispatchBusy(true);
    try {
      const res = await dispatchOrder(pipelineId, order);
      setDispatchResult(res ? { requires_retry: res.requires_retry } : null);
    } finally {
      setDispatchBusy(false);
    }
  };

  const submitExec = async (body: { kind: 'shell' | 'python'; command?: string; code?: string }) => {
    if (!pipelineId) return;
    setExecBusy(true);
    try {
      const res = await requestExec(pipelineId, body);
      setExecResult(res);
      // 需要授权就直接把弹窗顶上来，不让用户去列表里找
      if (res?.status === 'pending_approval' && res.approval) setApproval(res.approval);
    } finally {
      setExecBusy(false);
    }
  };

  const decideApproval = async (approve: boolean, confirmHighRisk = false) => {
    if (!pipelineId || !approval) return;
    setExecBusy(true);
    try {
      if (approve) await approveExec(pipelineId, approval.id, confirmHighRisk);
      else await rejectExec(pipelineId, approval.id);
      setApproval(null);
    } finally {
      setExecBusy(false);
    }
  };

  // 切到「子代理/执行/审核」时才拉对应数据（首屏 hydrate 不背这么多请求）
  useEffect(() => {
    if (!pipelineId) return;
    if (activeTab === 'subagents' || activeTab === 'exec') {
      void hydrateExecution(pipelineId);
    }
    if (activeTab === 'review') void hydrateReviews();
  }, [activeTab, pipelineId, hydrateExecution, hydrateReviews]);

  return (
    <aside
      className={cn(
        'flex flex-col h-full w-[380px] border-l border-outline-variant/30 bg-surface-container-low',
        className,
      )}
      aria-label="调度面板"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/30">
        <div>
          <p className="text-body-sm font-semibold text-on-surface">调度</p>
          <p className="text-caption text-on-surface-variant">自动诊断与派工记录</p>
        </div>
        <Button size="sm" variant="outline" onClick={onClose} aria-label="关闭调度面板">
          <X className="w-3.5 h-3.5" />
        </Button>
      </header>

      <nav className="flex gap-1 px-3 py-2 border-b border-outline-variant/20" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-2.5 py-1 rounded-cw-sm text-caption transition-colors',
              activeTab === tab.id
                ? 'bg-primary-container text-on-primary-container'
                : 'text-on-surface-variant hover:bg-surface-container',
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading && <p className="text-caption text-on-surface-variant">加载中…</p>}
        {error && <p className="text-caption text-error">加载失败：{error}</p>}

        {activeTab === 'decisions' && (
          <>
            {decisions.length > 0 && (
              <section>
                <h4 className="text-caption font-semibold text-on-surface-variant mb-1">最近决策</h4>
                <ul className="space-y-1">
                  {decisions.slice(-5).reverse().map((d) => (
                    <li key={d.id} className="text-caption text-on-surface">
                      · {strategyLabel(d.strategy)}
                      {d.target_stage ? ` → ${stageLabel(d.target_stage)}` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <DecisionTimeline entries={ledger} />
          </>
        )}

        {activeTab === 'diagnosis' && (
          <DiagnosisCard
            report={diagnosis}
            onAction={onAcceptSuggestion}
            actionPending={actionPending}
          />
        )}

        {activeTab === 'cost' && <BudgetBar budget={budget} />}

        {activeTab === 'subagents' && (
          <SubagentTree
            nodes={subagents}
            onCancel={(node) => pipelineId && void cancelSubagent(pipelineId, node.id)}
          />
        )}

        {activeTab === 'exec' && (
          <div className="space-y-3">
            <AutoModeSwitch
              enabled={autoMode}
              onChange={(v) => pipelineId && void setAutoMode(pipelineId, v)}
            />
            <ExecRequestForm
              onSubmit={(body) => void submitExec(body)}
              busy={execBusy}
              result={execResult}
            />
            {pendingApprovals.length > 0 && (
              <section className="space-y-1">
                <h4 className="text-caption font-semibold text-on-surface-variant">
                  待授权（{pendingApprovals.length}）
                </h4>
                <ul className="space-y-1">
                  {pendingApprovals.map((ap) => (
                    <li key={ap.id}>
                      <button
                        type="button"
                        className="w-full text-left text-caption px-2 py-1 rounded-cw-sm bg-surface-container hover:bg-surface-container-high"
                        onClick={() => setApproval(ap)}
                      >
                        <ExecLevelBadge level={ap.riskLevel} /> {ap.command.slice(0, 48)}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ExecLogList records={execRecords} />
            <ExecPermissionDialog
              approval={approval}
              busy={execBusy}
              onApprove={(confirm) => void decideApproval(true, confirm)}
              onReject={() => void decideApproval(false)}
            />
          </div>
        )}

        {activeTab === 'dispatch' && (
          <div className="space-y-2">
            <p className="text-caption text-on-surface-variant">
              手动指定要重做的环节。调度器不会替你判断「该不该重做」，这里只登记你的判断并留痕。
            </p>
            <DispatchForm
              onSubmit={(order) => void submitDispatch(order)}
              busy={dispatchBusy}
              result={dispatchResult}
            />
          </div>
        )}

        {activeTab === 'review' && (
          <WorkerReviewQueue
            items={pendingReviews}
            onReview={(wid, approve, confirm) => void reviewWorker(wid, approve, confirm)}
          />
        )}
      </div>
    </aside>
  );
}
