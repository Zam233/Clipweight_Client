/**
 * D-3j：插件贡献的快捷键（slot `shortcut`）。
 *
 * payload 契约：`{ combo, label, action: { endpoint, method?, body? } }`——
 * 快捷键只触发一次受控 API 调用（不做任意 JS，D-4 才开 bundle 档）。
 * 生命周期：挂载注册、卸载/贡献变化即注销（G7：插件禁用后快捷键同步消失）。
 */
import { useEffect } from 'react';
import { keybindingEngine } from '@/features/keyboard/KeybindingEngine';
import { getApiClient } from '@/services/api';
import { toast } from '@/stores/toastStore';
import { usePluginContributions } from './usePluginSlots';

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
  const items = usePluginContributions('shortcut');

  useEffect(() => {
    const disposers: Array<() => void> = [];
    for (const c of items) {
      const p = (c.payload ?? {}) as ShortcutPayload;
      const endpoint = p.action?.endpoint;
      if (!p.combo || !endpoint) continue;
      const method = String(p.action?.method ?? 'POST').toUpperCase();
      const body = p.action?.body ?? {};
      disposers.push(keybindingEngine.register({
        id: `plugin:${c.id}`,
        combo: p.combo,
        label: p.label ?? c.title,
        category: '插件',
        handler: () => {
          const client = getApiClient();
          const req = method === 'GET'
            ? client.get(endpoint)
            : client.request({ url: endpoint, method, data: body });
          req.catch(() => toast(`插件快捷键执行失败：${c.title}`, 'error'));
        },
      }));
    }
    // 卸载或贡献变化时注销全部（防插件禁用后快捷键残留）
    return () => disposers.forEach((d) => d());
  }, [items]);
}
