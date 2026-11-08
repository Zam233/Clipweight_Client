/**
 * 请求执行（F11 的入口侧）。
 *
 * 分工写死在这里，别指望用户记：
 * - 低风险 → 直接跑，结果落在下方执行日志；
 * - 中/高风险 → 后端不跑，返回「等授权」，由授权弹窗决定；
 * - 命中硬底线（读凭据 / 不可逆破坏）→ 后端直接拒，**前端不提供任何授权按钮**。
 *
 * 所以本组件只负责「把命令交上去」，不判断危不危险——判断在后端（规则 + 独立 LLM）。
 */

import { useState } from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ExecRequest, ExecResponse } from '@/types/supervisor';

type Kind = 'shell' | 'python';

interface Props {
  onSubmit?: (body: ExecRequest) => void | Promise<void>;
  busy?: boolean;
  result?: ExecResponse | null;
  className?: string;
}

const OUTCOME_CN: Record<ExecResponse['status'], string> = {
  done: '已执行',
  failed: '已执行但失败（非 0 退出）',
  pending_approval: '等待你授权后才会执行',
  rejected: '已被拒绝（安全底线，不可授权）',
};

export function ExecRequestForm({ onSubmit, busy, result, className }: Props) {
  const [kind, setKind] = useState<Kind>('shell');
  const [command, setCommand] = useState('');
  const [code, setCode] = useState('');

  const body = kind === 'shell' ? command.trim() : code.trim();
  const disabled = busy || !body;

  return (
    <form
      className={cn('space-y-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        void onSubmit?.(
          kind === 'shell' ? { kind, command: body } : { kind, code: body },
        );
      }}
    >
      <label className="block text-caption text-on-surface-variant">
        执行类型
        <select
          className="mt-1 w-full bg-surface-container rounded-cw-sm px-2 py-1 text-body-sm text-on-surface"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
        >
          <option value="shell">命令行（bash / pwsh）</option>
          <option value="python">Python 脚本</option>
        </select>
      </label>

      <label className="block text-caption text-on-surface-variant">
        {kind === 'shell' ? '命令' : '脚本正文'}
        <textarea
          className="mt-1 w-full bg-surface-container rounded-cw-sm px-2 py-1 text-body-sm text-on-surface font-mono"
          rows={3}
          value={kind === 'shell' ? command : code}
          placeholder={kind === 'shell' ? '例如：python -m pytest tests -q' : "print('hello')"}
          onChange={(e) => (kind === 'shell' ? setCommand(e.target.value) : setCode(e.target.value))}
        />
      </label>

      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={disabled}>
          提交执行
        </Button>
        <span className="text-caption text-on-surface-variant">
          {result
            ? `${OUTCOME_CN[result.status] ?? result.status}${
                result.status === 'rejected' && result.reason ? `：${result.reason}` : ''
              }`
            : '中高风险会先问你，不会静默执行'}
        </span>
      </div>
    </form>
  );
}
