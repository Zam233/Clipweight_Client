import { useEffect, useRef } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useAgentStore } from '@/stores/agentStore';
import { requirementsApi } from '@/services/api';
import { uid } from '@/lib/utils';
import { demoBrief } from './AgentPanel';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveMessageAttachments } from './requirementsAttachments';
import type { CreativeBrief, ProductionPlan } from '@/types/persona';

/**
 * useRequirementsAutoStart — 从 HomePage「开始创作」进入编辑器后自动启动需求 Agent。
 *
 * 挂在 EditorPage 顶层（始终挂载），不依赖 Agent 面板是否展开。
 * 必须等到项目加载完成（ready=true，EditorPage 已恢复 requirements 数据）再消费，
 * 否则会抢在 EditorPage 恢复数据之前清空 topic，导致文案/时长等信息丢失。
 * 当 projectStore.requirementsTopic 有值且尚无对话消息时，自动初始化需求会话、
 * 发送选题并请求生成创意简报 / 规划书。全程仅使用全局 store action。
 */
export function useRequirementsAutoStart(ready: boolean) {
  // 仍订阅 topic 供 render 期语义使用，但**不进依赖数组**（见文末说明）。
  const requirementsTopic = useProjectStore((s) => s.requirementsTopic);
  // E-01（PRD §5A P1）：旧实现把 requirementsTopic 放进依赖数组，但 effect 内部
  // 又同步 `setRequirementsTopic('')` 消费它 → 依赖变化触发 cleanup → `cancelled=true`
  // → 异步主流程每次 await 后都提前 return，且 finally 在 cancelled 时不清 busy
  // → 用户只看到自己的首条消息和永远转圈。
  //
  // 修法：**依赖只留 ready**，topic 在 effect 执行时从 store 读取一次；取消判定改为
  // 「项目 id 是否变化」——项目切换时旧请求才作废，消费 topic 不再自杀。
  const projectId = useProjectStore((s) => s.projectId);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!ready) return; // 等待项目加载并恢复 requirements 数据后再启动
    if (autoStartedRef.current) return;
    const topicNow = useProjectStore.getState().requirementsTopic;
    if (!topicNow) return;
    if (useAgentStore.getState().requirementsMessages.length > 0) return;
    autoStartedRef.current = true;

    const st = useProjectStore.getState();
    const t = topicNow;
    // 记录启动时归属的项目：只有项目被换掉才算"过期"，本 effect 的 cleanup 不取消自己。
    const forProjectId = st.projectId;
    st.setRequirementsTopic(''); // consume so it won't re-trigger

    const ag = useAgentStore.getState();
    ag.setRequirementsBusy(true);
    ag.setRequirementsStatus('gathering');
    // B15: 仅保留一条 user 消息（合并选题/文稿/时长），避免双气泡冗余
    let firstMsg = `我的选题是：${t}。`;
    if (st.requirementsScript) firstMsg += `文稿：${st.requirementsScript}。`;
    firstMsg += `预估时长：${st.requirementsAudioDuration}秒。请帮我生成创意简报。`;
    ag.addRequirementsMessage({ id: uid('m'), role: 'user', content: firstMsg, timestamp: new Date().toISOString() });

    // 过期判定：项目被换掉 / 组件卸载（unmounted 标志）。消费 topic 本身不再触发取消。
    let unmounted = false;
    const stale = () => unmounted || useProjectStore.getState().projectId !== forProjectId;
    (async () => {
      try {
        const res = await requirementsApi.init({
          topic: t,
          persona_id: st.personaId || undefined,
          category_plugin_id: st.pluginId || undefined,
          script_text: st.requirementsScript || undefined,
          audio_duration_sec: st.requirementsAudioDuration || undefined,
          extra: {
            material_source_ids: st.materialSourceIds || [],
            audio_path: st.audioPath || undefined,
            video_mode: st.videoMode || undefined,
            split_mode: st.splitMode || undefined,
            auto_dub: st.autoDub,
            voice_id: st.voiceId || undefined,
            // B21: 配音段传入需求会话，StructureAgent 场景时间与之对齐
            dub_segments: st.dubSegments ?? undefined,
            // 工作区（PRD workspace-prd-2026-10-24）：名称/开关随会话走，
            // 后端 proceed 双轨据此建 Task 并确保工作区存在
            workspace_name: st.projectName || undefined,
            workspace_auto_index: st.workspaceAutoIndex,
            workspace_vision: st.workspaceVisionIndex,
          },
        });
        // 初始化期间切了项目/卸载：旧会话不能写进新项目的全局 store。
        if (stale()) return;
        useAgentStore.getState().setRequirementsSession(res.session_id);
        try {
          // unified-stream PRD §M1：首轮必须走**流式**，否则思考与逐字输出在自动开始的
          // 那一段完全不存在（旧实现用非流式 chat，前端只能看到"整段蹦出来"）。
          // 失败时回退非流式，行为与旧实现一致。
          let chatRes: Record<string, unknown> = {};
          let streamedId: string | null = null;
          try {
            chatRes = await requirementsApi.streamChat(res.session_id, firstMsg, (chunk) => {
              const ag2 = useAgentStore.getState();
              if (chunk.type === 'delta' && typeof chunk.data === 'string') {
                if (!streamedId) {
                  streamedId = uid('m');
                  ag2.addRequirementsMessage({
                    id: streamedId, role: 'assistant', content: chunk.data as string,
                    timestamp: new Date().toISOString(), streaming: true,
                  });
                } else {
                  ag2.appendRequirementsDelta(streamedId, chunk.data as string);
                }
              }
              // 思考不再需要前端转存：服务端已把它作为时间线条目按 seq 落好，
              // AgentPanel 挂载时直接读 GET /timeline（位置 = 发生时刻，不靠推断）。
            });
          } catch {
            chatRes = await requirementsApi.chat({ session_id: res.session_id, message: firstMsg });
          }
          if (stale()) return;
          const brief = (chatRes.creative_brief ?? null) as CreativeBrief | null;
          const plan = (chatRes.production_plan ?? null) as ProductionPlan | null;
          const ag2 = useAgentStore.getState();
          if (brief) { ag2.setCreativeBrief(brief); ag2.setRequirementsStatus('brief_ready'); }
          if (plan) { ag2.setProductionPlan(plan); ag2.setRequirementsStatus('plan_ready'); }
          const att = resolveMessageAttachments(chatRes.status as string, brief, plan);
          const finalText = String(chatRes.reply ?? chatRes.message ?? '已收到。');
          if (streamedId) {
            // 收尾：用权威 reply 替换打字气泡，不再新增一条
            useAgentStore.getState().updateRequirementsMessage(streamedId, {
              content: finalText, streaming: false,
              creative_brief: att.creative_brief, production_plan: att.production_plan,
            });
          } else {
            ag2.addRequirementsMessage({
              id: uid('m'), role: 'assistant', content: finalText,
              timestamp: new Date().toISOString(), creative_brief: att.creative_brief, production_plan: att.production_plan,
            });
          }
        } catch {
          if (stale()) return;
          if (!useSettingsStore.getState().allowDemoFallback) {
            useAgentStore.getState().addRequirementsMessage({ id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(), content: '后端暂不可达，无法生成简报（可在设置中开启离线演示回退）' });
            useAgentStore.getState().setRequirementsStatus('idle');
            return;
          }
          const brief = demoBrief(t);
          const ag2 = useAgentStore.getState();
          ag2.setCreativeBrief(brief);
          ag2.setRequirementsStatus('brief_ready');
          ag2.addRequirementsMessage({ id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(), content: '已为你生成创意简报，请审阅后确认。', creative_brief: brief });
        }
      } catch {
        if (stale()) return;
        if (!useSettingsStore.getState().allowDemoFallback) {
          const ag2 = useAgentStore.getState();
          ag2.addRequirementsMessage({ id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(), content: '后端暂不可达，无法生成简报（可在设置中开启离线演示回退）' });
          ag2.setRequirementsStatus('idle');
          return;
        }
        const brief = demoBrief(t);
        const ag2 = useAgentStore.getState();
        ag2.setCreativeBrief(brief);
        ag2.setRequirementsStatus('brief_ready');
        ag2.addRequirementsMessage({ id: uid('m'), role: 'assistant', timestamp: new Date().toISOString(), content: '已为你生成创意简报，请审阅后确认。', creative_brief: brief });
      } finally {
        if (!stale()) useAgentStore.getState().setRequirementsBusy(false);
      }
    })();
    return () => { unmounted = true; };
    // 依赖只留 ready 与 projectId：topic 在 effect 内从 store 读取。
    // 把 requirementsTopic 放进依赖会让「消费 topic」本身重新触发本例程并自取消（E-01 根因）。
    // projectId 变化时允许重新尝试（切项目应能启动新项目的需求会话）。
  }, [ready, projectId]);
}
