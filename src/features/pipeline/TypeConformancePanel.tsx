import { useMemo } from 'react';

/** trace 里的 `prompt_resolution` 事件（后端 `emit_prompt_resolution` 产出）。 */
export interface PromptResolutionEvent {
  type?: string;
  agent?: string;
  message?: string;
  detail?: {
    category_id?: string;
    stage?: string;
    params?: Record<string, { value?: unknown; source_layer?: string; overridden_by?: string }>;
    conflicts?: Array<{ code: string; key?: string; message?: string; enforce?: string }>;
    slots?: Array<{ key: string; priority?: number; chars?: number; truncated?: boolean; source?: string }>;
    dropped_slots?: string[];
    traits?: Array<{ name: string; mode?: string; threshold?: number; feasible?: boolean | null }>;
    deformation?: { code?: string; reasons?: string[]; note?: string } | null;
  } | null;
  [key: string]: unknown;
}

const LAYER_LABELS: Record<string, string> = {
  L0_platform: '平台底线',
  L1_user: '用户输入',
  L2_prompt: '类型提示词',
  L3_category: '类型参数',
  L4_persona: 'Persona',
  L5_default: '默认值',
};

function isResolution(event: unknown): event is PromptResolutionEvent {
  return Boolean(event && typeof event === 'object' && (event as { type?: string }).type === 'prompt_resolution');
}

interface Props {
  events: unknown[] | null | undefined;
}

/**
 * 类型符合度（PRD F3 / V3 的前端一半）。
 *
 * 把 trace 里的 `prompt_resolution` 事件翻成人能读的：
 * **每个参数最终值是谁定的**、哪些冲突、哪些槽位被丢弃、有没有类型变形。
 * 没有该类事件时明确说"本次运行没有类型规范裁决"，不显示空表格。
 */
export function TypeConformancePanel({ events }: Props) {
  const resolutions = useMemo(
    () => (events ?? []).filter(isResolution).reverse(),
    [events],
  );

  if (resolutions.length === 0) {
    return (
      <div className="mt-3 pt-2.5 border-t border-outline-variant/15" data-testid="type-conformance">
        <p className="text-label text-on-surface-variant mb-1">类型符合度</p>
        <p className="font-mono text-caption text-on-surface-variant">
          本次运行没有类型规范裁决记录（该类型可能未声明规范）。
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-2.5 border-t border-outline-variant/15" data-testid="type-conformance">
      <p className="text-label text-on-surface-variant mb-2">类型符合度</p>
      <div className="space-y-2">
        {resolutions.map((event, index) => {
          const detail = event.detail ?? {};
          const params = Object.entries(detail.params ?? {});
          const conflicts = detail.conflicts ?? [];
          const slots = detail.slots ?? [];
          const deformation = detail.deformation ?? null;
          return (
            <div key={`${event.agent ?? 'agent'}-${index}`} className="bg-surface rounded-cw-sm border border-outline-variant/30 p-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-caption text-primary">{detail.category_id || '未指定类型'}</span>
                {detail.stage && (
                  <span className="font-mono text-caption text-on-surface-variant">阶段 {detail.stage}</span>
                )}
                <span className="font-mono text-caption text-on-surface-variant">
                  {params.length} 参数 · {conflicts.length} 冲突 · {slots.length} 槽位
                </span>
              </div>

              {params.length > 0 && (
                <table className="w-full font-mono text-caption">
                  <tbody>
                    {params.map(([key, entry]) => (
                      <tr key={key}>
                        <td className="text-on-surface-variant pr-2 whitespace-nowrap">{key}</td>
                        <td className="text-on-surface pr-2">{String(entry?.value)}</td>
                        <td className="text-on-surface-variant">
                          {LAYER_LABELS[String(entry?.source_layer)] ?? entry?.source_layer ?? '—'}
                          {entry?.overridden_by ? `（被 ${entry.overridden_by} 覆盖）` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {conflicts.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {conflicts.map((conflict, i) => (
                    <p key={`${conflict.code}-${i}`} className="font-mono text-caption text-warning">
                      [{conflict.code}] {conflict.message || conflict.key}
                    </p>
                  ))}
                </div>
              )}

              {(detail.dropped_slots?.length ?? 0) > 0 && (
                <p className="font-mono text-caption text-on-surface-variant mt-1">
                  超预算丢弃槽位：{detail.dropped_slots?.join(', ')}
                </p>
              )}

              {deformation && (
                <div className="mt-1.5 bg-error/10 border border-error/30 rounded-cw-xs px-2 py-1.5">
                  <p className="font-mono text-caption text-error">
                    类型变形（{deformation.code}）：{(deformation.reasons ?? []).join('；')}
                  </p>
                  <p className="font-mono text-caption text-on-surface-variant">
                    {deformation.note || '只能回落到类型合法域或切换类型'}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TypeConformancePanel;
