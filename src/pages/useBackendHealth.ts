import { useEffect, useState } from 'react';
import { healthApi } from '@/services/api';
import { useSettingsStore } from '@/stores/settingsStore';

export type BackendStatus = 'checking' | 'online' | 'offline';

/**
 * 探测后端连接状态：挂载时检查一次；当 settings 的 apiBaseUrl 变化时
 *（例如在设置页修改后端地址）重新探测，让状态立即反映新地址的连接情况。
 * 单一 effect 同时覆盖首次挂载与后续变更，避免重复探测。
 */
export function useBackendHealth(): BackendStatus {
  const [backend, setBackend] = useState<BackendStatus>('checking');
  const apiBaseUrl = useSettingsStore((s) => s.apiBaseUrl);

  useEffect(() => {
    let alive = true;
    healthApi.check()
      .then(() => alive && setBackend('online'))
      .catch(() => alive && setBackend('offline'));
    return () => { alive = false; };
  }, [apiBaseUrl]);

  return backend;
}
