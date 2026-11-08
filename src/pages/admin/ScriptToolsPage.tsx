/**
 * 脚本工具页（PRD B4 / G14）。
 *
 * 后端 `/api/pipeline/script-tools` 早已存在（改写 / 扩写 / 缩写），但前端一直没有入口，
 * 只能手工调 API。这里补一个**最小、只读预览**的页面：
 *
 * - 结果只在页面内展示，**不自动写入时间线 / 不自动启动任务**（避免绕过需求确认）；
 * - `fallback=true`（LLM 不可用、后端原样返回）要显式说出来，不能装作扩写成功；
 * - 明确标注这是"旧 pipeline 侧的兼容能力"，新创作主路径仍是「新建制作 → 需求确认 → 主 Agent」。
 */
import { useState } from 'react';
import { ConsoleShell, ConsoleHeading } from './ConsoleShell';
import { Button } from '@/components/ui';
import { pipelineApi } from '@/services/api';
import { cn } from '@/lib/utils';
import { Loader2, Wand2, Copy } from 'lucide-react';

type Mode = 'rewrite' | 'expand' | 'summarize';

const MODES: Array<{ key: Mode; label: string; hint: string }> = [
  { key: 'rewrite', label: '改写', hint: '换个说法，意思不变' },
  { key: 'expand', label: '扩写', hint: '把要点展开成完整口播' },
  { key: 'summarize', label: '缩写', hint: '压成更短的版本' },
];

const INPUT = 'w-full bg-surface rounded-cw-sm px-3 py-2 font-mono text-body-sm text-on-surface '
  + 'outline-none border border-outline-variant/30 focus:border-primary';

export function ScriptToolsPage() {
  const [mode, setMode] = useState<Mode>('rewrite');
  const [text, setText] = useState('');
  const [style, setStyle] = useState('');
  const [maxLength, setMaxLength] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!text.trim()) {
      setError('请先粘贴原文稿');
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setFallbackNote(null);
    try {
      const parsedMax = Number(maxLength);
      const res = await pipelineApi.scriptTools({
        mode,
        script_text: text,
        ...(style.trim() ? { style: style.trim() } : {}),
        ...(Number.isFinite(parsedMax) && parsedMax > 0 ? { max_length: Math.round(parsedMax) } : {}),
      });
      setResult(res.result);
      if (res.fallback) {
        setFallbackNote(res.note || 'LLM 不可用：后端原样返回了原文，未做任何处理');
      }
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (e instanceof Error ? e.message : '处理失败');
      setError(detail);
    } finally {
      setRunning(false);
    }
  };

  return (
    <ConsoleShell>
      <ConsoleHeading
        kicker="Tools / Script"
        title="脚本工具"
        desc="改写 / 扩写 / 缩写现有文稿。结果只在这里预览，不会自动写入时间线或启动任务。"
      />

      <p className="mb-4 text-caption text-on-surface-variant">
        这是旧 pipeline 侧的兼容能力（<code className="font-mono">POST /api/pipeline/script-tools</code>）。
        新创作仍走「新建制作 → 需求确认 → 主 Agent 任务」。
      </p>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-6 space-y-3">
          <div className="flex gap-1 w-fit rounded-cw-sm bg-surface-container p-1 border border-outline-variant/30">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                data-testid={`script-mode-${m.key}`}
                onClick={() => setMode(m.key)}
                title={m.hint}
                className={cn(
                  'rounded-cw-xs px-3 py-1 text-label-sm transition-colors cursor-pointer',
                  mode === m.key
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-label text-on-surface-variant">原文稿</span>
            <textarea
              data-testid="script-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder="粘贴要处理的口播稿…"
              className={INPUT}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="风格要求（可选），如：更口语、更专业"
              className={cn(INPUT, 'w-64')}
            />
            <input
              value={maxLength}
              onChange={(e) => setMaxLength(e.target.value)}
              placeholder="目标字数（可选）"
              inputMode="numeric"
              className={cn(INPUT, 'w-40')}
            />
            <Button size="sm" onClick={() => void run()} disabled={running}>
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {running ? '处理中…' : '开始处理'}
            </Button>
          </div>
          {error && <p className="text-caption text-error" data-testid="script-error">{error}</p>}
        </div>

        <div className="col-span-12 lg:col-span-6">
          <div className="rounded-cw-md border border-outline-variant/30 bg-surface-container overflow-hidden">
            <div className="flex items-center gap-2 border-b border-outline-variant/20 bg-surface-container-high px-4 py-2.5">
              <span className="text-label-sm text-on-surface">结果（只读预览）</span>
              {result && (
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1 text-caption text-on-surface-variant hover:text-on-surface cursor-pointer"
                  onClick={() => { void navigator.clipboard?.writeText(result); }}
                >
                  <Copy className="w-3 h-3" /> 复制
                </button>
              )}
            </div>
            <div className="p-4">
              {fallbackNote && (
                <p className="mb-2 text-caption text-warning" data-testid="script-fallback">{fallbackNote}</p>
              )}
              {result ? (
                <pre
                  data-testid="script-result"
                  className="max-h-[420px] overflow-auto whitespace-pre-wrap font-mono text-caption leading-relaxed text-on-surface"
                >
                  {result}
                </pre>
              ) : (
                <p className="text-caption text-on-surface-variant/60">还没有结果。</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </ConsoleShell>
  );
}
