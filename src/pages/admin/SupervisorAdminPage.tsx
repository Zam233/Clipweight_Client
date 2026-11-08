/**
 * 调度中枢管理页（F5，管理员）。
 *
 * 两件事：切模式（off/shadow/on）、配模型路由表。
 * 都是「热生效 + 尽力持久化」——保存后返回 how=persisted / memory_only。
 */

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui';
import { supervisorApi } from '@/services/api';
import type { RoutesResponse } from '@/types/supervisor';
import { RouteTableEditor } from '@/features/supervisor/RouteTableEditor';
import { SupervisorModeSwitch, type SupervisorMode } from '@/features/supervisor/SupervisorModeSwitch';
import { ConsoleHeading, ConsoleShell } from './ConsoleShell';

export function SupervisorAdminPage() {
  const [mode, setMode] = useState<SupervisorMode>('off');
  const [routes, setRoutes] = useState<RoutesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [m, r] = await Promise.all([supervisorApi.getMode(), supervisorApi.getRoutes()]);
      setMode(m.mode);
      setRoutes(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <ConsoleShell>
      <ConsoleHeading
        kicker="SUPERVISOR"
        title="调度中枢"
        desc="模式开关 · 模型路由表 · 跨 provider 白名单（改动即时生效）"
      />

      <div className="mb-3">
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />
          刷新
        </Button>
      </div>

      {error && <p className="text-caption text-error mb-3">加载失败：{error}</p>}

      {loading ? (
        <p className="text-caption text-on-surface-variant">
          <Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" />
          加载中…
        </p>
      ) : (
        <div className="space-y-6 max-w-[720px]">
          <section className="space-y-2">
            <SupervisorModeSwitch
              mode={mode}
              busy={busy}
              onChange={async (next) => {
                setBusy(true);
                setError('');
                try {
                  const res = await supervisorApi.setMode(next);
                  setMode(next);
                  setSaved(res.how === 'persisted');
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </section>

          <section>
            <h3 className="text-body-sm font-semibold text-on-surface mb-2">模型路由表</h3>
            <RouteTableEditor
              initial={routes}
              busy={busy}
              saved={saved}
              onSave={async (payload) => {
                setBusy(true);
                setError('');
                try {
                  const res = await supervisorApi.updateRoutes(payload);
                  setSaved(res.how === 'persisted');
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}
