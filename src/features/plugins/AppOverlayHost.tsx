/**
 * `app.overlay` 宿主 —— 插件声明的全局浮层，由这里统一渲染。
 *
 * 为什么不写在 App.tsx 里：浮层的内容（缺什么、为什么缺、怎么装）属于**插件**
 * 的知识，不是宿主的。宿主只提供 slot + 一个声明式渲染器：
 * 插件在 `ui_slot` 贡献里给出 `payload.kind = installable-dependency`
 * （probe 端点 / install 端点 / 文案），这里就能画出「缺失提示 + 一键安装」，
 * 且同一套代码对 ffmpeg、模型权重、任何可选二进制一视同仁。
 *
 * 关闭策略：`稍后再说` 只写 sessionStorage（本次会话不再自动弹），
 * 导出页等页面内的内联入口仍然保留，用户随时能装。
 */
import { useEffect, useId, useRef } from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useModalKeybindingGuard } from '@/features/keyboard/useModalKeybindingGuard';

import { usePluginSlots } from './usePluginSlots';
import {
  readInstallableDependency,
  useInstallableDependency,
  type DependencyGate,
} from './useInstallableDependency';
import { usableContributions, type SlotContribution } from './slots';

interface DialogProps {
  gate: DependencyGate;
  contributionId: string;
  className?: string;
}

/** 单个「可安装依赖」浮层（纯展示，状态在 hook 里） */
export function InstallableDependencyDialog({ gate, contributionId, className }: DialogProps) {
  const { payload, state, visible, showSuccess, snooze, install, dismissSuccess } = gate;
  const copy = payload.copy ?? {};
  const titleId = useId();
  const descId = useId();
  const primaryBtn = useRef<HTMLButtonElement>(null);

  const open = visible || showSuccess;
  // P2-19：插件覆盖层打开时停用单键快捷键
  useModalKeybindingGuard(open);

  useEffect(() => {
    if (!open) return;
    primaryBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showSuccess) dismissSuccess();
      else snooze();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, showSuccess, dismissSuccess, snooze]);

  if (!open) return null;

  const dialogClass = cn(
    'fixed inset-0 z-[60] flex items-center justify-center bg-black/50',
    className,
  );

  if (showSuccess) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-contribution={contributionId}
        className={dialogClass}
      >
        <div className="w-[560px] max-w-[92vw] rounded-cw-md border border-outline-variant/40 bg-surface-container p-4 space-y-3">
          <h2 id={titleId} className="text-body-sm font-semibold text-on-surface">
            {copy.successTitle ?? '依赖已安装'}
          </h2>
          <p className="text-caption text-on-surface-variant">
            {copy.successBody ?? '新任务会立即使用它，已经在跑的任务不受影响。'}
            {state.version ? ` 版本：${state.version}。` : ''}
          </p>
          <footer className="flex justify-end">
            <Button size="sm" onClick={dismissSuccess} autoFocus>
              知道了
            </Button>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-contribution={contributionId}
      className={dialogClass}
    >
      <div className="w-[600px] max-w-[92vw] rounded-cw-md border border-outline-variant/40 bg-surface-container p-4 space-y-3">
        <h2 id={titleId} className="text-body-sm font-semibold text-on-surface">
          {copy.title ?? `还缺一个必需依赖（${contributionId}）`}
        </h2>

        <div id={descId} className="space-y-2 text-caption text-on-surface-variant">
          {copy.why && <p>{copy.why}</p>}
          {copy.benefit && <p>{copy.benefit}</p>}
        </div>

        {state.installing && (
          <p className="text-caption text-primary">
            正在下载并安装…已等待 {state.waitedSec}s（期间可以继续做别的事）
          </p>
        )}

        {!state.installing && state.failed && (
          <p className="text-caption text-error">
            上次安装没成功：{state.message || '原因未知'}。可以重试，或查看后端日志。
          </p>
        )}

        {!state.installing && state.cancelled && (
          <p className="text-caption text-on-surface-variant">
            已取消安装。需要时可以随时再点「立即安装」。
          </p>
        )}

        {!state.installing && !state.failed && state.message && (
          <p className="text-caption text-on-surface-variant">后端状态：{state.message}</p>
        )}

        <footer className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={snooze}>
            {state.installing ? '先关掉（后台继续装）' : (copy.laterLabel ?? '稍后再说')}
          </Button>
          <Button size="sm" ref={primaryBtn} onClick={() => void install()} disabled={state.installing}>
            {state.installing
              ? (copy.installingLabel ?? '安装中…')
              : state.failed
                ? (copy.retryLabel ?? '重试安装')
                : (copy.installLabel ?? '立即安装')}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function DependencyOverlayInner({
  contribution,
  payload,
}: {
  contribution: SlotContribution;
  payload: NonNullable<ReturnType<typeof readInstallableDependency>>;
}) {
  const gate = useInstallableDependency(contribution, payload);
  return <InstallableDependencyDialog gate={gate} contributionId={contribution.id} />;
}

function DependencyOverlay({ contribution }: { contribution: SlotContribution }) {
  const payload = readInstallableDependency(contribution);
  // 非「可安装依赖」类贡献不归这里渲染（未来可扩展别的 payload.kind）
  if (!payload) return null;
  return <DependencyOverlayInner contribution={contribution} payload={payload} />;
}

/** 全局挂载点：App 里挂一次，插件贡献什么就渲染什么 */
export function AppOverlayHost() {
  const raw = usePluginSlots('app.overlay');
  // C4：与其他入口同一可见性集合——installable 贡献必须带合法 payload 才渲染。
  const items = usableContributions(raw, {}, (c) =>
    Boolean(readInstallableDependency(c)),
  );
  return (
    <>
      {items.map((c) => (
        <DependencyOverlay key={`${c.id}`} contribution={c} />
      ))}
    </>
  );
}
