/**
 * 副驾驶标签栏（PRD §19.2 / 需求 8；2026-10-31 用户定稿）
 *
 * - 固定标签只有两个且都不可关：**需求对话**、**轨迹**（紧挨其右）；
 * - 「执行日志」标签已撤删——日志内容并入轨迹的「日志」视图，功能没丢、标签少一个；
 * - 其余标签支持关闭；中键也可关；
 * - `+` 菜单用于新增（工作区 / 文档）；轨迹是固定标签，不再出现在菜单里。
 */
import React from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCopilotStore, type CopilotTab } from '@/stores/copilotStore';

const NEW_TAB_MENU: Array<{ kind: CopilotTab['kind']; title: string; id: string }> = [
  { kind: 'workspace', title: '工作区', id: 'workspace' },
  { kind: 'docs', title: '文档', id: 'docs:list' },
];

export function CopilotTabBar() {
  const tabs = useCopilotStore((s) => s.tabs);
  const activeId = useCopilotStore((s) => s.activeId);
  const setActive = useCopilotStore((s) => s.setActive);
  const closeTab = useCopilotStore((s) => s.closeTab);
  const openTab = useCopilotStore((s) => s.openTab);
  const [menuOpen, setMenuOpen] = React.useState(false);

  const addTab = (item: (typeof NEW_TAB_MENU)[number]) => {
    openTab({ id: item.id, kind: item.kind, title: item.title, closable: true });
    setMenuOpen(false);
  };

  return (
    <div className="flex items-center gap-1 border-b border-outline-variant/30 px-1 py-1">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            data-tab-id={tab.id}
            data-closable={tab.closable ? 'true' : 'false'}
            className={cn(
              'group flex shrink-0 items-center gap-1 rounded-cw-sm px-2 py-1 text-caption cursor-pointer',
              tab.id === activeId
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container',
            )}
            onClick={() => setActive(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(tab.id);
            }}
          >
            <span className="max-w-[140px] truncate">{tab.title}</span>
            {tab.closable && (
              <button
                type="button"
                aria-label={`关闭 ${tab.title}`}
                data-close-for={tab.id}
                className="rounded p-0.5 opacity-60 hover:opacity-100 hover:bg-surface-container-highest"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label="新增标签"
          className="rounded p-1 text-on-surface-variant hover:bg-surface-container"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-cw-sm border border-outline-variant/40 bg-surface-container p-1 shadow-lg">
            {NEW_TAB_MENU.map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-caption hover:bg-surface-container-high"
                onClick={() => addTab(item)}
              >
                {item.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
