import { Button } from '@/components/ui';

interface Props {
  value: string;
  avoid: string[];
  onChange: (value: string) => void;
  onAvoidChange: (avoid: string[]) => void;
  onOpenChat: () => void;
  maxChars?: number;
}

/**
 * 创作提示词区（PRD §II.12 R2）。
 *
 * 只负责"写要什么 / 看不要什么 / 叫出对话助手"；不决定编排路径（R1 已去掉二选一）。
 */
export function CreativePromptField({
  value,
  avoid,
  onChange,
  onAvoidChange,
  onOpenChat,
  maxChars = 4000,
}: Props) {
  return (
    <div className="border-t border-outline-variant/25 pt-4" data-testid="creative-prompt-field">
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <p className="text-label-sm font-semibold text-on-surface">创作提示词</p>
          <p className="text-caption text-on-surface-variant">
            写清“要什么、不要什么”；不确定可以点右侧按钮和 AI 聊出提示词。
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onOpenChat}>
          和 AI 聊聊
        </Button>
      </div>

      <textarea
        aria-label="creative-prompt"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        maxLength={maxChars}
        placeholder="例：版画质感、三墨套印、硬切为主；每句歌词配一个语义相符的画面"
        className="w-full bg-surface rounded-cw-sm px-3 py-2 text-label-sm text-on-surface border border-outline-variant/40 focus:border-primary outline-none"
      />

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {avoid.map((item) => (
          <span
            key={item}
            className="px-2 py-0.5 rounded-cw-full bg-warning/10 border border-warning/30 font-mono text-caption text-warning"
          >
            避免：{item}
            <button
              aria-label={`remove-avoid-${item}`}
              onClick={() => onAvoidChange(avoid.filter((entry) => entry !== item))}
              className="ml-1 cursor-pointer"
            >
              ×
            </button>
          </span>
        ))}
        <span className="font-mono text-caption text-on-surface-variant">
          {value.length} / {maxChars}
        </span>
      </div>
    </div>
  );
}

export default CreativePromptField;
