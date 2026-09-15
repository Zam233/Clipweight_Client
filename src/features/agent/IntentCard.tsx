import { useState } from 'react';
import { AlertTriangle, Check, HelpCircle, Sparkles, X } from 'lucide-react';

/**
 * 意图确认卡（R6）——**先让用户看清"将发生什么"，再让他确认**。
 *
 * 为什么要有这张卡：自然语言指令最容易出的问题不是"听不懂"，而是"听懂了但理解得跟你不一样"。
 * 与其等执行完再回滚，不如把"解析出的意图 + 受影响片段 + 需要拍板的问题"摆在执行之前。
 * 卡上的三个区块分别对应后端 `POST /api/requirements/{sid}/intent` 的三部分：
 * `intent`（人话总结）、`resolution.preview`（将改动什么）、`resolution.questions`（要用户选）。
 *
 * 交互原则：**有未答问题时不提供"确认执行"**（只给"取消"与选项），避免用户在信息不全时按下确认。
 */

export interface IntentQuestion {
  code: string;
  text: string;
  options: { value: string; label: string }[];
  op_index?: number;
}

export interface IntentPreview {
  intent: string;
  preview: string[];
  affected_clip_ids: string[];
  questions: IntentQuestion[];
  problems: string[];
  blocked?: boolean;
  hardProblems?: { level: string; where: string; message: string }[];
}

interface Props {
  data: IntentPreview;
  /** 确认执行（后端 apply 通路；R7 接入）。 */
  onConfirm?: (answers: Record<string, string>) => void;
  /** 取消：不执行任何改动。 */
  onCancel?: () => void;
}

export function IntentCard({ data, onConfirm, onCancel }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = data.questions ?? [];
  const unanswered = questions.filter((q) => !answers[q.code]);
  const hardErrors = (data.hardProblems ?? []).filter((p) => p.level === 'error');
  const warnings = (data.hardProblems ?? []).filter((p) => p.level === 'warning');
  const blocked = Boolean(data.blocked) || hardErrors.length > 0;
  const canConfirm = !blocked && unanswered.length === 0 && Boolean(onConfirm);

  return (
    <div
      className="mt-2 rounded-lg border border-outline-variant bg-surface-container p-3 text-body-sm"
      data-testid="intent-card"
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-primary" aria-hidden />
        <span className="font-medium text-on-surface">指令理解</span>
        {blocked && (
          <span className="ml-auto inline-flex items-center gap-1 text-error">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> 无法执行
          </span>
        )}
      </div>

      <pre className="whitespace-pre-wrap break-words text-on-surface-variant mb-2" data-testid="intent-summary">
        {data.intent || '（未解析出任何操作）'}
      </pre>

      {data.preview?.length > 0 && (
        <div className="mb-2" data-testid="intent-preview">
          <div className="text-on-surface-variant mb-1">将改动：</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {data.preview.map((line, i) => (
              <li key={i} className="text-on-surface">{line}</li>
            ))}
          </ul>
        </div>
      )}

      {blocked && (
        <div className="mb-2 rounded border border-error/40 bg-error/10 p-2" data-testid="intent-blocked">
          <div className="text-error font-medium mb-1">这条指令里有我不能执行的操作：</div>
          <ul className="list-disc pl-5 space-y-0.5 text-on-surface">
            {[...hardErrors, ...data.problems.map((m) => ({ message: m }))].slice(0, 4).map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
          <div className="text-on-surface-variant mt-1">请换一种说法，或减少要改的内容。</div>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="mb-2 text-on-surface-variant" data-testid="intent-warnings">
          {warnings.slice(0, 3).map((w, i) => (
            <li key={i}>· {w.message}</li>
          ))}
        </ul>
      )}

      {questions.map((q) => (
        <div key={q.code} className="mb-2 rounded border border-outline-variant p-2" data-testid="intent-question">
          <div className="flex items-start gap-1 mb-1">
            <HelpCircle className="w-3.5 h-3.5 mt-0.5 text-warning shrink-0" aria-hidden />
            <span className="text-on-surface">{q.text}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {q.options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAnswers((prev) => ({ ...prev, [q.code]: opt.value }))}
                className={
                  'px-2 py-0.5 rounded border text-label-sm transition-colors ' +
                  (answers[q.code] === opt.value
                    ? 'border-primary bg-primary/15 text-on-surface'
                    : 'border-outline-variant hover:border-primary text-on-surface-variant')
                }
                data-testid={`intent-option-${q.code}-${opt.value}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() => onConfirm?.(answers)}
          className={
            'inline-flex items-center gap-1 px-2.5 py-1 rounded text-label-sm ' +
            (canConfirm
              ? 'bg-primary text-on-primary hover:opacity-90'
              : 'bg-surface-container-high text-on-surface-variant cursor-not-allowed')
          }
          title={unanswered.length > 0 ? '请先回答上面的问题' : undefined}
          data-testid="intent-confirm"
        >
          <Check className="w-3.5 h-3.5" aria-hidden /> 确认执行
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-outline-variant text-label-sm text-on-surface-variant hover:border-error"
          data-testid="intent-cancel"
        >
          <X className="w-3.5 h-3.5" aria-hidden /> 取消
        </button>
        {unanswered.length > 0 && (
          <span className="text-on-surface-variant text-label-sm" data-testid="intent-hint">
            还有 {unanswered.length} 个问题需要确认
          </span>
        )}
        {data.affected_clip_ids?.length > 0 && (
          <span className="ml-auto text-on-surface-variant text-label-sm" data-testid="intent-affected">
            影响 {data.affected_clip_ids.length} 个片段
          </span>
        )}
      </div>
    </div>
  );
}
