/**
 * 任务控制条（路线 C / C4 / Q6）。
 *
 * Q6 已裁定：**逐 Step 确认只用于 dangerous 档**，所以这里的插话框默认收起，
 * 不打断用户。暂停/继续/取消始终可见（长任务里"停一下"是最常见需求）。
 */

import { useState } from 'react';
import { MessageSquarePlus, Pause, Play, X } from 'lucide-react';

import { Button } from '@/components/ui';
import type { TaskStatus } from '@/types/task';

interface Props {
  status: TaskStatus;
  busy?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onInject?: (text: string) => void;
}

export function TaskToolbar({ status, busy, onPause, onResume, onCancel, onInject }: Props) {
  const [text, setText] = useState('');
  const running = status === 'running' || status === 'planning';
  const terminal = status === 'done' || status === 'failed' || status === 'cancelled';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {running && (
          <Button size="sm" variant="outline" onClick={onPause} disabled={busy}>
            <Pause className="w-3.5 h-3.5 mr-1" /> 暂停
          </Button>
        )}
        {(status === 'paused' || status === 'pending') && (
          <Button size="sm" onClick={onResume} disabled={busy}>
            <Play className="w-3.5 h-3.5 mr-1" /> {status === 'paused' ? '继续' : '开始'}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={busy || terminal}
        >
          <X className="w-3.5 h-3.5 mr-1" /> 取消
        </Button>
        <span className="text-caption text-on-surface-variant">
          {terminal ? '任务已结束' : '暂停后已完成的步骤不会重跑'}
        </span>
      </div>

      {!terminal && (
        <div className="flex items-center gap-2">
          <input
            className="flex-1 bg-surface-container rounded-cw-sm px-2.5 py-1.5 text-caption text-on-surface outline-none border border-outline-variant/30 focus:border-primary"
            placeholder="想插一句话？例如：第 3 段换成实拍"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="人工插话"
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={!text.trim() || busy}
            onClick={() => {
              if (!text.trim()) return;
              onInject?.(text.trim());
              setText('');
            }}
          >
            <MessageSquarePlus className="w-3.5 h-3.5 mr-1" /> 插话
          </Button>
        </div>
      )}
    </div>
  );
}
