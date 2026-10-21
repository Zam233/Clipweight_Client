/**
 * 子代理树（F6）。树形展示秘书 → 子代理，可取消。
 *
 * 取消语义：一次点击 + 二次确认（成本不退），取消后节点保留为 cancelled。
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';

import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { SubagentNode } from '@/types/supervisor';

const STATUS_CN: Record<string, string> = {
  pending: '待审核',
  running: '运行中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  pending: 'info',
  running: 'info',
  done: 'success',
  failed: 'error',
  cancelled: 'warning',
};

interface Props {
  nodes: SubagentNode[];
  onCancel?: (node: SubagentNode) => void;
  className?: string;
}

export function SubagentTree({ nodes, onCancel, className }: Props) {
  if (nodes.length === 0) {
    return (
      <p className={cn('text-caption text-on-surface-variant py-4', className)}>
        本次运行没有派生子代理。
      </p>
    );
  }
  return (
    <ul className={cn('space-y-1.5', className)} aria-label="子代理树">
      {nodes.map((node) => (
        <SubagentRow key={node.id} node={node} depth={0} onCancel={onCancel} />
      ))}
    </ul>
  );
}

function SubagentRow({
  node,
  depth,
  onCancel,
}: {
  node: SubagentNode;
  depth: number;
  onCancel?: (node: SubagentNode) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const cancellable = node.cancellable && !['done', 'failed', 'cancelled'].includes(node.status);

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-cw-sm border border-outline-variant/30 bg-surface-container/40 px-2.5 py-1.5"
        style={{ marginLeft: depth * 14 }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={hasChildren ? '展开子代理' : '子代理详情'}
          className="text-on-surface-variant"
          disabled={!hasChildren}
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <span className="text-body-sm text-on-surface">{node.role}</span>
        <Badge variant={STATUS_VARIANT[node.status] ?? 'default'}>
          {STATUS_CN[node.status] ?? node.status}
        </Badge>
        {node.model?.model && (
          <span className="text-caption text-on-surface-variant truncate max-w-[140px]">
            {node.model.model}
          </span>
        )}
        <span className="ml-auto text-caption text-on-surface-variant">
          {node.duration_ms ? `${(node.duration_ms / 1000).toFixed(1)}s` : ''}
        </span>
        {cancellable && onCancel && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (window.confirm('取消后该子代理已产生的成本不退还，确认取消？')) onCancel(node);
            }}
            aria-label={`取消 ${node.role}`}
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>
      {open && node.last_output && (
        <p
          className="text-caption text-on-surface-variant mt-1"
          style={{ marginLeft: depth * 14 + 22 }}
        >
          {node.last_output}
        </p>
      )}
      {open && hasChildren && (
        <ul className="mt-1.5 space-y-1.5">
          {children.map((child) => (
            <SubagentRow key={child.id} node={child} depth={depth + 1} onCancel={onCancel} />
          ))}
        </ul>
      )}
    </li>
  );
}
