import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import {
  IDENTITY_SLOTS,
  SLOT_LABELS,
  STAGE_SLOTS,
  typeMakerApi,
  type Deformation,
  type ParamRule,
  type PromptSlot,
  type ResolveResult,
  type SignatureTrait,
  type SpecIssue,
  type TypeDefinition,
} from '@/services/api/typeMaker';

const MODES: ParamRule['mode'][] = ['floor', 'ceiling', 'exact', 'forbid', 'require'];
const TRAIT_MODES: SignatureTrait['mode'][] = ['require_ge', 'require_le', 'require_between'];

function emptyRule(): ParamRule {
  return { key: '', mode: 'floor', value: 0, reason: '', enforce: 'soft' };
}

function emptyTrait(): SignatureTrait {
  return { name: '', mode: 'require_ge', value: 0, enforce: 'soft', reason: '' };
}

interface Props {
  typeId: string;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * 类型规范编辑器（PRD Part I F11 / F-01/F-02）。
 *
 * 三块：身份层 3 槽位（genre 必填）、阶段层 7 槽位、参数规则 + 指标。
 * 保存前先 `validate`（悬空数字/指标矛盾），再 `resolve` 看冲突与类型变形；
 * **`type_deformation` 时不提供"豁免"按钮**，只给"按规范调整"。
 */
export function TypeSpecEditor({ typeId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [definition, setDefinition] = useState<TypeDefinition | null>(null);
  const [prompts, setPrompts] = useState<Record<string, PromptSlot>>({});
  const [rules, setRules] = useState<ParamRule[]>([]);
  const [traits, setTraits] = useState<SignatureTrait[]>([]);
  const [errors, setErrors] = useState<SpecIssue[]>([]);
  const [warnings, setWarnings] = useState<SpecIssue[]>([]);
  const [resolution, setResolution] = useState<ResolveResult | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await typeMakerApi.get(typeId);
        if (!alive) return;
        setDefinition(data);
        setPrompts(data.prompts ?? {});
        setRules(data.param_rules ?? []);
        setTraits(data.signature_traits ?? []);
      } catch {
        if (alive) setNotice('读取类型失败：后端不可达');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [typeId]);

  const payload = useMemo(
    () => ({
      ...(definition ?? {}),
      id: typeId,
      prompts,
      param_rules: rules,
      signature_traits: traits,
    }),
    [definition, typeId, prompts, rules, traits],
  );

  const totalChars = useMemo(
    () => Object.values(prompts).reduce((sum, slot) => sum + (slot?.text?.length ?? 0), 0),
    [prompts],
  );

  const updateSlot = (key: string, text: string) => {
    setPrompts((current) => ({ ...current, [key]: { ...(current[key] ?? {}), text } }));
  };

  const runValidate = async () => {
    setNotice('');
    try {
      const result = await typeMakerApi.validate(payload as Partial<TypeDefinition>);
      setErrors(result.errors ?? []);
      setWarnings(result.warnings ?? []);
      setResolution(null);
    } catch {
      setNotice('校验失败：后端不可达');
    }
  };

  const runResolve = async () => {
    setNotice('');
    try {
      const result = await typeMakerApi.resolve({
        ...(payload as Partial<TypeDefinition>),
        user_params: {},
      });
      setResolution(result);
      setErrors([]);
      setWarnings([]);
    } catch {
      setNotice('裁决失败：后端不可达');
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setNotice('');
    try {
      const validation = await typeMakerApi.validate(payload as Partial<TypeDefinition>);
      if (!validation.ok) {
        setErrors(validation.errors ?? []);
        setWarnings(validation.warnings ?? []);
        setNotice('存在错误，未保存');
        return;
      }
      await typeMakerApi.update(typeId, payload as Partial<TypeDefinition>);
      onSaved?.();
      onClose();
    } catch {
      setNotice('保存失败：后端不可达');
    } finally {
      setSaving(false);
    }
  };

  const deformation: Deformation | null = resolution?.deformation ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[86vh] overflow-y-auto bg-surface-container border border-outline-variant/40 rounded-cw-lg p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-title-sm font-semibold text-on-surface">类型规范 · {typeId}</h3>
          <span className="font-mono text-caption text-on-surface-variant">{totalChars} / 4000 chars</span>
        </div>

        {notice && (
          <div className="bg-error/10 border border-error/30 rounded-cw-sm px-3 py-2 mb-3">
            <span className="font-mono text-caption text-error">{notice}</span>
          </div>
        )}

        {loading ? (
          <p className="text-label-sm text-on-surface-variant py-4">读取中…</p>
        ) : (
          <div className="space-y-5">
            <section>
              <p className="text-label text-on-surface-variant mb-1.5">身份层（定义"这是什么片子"）</p>
              <div className="space-y-2">
                {IDENTITY_SLOTS.map((key) => (
                  <label key={key} className="block">
                    <span className="font-mono text-caption text-on-surface-variant">{SLOT_LABELS[key]}</span>
                    <textarea
                      aria-label={`slot-${key}`}
                      value={prompts[key]?.text ?? ''}
                      onChange={(event) => updateSlot(key, event.target.value)}
                      rows={key === 'genre' ? 3 : 2}
                      className="mt-1 w-full bg-surface rounded-cw-xs px-2.5 py-2 text-label-sm text-on-surface border border-outline-variant/40 focus:border-primary outline-none"
                      placeholder={key === 'genre' ? '写成可判别的描述：叙事逻辑、镜头语言、声音质感' : ''}
                    />
                  </label>
                ))}
              </div>
            </section>

            <section>
              <p className="text-label text-on-surface-variant mb-1.5">阶段层（每段怎么拍）</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {STAGE_SLOTS.map((key) => (
                  <label key={key} className="block">
                    <span className="font-mono text-caption text-on-surface-variant">{SLOT_LABELS[key]}</span>
                    <textarea
                      aria-label={`slot-${key}`}
                      value={prompts[key]?.text ?? ''}
                      onChange={(event) => updateSlot(key, event.target.value)}
                      rows={2}
                      className="mt-1 w-full bg-surface rounded-cw-xs px-2.5 py-2 text-label-sm text-on-surface border border-outline-variant/40 focus:border-primary outline-none"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-label text-on-surface-variant">参数规则（提示词优先于参数）</p>
                <Button size="sm" variant="outline" onClick={() => setRules((current) => [...current, emptyRule()])}>
                  添加规则
                </Button>
              </div>
              {rules.length === 0 ? (
                <p className="font-mono text-caption text-on-surface-variant">尚无规则</p>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule, index) => (
                    <div key={index} className="grid grid-cols-12 gap-1.5 items-center">
                      <input aria-label={`rule-key-${index}`} value={rule.key}
                        onChange={(event) => setRules((c) => c.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))}
                        placeholder="min_shot_ms"
                        className="col-span-3 bg-surface rounded-cw-xs px-2 py-1.5 font-mono text-caption" />
                      <select aria-label={`rule-mode-${index}`} value={rule.mode}
                        onChange={(event) => setRules((c) => c.map((r, i) => (i === index ? { ...r, mode: event.target.value as ParamRule['mode'] } : r)))}
                        className="col-span-2 bg-surface rounded-cw-xs px-1 py-1.5 font-mono text-caption">
                        {MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                      </select>
                      <input aria-label={`rule-value-${index}`} value={String(rule.value)}
                        onChange={(event) => setRules((c) => c.map((r, i) => (i === index ? { ...r, value: Number(event.target.value) || 0 } : r)))}
                        className="col-span-2 bg-surface rounded-cw-xs px-2 py-1.5 font-mono text-caption" />
                      <select aria-label={`rule-enforce-${index}`} value={rule.enforce}
                        onChange={(event) => setRules((c) => c.map((r, i) => (i === index ? { ...r, enforce: event.target.value as ParamRule['enforce'] } : r)))}
                        className="col-span-2 bg-surface rounded-cw-xs px-1 py-1.5 font-mono text-caption">
                        <option value="soft">soft</option>
                        <option value="strict">strict</option>
                      </select>
                      <button aria-label={`rule-remove-${index}`}
                        onClick={() => setRules((c) => c.filter((_, i) => i !== index))}
                        className="col-span-1 text-on-surface-variant hover:text-error cursor-pointer text-caption">删</button>
                      <input aria-label={`rule-reason-${index}`} value={rule.reason}
                        onChange={(event) => setRules((c) => c.map((r, i) => (i === index ? { ...r, reason: event.target.value } : r)))}
                        placeholder="为什么需要这条规则"
                        className="col-span-12 bg-surface rounded-cw-xs px-2 py-1.5 text-caption" />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-label text-on-surface-variant">同一性指标（可测代理）</p>
                <Button size="sm" variant="outline" onClick={() => setTraits((current) => [...current, emptyTrait()])}>
                  添加指标
                </Button>
              </div>
              {traits.length === 0 ? (
                <p className="font-mono text-caption text-on-surface-variant">尚无指标</p>
              ) : (
                <div className="space-y-2">
                  {traits.map((trait, index) => (
                    <div key={index} className="grid grid-cols-12 gap-1.5 items-center">
                      <input aria-label={`trait-name-${index}`} value={trait.name}
                        onChange={(event) => setTraits((c) => c.map((t, i) => (i === index ? { ...t, name: event.target.value } : t)))}
                        placeholder="avg_shot_ms"
                        className="col-span-3 bg-surface rounded-cw-xs px-2 py-1.5 font-mono text-caption" />
                      <select aria-label={`trait-mode-${index}`} value={trait.mode}
                        onChange={(event) => setTraits((c) => c.map((t, i) => (i === index ? { ...t, mode: event.target.value as SignatureTrait['mode'] } : t)))}
                        className="col-span-3 bg-surface rounded-cw-xs px-1 py-1.5 font-mono text-caption">
                        {TRAIT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                      </select>
                      <input aria-label={`trait-value-${index}`} value={String(trait.value)}
                        onChange={(event) => setTraits((c) => c.map((t, i) => (i === index ? { ...t, value: Number(event.target.value) || 0 } : t)))}
                        className="col-span-2 bg-surface rounded-cw-xs px-2 py-1.5 font-mono text-caption" />
                      <select aria-label={`trait-enforce-${index}`} value={trait.enforce}
                        onChange={(event) => setTraits((c) => c.map((t, i) => (i === index ? { ...t, enforce: event.target.value as SignatureTrait['enforce'] } : t)))}
                        className="col-span-2 bg-surface rounded-cw-xs px-1 py-1.5 font-mono text-caption">
                        <option value="soft">soft</option>
                        <option value="strict">strict</option>
                      </select>
                      <button aria-label={`trait-remove-${index}`}
                        onClick={() => setTraits((c) => c.filter((_, i) => i !== index))}
                        className="col-span-1 text-on-surface-variant hover:text-error cursor-pointer text-caption">删</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {(errors.length > 0 || warnings.length > 0) && (
              <section className="space-y-1">
                {errors.map((issue) => (
                  <div key={`${issue.code}-${issue.message}`} className="bg-error/10 border border-error/30 rounded-cw-xs px-2.5 py-1.5">
                    <span className="font-mono text-caption text-error">✗ {issue.code}: {issue.message}</span>
                  </div>
                ))}
                {warnings.map((issue) => (
                  <div key={`w-${issue.code}-${issue.message}`} className="bg-warning/10 border border-warning/30 rounded-cw-xs px-2.5 py-1.5">
                    <span className="font-mono text-caption text-warning">! {issue.code}: {issue.message}</span>
                  </div>
                ))}
              </section>
            )}

            {deformation && (
              <section className="bg-error/10 border border-error/40 rounded-cw-sm px-3 py-2.5">
                <p className="text-label-sm text-error font-semibold mb-1">这不是参数问题：配置改变了类型同一性</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {deformation.reasons.map((reason) => (
                    <li key={reason} className="font-mono text-caption text-error">{reason}</li>
                  ))}
                </ul>
                <p className="font-mono text-caption text-on-surface-variant mt-1.5">
                  只能「按规范调整」或切换类型；类型变形不提供豁免。
                </p>
              </section>
            )}

            {resolution && !deformation && (
              <section className="space-y-1">
                <p className="text-label text-on-surface-variant">裁决预览</p>
                {resolution.conflicts.length === 0 ? (
                  <p className="font-mono text-caption text-on-surface-variant">无冲突</p>
                ) : (
                  resolution.conflicts.map((conflict) => (
                    <div key={`${conflict.code}-${conflict.key}`} className="font-mono text-caption text-warning">
                      [{conflict.code}] {conflict.message}
                    </div>
                  ))
                )}
                {resolution.dropped_slots.length > 0 && (
                  <p className="font-mono text-caption text-on-surface-variant">
                    超预算丢弃槽位：{resolution.dropped_slots.join(', ')}
                  </p>
                )}
              </section>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <Button variant="outline" size="sm" onClick={runValidate}>校验</Button>
          <Button variant="outline" size="sm" onClick={runResolve}>裁决预览</Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存规范'}</Button>
        </div>
      </div>
    </div>
  );
}

export default TypeSpecEditor;
