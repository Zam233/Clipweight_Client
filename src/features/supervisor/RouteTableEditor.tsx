/**
 * 路由表编辑器（F5，管理员）。
 *
 * 只做「按阶段配候选」这一件事：每阶段若干 `provider/model/tier`；
 * 白名单留空 = 允许所有已配置 provider（与后端语义一致）。
 */

import { useState } from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { RouteCandidate, RoutesResponse } from '@/types/supervisor';

import { stageLabel } from './labels';

const STAGES = ['structure', 'material', 'edit', 'animation', 'audio', 'quality'] as const;
const TIERS: RouteCandidate['tier'][] = ['cheap', 'std', 'strong'];

interface Props {
  initial: RoutesResponse | null;
  onSave?: (payload: { routes: Record<string, RouteCandidate[]>; whitelist: string[] }) => void;
  busy?: boolean;
  saved?: boolean;
  className?: string;
}

export function RouteTableEditor({ initial, onSave, busy, saved, className }: Props) {
  const [routes, setRoutes] = useState<Record<string, RouteCandidate[]>>(
    initial?.routes ?? {},
  );
  const [whitelist, setWhitelist] = useState<string>((initial?.whitelist ?? []).join(', '));

  const update = (stage: string, idx: number, patch: Partial<RouteCandidate>) =>
    setRoutes((prev) => {
      const list = [...(prev[stage] ?? [])];
      list[idx] = { ...list[idx], ...patch };
      return { ...prev, [stage]: list };
    });

  const add = (stage: string) =>
    setRoutes((prev) => ({
      ...prev,
      [stage]: [...(prev[stage] ?? []), { provider: '', model: '', tier: 'std' }],
    }));

  const remove = (stage: string, idx: number) =>
    setRoutes((prev) => ({
      ...prev,
      [stage]: (prev[stage] ?? []).filter((_, i) => i !== idx),
    }));

  return (
    <div className={cn('space-y-3', className)}>
      <p className="text-caption text-on-surface-variant">
        留空的环节沿用默认模型；白名单留空 = 允许所有已配置 provider。
      </p>

      {STAGES.map((stage) => (
        <section key={stage} className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-caption font-semibold text-on-surface">{stageLabel(stage)}</h4>
            <Button size="sm" variant="outline" onClick={() => add(stage)}>
              添加候选
            </Button>
          </div>
          {(routes[stage] ?? []).length === 0 ? (
            <p className="text-caption text-on-surface-variant/70">（沿用默认模型）</p>
          ) : (
            <ul className="space-y-1">
              {(routes[stage] ?? []).map((c, idx) => (
                <li key={`${stage}-${idx}`} className="flex items-center gap-1.5">
                  <input
                    aria-label={`${stageLabel(stage)} 候选 ${idx + 1} provider`}
                    className="w-28 bg-surface-container rounded-cw-sm px-2 py-1 text-caption"
                    placeholder="provider"
                    value={c.provider}
                    onChange={(e) => update(stage, idx, { provider: e.target.value })}
                  />
                  <input
                    aria-label={`${stageLabel(stage)} 候选 ${idx + 1} model`}
                    className="flex-1 bg-surface-container rounded-cw-sm px-2 py-1 text-caption"
                    placeholder="model"
                    value={c.model}
                    onChange={(e) => update(stage, idx, { model: e.target.value })}
                  />
                  <select
                    aria-label={`${stageLabel(stage)} 候选 ${idx + 1} 档位`}
                    className="bg-surface-container rounded-cw-sm px-2 py-1 text-caption"
                    value={c.tier}
                    onChange={(e) =>
                      update(stage, idx, { tier: e.target.value as RouteCandidate['tier'] })
                    }
                  >
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" onClick={() => remove(stage, idx)}>
                    删除
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <label className="block text-caption text-on-surface-variant">
        模型白名单（逗号分隔，例：anthropic/claude-x）
        <input
          className="mt-1 w-full bg-surface-container rounded-cw-sm px-2 py-1 text-caption"
          value={whitelist}
          onChange={(e) => setWhitelist(e.target.value)}
        />
      </label>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            onSave?.({
              routes,
              whitelist: whitelist
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        >
          保存路由表
        </Button>
        {saved && <span className="text-caption text-success">已保存</span>}
      </div>
    </div>
  );
}
