import { useMemo, useState } from 'react';
import { Button } from '@/components/ui';

export interface PlanSectionView {
  id: string;
  name?: string;
  t0: number;
  t1: number;
  purpose?: string;
  screen_kinds?: string[];
}

export interface PlanCustomSectionView {
  name: string;
  reason?: string;
  content?: unknown;
}

export interface PlanView {
  type?: string;
  target_duration_sec?: number;
  sections?: PlanSectionView[];
  screen_kinds?: string[];
  beats?: { bpm?: number; beat_zero_sec?: number; policy?: string } | null;
  material_strategy?: { sources?: string[]; grounding?: string; gaps?: string[]; license_policy?: string } | null;
  risks?: Array<{ risk: string; mitigation?: string }>;
  acceptance?: Array<{ metric: string; target?: unknown }>;
  custom_sections?: PlanCustomSectionView[];
  legacy?: boolean;
}

export interface BriefView {
  title?: string;
  overview?: string;
  target_audience?: string;
  core_message?: string;
  style_direction?: string;
  key_elements?: string[];
  special_requirements?: string[];
}

interface Props {
  plan: PlanView;
  brief?: BriefView;
  onConfirm?: (plan: PlanView) => void;
  onBack?: () => void;
  /** 只读模式（例如 legacy 规划或已确认后的回看） */
  readOnly?: boolean;
}

/**
 * 规划确认页（PRD §II.13 / F-06）。
 *
 * 双栏：左边「创意简报」（为什么做），右边「整体规划」（怎么做）。
 * 三条硬约束：
 * 1. legacy 规划必须显式标注（不是 plan-first 产物，人要知道）；
 * 2. 自定义维度缺 `reason` → **禁止确认**（PRD §II.13.5）；
 * 3. 段落时间可编辑，但确认时把编辑后的 plan 交回去（不在组件里偷偷改源数据）。
 */
export function PlanReviewPanel({ plan, brief, onConfirm, onBack, readOnly }: Props) {
  const [draft, setDraft] = useState<PlanView>(() => ({
    ...plan,
    sections: (plan.sections ?? []).map((section) => ({ ...section })),
  }));
  const [error, setError] = useState('');

  const sections = draft.sections ?? [];
  const totalSec = useMemo(
    () => sections.reduce((sum, section) => sum + Math.max(0, (section.t1 ?? 0) - (section.t0 ?? 0)), 0),
    [sections],
  );
  const target = draft.target_duration_sec ?? 0;
  const drift = target > 0 ? Math.abs(totalSec - target) / target : 0;

  const missingReason = (draft.custom_sections ?? []).filter(
    (section) => !String(section.reason ?? '').trim(),
  );

  const updateSection = (index: number, patch: Partial<PlanSectionView>) => {
    setDraft((current) => ({
      ...current,
      sections: (current.sections ?? []).map((section, i) =>
        i === index ? { ...section, ...patch } : section,
      ),
    }));
  };

  const confirm = () => {
    if (missingReason.length > 0) {
      setError(`自定义维度缺少理由：${missingReason.map((s) => s.name).join('、')}`);
      return;
    }
    if (drift > 0.25) {
      setError(`段落总长与目标时长偏差 ${(drift * 100).toFixed(0)}%，超过 25% 不允许确认`);
      return;
    }
    setError('');
    onConfirm?.(draft);
  };

  return (
    <div className="space-y-4" data-testid="plan-review">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-title-sm font-semibold text-on-surface">确认规划</h2>
          <p className="text-caption text-on-surface-variant">
            左边是「为什么做」，右边是「怎么做」；确认后按此执行，偏离会留痕。
          </p>
        </div>
        <div className="flex gap-2">
          {onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>返回修改</Button>
          )}
          <Button size="sm" onClick={confirm} disabled={readOnly}>
            {readOnly ? '只读' : '确认并开始制作'}
          </Button>
        </div>
      </div>

      {draft.legacy && (
        <div className="bg-warning/10 border border-warning/40 rounded-cw-sm px-3 py-2">
          <span className="font-mono text-caption text-warning">
            legacy 规划：由现有场景反向生成，不是 plan-first 产物；如需严格规划请回到需求对话重做。
          </span>
        </div>
      )}

      {error && (
        <div className="bg-error/10 border border-error/30 rounded-cw-sm px-3 py-2">
          <span className="font-mono text-caption text-error">{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 左：创意简报 */}
        <section className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-4">
          <p className="font-mono text-caption text-on-surface-variant mb-2">创意简报</p>
          <h3 className="text-body-sm font-semibold text-on-surface mb-2">{brief?.title || '（未命名）'}</h3>
          <dl className="space-y-1.5 text-label-sm">
            {[
              ['概述', brief?.overview],
              ['目标受众', brief?.target_audience],
              ['核心信息', brief?.core_message],
              ['风格方向', brief?.style_direction],
            ].map(([label, value]) => (
              <div key={label as string} className="flex gap-2">
                <dt className="w-20 shrink-0 text-on-surface-variant">{label}</dt>
                <dd className="text-on-surface">{value || '—'}</dd>
              </div>
            ))}
          </dl>
          {(brief?.key_elements?.length ?? 0) > 0 && (
            <p className="font-mono text-caption text-on-surface-variant mt-2">
              关键元素：{brief?.key_elements?.join('、')}
            </p>
          )}
          {(brief?.special_requirements?.length ?? 0) > 0 && (
            <p className="font-mono text-caption text-warning mt-1">
              特殊要求：{brief?.special_requirements?.join('；')}
            </p>
          )}
        </section>

        {/* 右：整体规划 */}
        <section className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-caption text-on-surface-variant">整体规划</p>
            <span className={`font-mono text-caption ${drift > 0.25 ? 'text-error' : 'text-on-surface-variant'}`}>
              {totalSec.toFixed(1)}s / 目标 {target.toFixed(1)}s
            </span>
          </div>

          {sections.length === 0 ? (
            <p className="font-mono text-caption text-on-surface-variant">尚无段落规划</p>
          ) : (
            <div className="space-y-2">
              {sections.map((section, index) => (
                <div key={section.id} className="border border-outline-variant/30 rounded-cw-xs p-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-caption text-primary">{section.id}</span>
                    <span className="text-label-sm text-on-surface">{section.name || '—'}</span>
                    <span className="font-mono text-caption text-on-surface-variant">
                      {(section.t0 ?? 0).toFixed(2)}–{(section.t1 ?? 0).toFixed(2)}s
                    </span>
                  </div>
                  <textarea
                    aria-label={`purpose-${index}`}
                    value={section.purpose ?? ''}
                    rows={2}
                    readOnly={readOnly}
                    onChange={(event) => updateSection(index, { purpose: event.target.value })}
                    className="w-full bg-surface rounded-cw-xs px-2 py-1.5 text-caption text-on-surface"
                  />
                  {(section.screen_kinds?.length ?? 0) > 0 && (
                    <p className="font-mono text-caption text-on-surface-variant mt-1">
                      画面：{section.screen_kinds?.join('、')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {draft.beats && (draft.beats.bpm ?? 0) > 0 && (
            <p className="font-mono text-caption text-on-surface-variant mt-2">
              卡点：BPM {draft.beats.bpm}，第 0 拍 {draft.beats.beat_zero_sec ?? 0}s
              {draft.beats.policy ? `；${draft.beats.policy}` : ''}
            </p>
          )}

          {(draft.material_strategy?.gaps?.length ?? 0) > 0 && (
            <div className="mt-2">
              <p className="font-mono text-caption text-warning">素材缺口（必须补齐或接受妥协）：</p>
              <ul className="list-disc pl-4">
                {draft.material_strategy?.gaps?.map((gap) => (
                  <li key={gap} className="font-mono text-caption text-on-surface-variant">{gap}</li>
                ))}
              </ul>
            </div>
          )}

          {(draft.custom_sections?.length ?? 0) > 0 && (
            <div className="mt-2 space-y-1">
              <p className="font-mono text-caption text-on-surface-variant">自定义维度</p>
              {draft.custom_sections?.map((section) => (
                <p key={section.name} className="font-mono text-caption text-on-surface-variant">
                  · {section.name}：{section.reason ? section.reason : <span className="text-error">缺少理由</span>}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default PlanReviewPanel;
