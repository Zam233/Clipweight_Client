import { useEffect, useRef } from 'react';

export interface TimelineContextMenuItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * TimelineContextMenu — 时间线右键菜单（轮 89：批次 10）。
 *
 * 轻量自绘（与项目"不用重 UI 库"的现状一致）：定位到视口坐标，
 * 点击菜单外 / Escape / 滚动时关闭；超出视口边缘自动内收。
 */
export function TimelineContextMenu({ x, y, items, onClose }: {
  x: number;
  y: number;
  items: TimelineContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // 视口边缘内收（估高：每项 ~30px + padding，最多 6 项可见）
  const estH = Math.min(items.length, 6) * 30 + 8;
  const estW = 200;
  const left = Math.max(4, Math.min(x, window.innerWidth - estW - 8));
  const top = Math.max(4, Math.min(y, window.innerHeight - estH - 8));

  return (
    <div
      ref={ref}
      style={{ left, top }}
      className="fixed z-50 min-w-[190px] bg-surface-container-high border border-outline-variant/40
        rounded-cw-sm shadow-xl py-1 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          disabled={it.disabled}
          onClick={() => {
            it.onSelect();
            onClose();
          }}
          className={`w-full flex items-center justify-between gap-4 px-3 py-1.5 text-label-sm text-left
            transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default
            ${it.danger ? 'text-error hover:bg-error/10' : 'text-on-surface hover:bg-surface-container'}`}
        >
          <span>{it.label}</span>
          {it.shortcut && (
            <span className="font-mono text-caption text-on-surface-variant">{it.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
}
