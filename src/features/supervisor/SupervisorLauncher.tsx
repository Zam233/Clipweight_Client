/**
 * 调度面板入口（F1 集成）。
 *
 * 刻意做成「浮动入口 + 抽屉」而不是嵌进 AgentPanel：
 * AgentPanel 已 1400+ 行，再塞调度逻辑会让它彻底失控；这里只做三件事：
 * 1. 把 agentStore 的 pipelineId 同步进 supervisorStore；
 * 2. 打开抽屉时触发一次 hydrate（首屏全量拉，SSE 之后增量补）；
 * 3. 渲染抽屉。
 */

import { useEffect } from 'react';
import { Gauge } from 'lucide-react';

import { Button } from '@/components/ui';
import { useAgentStore } from '@/stores/agentStore';
import { useSupervisorStore } from '@/stores/supervisorStore';

import { SupervisorDrawer } from './SupervisorDrawer';

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

  useEffect(() => {
    if (pipelineId !== currentId) setPipeline(pipelineId);
  }, [pipelineId, currentId, setPipeline]);

  const open = () => {
    setDrawerOpen(true);
    if (pipelineId) void hydrate(pipelineId);
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={open}
        className="fixed bottom-14 right-4 z-30 shadow-lg"
        aria-label="打开调度面板"
        disabled={!pipelineId}
        title={pipelineId ? '查看自动诊断与调度记录' : '开始一次生成后可用'}
      >
        <Gauge className="w-3.5 h-3.5 mr-1" />
        调度
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
