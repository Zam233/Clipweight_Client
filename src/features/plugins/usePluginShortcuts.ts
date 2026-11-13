/**
 * D-3j：插件贡献的快捷键（slot `shortcut`）。
 *
 * payload 契约：`{ combo, label, action: { endpoint, method?, body? } }`——
 * 快捷键只触发一次受控 API 调用（不做任意 JS，D-4 才开 bundle 档）。
 * 生命周期：挂载注册、卸载/贡献变化即注销（G7：插件禁用后快捷键同步消失）。
 */
import { useEffect } from 'react';
import { keybindingEngine } from '@/features/keyboard/KeybindingEngine';
import { toast } from '@/stores/toastStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { evalVisibleWhen } from './slots';
import { usePluginSlots } from './usePluginSlots';
import { authorizePluginCall } from './pluginApiGuard';
import { executePluginAction } from './executePluginAction';

interface ShortcutPayload {
  combo?: string;
  label?: string;
  action?: {
    endpoint?: string;
    method?: string;
    body?: Record<string, unknown>;
  };
}

export function usePluginShortcuts(): void {
  // shortcut 是 ui_slot 的 slot 名（D-0 名单），非独立贡献类型
  const items = usePluginSlots('shortcut');
  // B11：shortcut 也要消费 visibleWhen —— 上下文与其它 slot 同源（只读宿主状态）
  const playing = usePreviewStore((s) => s.isPlaying);
  const hasSelection = useSelectionStore((s) => s.selectedClipIds.length > 0);
  const hasTimeline = useTimelineStore((s) => (s.timeline?.tracks?.length ?? 0) > 0);

  useEffect(() => {
    const disposers: Array<() => void> = [];
    for (const c of items) {
      const p = (c.payload ?? {}) as ShortcutPayload;
      const endpoint = p.action?.endpoint;
      if (!p.combo || !endpoint) continue;
      // 受限表达式求值（无 eval）；解析失败即视为不可见
      if (!evalVisibleWhen(c.visibleWhen, { playing, hasSelection, hasTimeline })) continue;
      const method = String(p.action?.method ?? 'POST').toUpperCase();
      const body = p.action?.body ?? {};
      // PL-02：快捷键贡献里的 endpoint/method/body 也是插件提供的数据，
      // 与 iframe call 共用同一门禁（默认拒绝未登记端点与破坏性方法）。
      const decision = authorizePluginCall({
        endpoint, method, body: body as Record<string, unknown>,
      });
      if (!decision.ok) continue;
      // C4：owner 用 c.owner（真实归属），并带 contribution_id 供后端核对 (ui_slot,id)。
      // 统一执行器负责门禁、受限代理、写操作逐次确认与可读回执。
      disposers.push(keybindingEngine.register({
        id: `plugin:${c.id}`,
        combo: p.combo,
        label: p.label ?? c.title,
        category: '插件',
        handler: () => {
          void executePluginAction(c.owner ?? '', {
            endpoint: decision.call.endpoint,
            method: decision.call.method,
            body: decision.call.body,
          }, { contributionId: c.id, label: c.title }).then((result) => {
            if (!result.ok && result.reason !== 'cancelled') {
              toast(`插件快捷键执行失败：${c.title} — ${result.message ?? ''}`, 'error');
            }
          });
        },
      }));
    }
    // 卸载或贡献变化时注销全部（防插件禁用后快捷键残留）
    return () => disposers.forEach((d) => d());
  }, [items, playing, hasSelection, hasTimeline]);
}
