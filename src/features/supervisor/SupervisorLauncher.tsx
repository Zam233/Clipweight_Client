/**
 * 调度面板入口（F1 集成）。
 *
 * 刻意做成「浮动入口 + 抽屉」而不是嵌进 AgentPanel：
 * AgentPanel 已 1400+ 行，再塞调度逻辑会让它彻底失控；这里只做三件事：
 * 1. 把 agentStore 的 pipelineId 同步进 supervisorStore；
 * 2. 打开抽屉时触发一次 hydrate（首屏全量拉），并订阅 trace 流补增量；
 * 3. 渲染抽屉。
 */

import { useEffect } from 'react';
import { Gauge } from 'lucide-react';

import { Button } from '@/components/ui';
import { useAgentStore } from '@/stores/agentStore';
import { useSupervisorStore } from '@/stores/supervisorStore';

import { SupervisorDrawer } from './SupervisorDrawer';
import { useSupervisorEvents } from './useSupervisorEvents';

interface Props {
  onAcceptSuggestion?: Parameters<typeof SupervisorDrawer>[0]['onAcceptSuggestion'];
  actionPending?: string;
}

export function SupervisorLauncher({ onAcceptSuggestion, actionPending }: Props) {
  const pipelineId = useAgentStore((s) => s.pipelineId);
  const currentId = useSupervisorStore((s) => s.pipelineId);
  const setPipeline = useSupervisorStore((s) => s.setPipeline);
  const hydrate = useSupervisorStore((s) => s.hydrate);
  const drawerOpen = useSupervisorStore((s) => s.drawerOpen);
  const setDrawerOpen = useSupervisorStore((s) => s.setDrawerOpen);
  const setActiveTab = useSupervisorStore((s) => s.setActiveTab);
  const pendingApprovals = useSupervisorStore((s) => s.pendingApprovals);
  const pendingReviews = useSupervisorStore((s) => s.pendingReviews);
  const hydrateReviews = useSupervisorStore((s) => s.hydrateReviews);

  useEffect(() => {
    if (pipelineId !== currentId) setPipeline(pipelineId);
  }, [pipelineId, currentId, setPipeline]);

  // 抽屉关着就不订阅：管线跑动期间事件会漏，但打开时的 hydrate 是全量的，
  // 不会出现「缺一段」的错位（省一条 EventSource，也避免与 AgentPanel 抢流）。
  useSupervisorEvents(pipelineId, drawerOpen);

  // 待审 worker 是**跨管线**的全局队列：不轮询就会出现「后端在等审核、
  // 用户不知道去哪里批」。60s 一次，失败静默（后端不可用时不刷错误条）。
  useEffect(() => {
    void hydrateReviews();
    const timer = setInterval(() => void hydrateReviews(), 60_000);
    return () => clearInterval(timer);
  }, [hydrateReviews]);

  const pendingTotal = pendingApprovals.length + pendingReviews.length;

  const open = (tab?: 'exec' | 'review') => {
    setDrawerOpen(true);
    if (tab) setActiveTab(tab);
    if (pipelineId) void hydrate(pipelineId);
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => open(pendingApprovals.length ? 'exec' : undefined)}
        className="fixed bottom-14 right-4 z-30 shadow-lg relative"
        aria-label="打开调度面板"
        disabled={!pipelineId}
        title={
          pendingTotal > 0
            ? `有 ${pendingTotal} 项等你处理（待授权命令 / 待审子代理）`
            : pipelineId
              ? '查看自动诊断与调度记录'
              : '开始一次生成后可用'
        }
      >
        <Gauge className="w-3.5 h-3.5 mr-1" />
        调度
        {pendingTotal > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-error text-on-error text-[10px] leading-4 text-center"
            aria-label={`待处理 ${pendingTotal} 项`}
          >
            {pendingTotal}
          </span>
        )}
      </Button>

      {drawerOpen && (
        <div className="fixed inset-y-0 right-0 z-40 shadow-2xl">
          <SupervisorDrawer
            onClose={() => setDrawerOpen(false)}
            onAcceptSuggestion={onAcceptSuggestion}
            actionPending={actionPending}
          />
        </div>
      )}
    </>
  );
}
