import { getApiClient } from './client';

export interface ShotParams {
  min_shot_sec: number;
  max_shot_sec: number;
  transition_type: string;
  transition_duration_sec: number;
  cut_on_beat: boolean;
}

export interface PersonaMappingItem {
  source: string;
  transform: string;
  scale_factor: number;
}

/** 提示词槽位（键固定 10 个：身份层 3 + 阶段层 7）。 */
export interface PromptSlot {
  text: string;
  priority?: number;
  max_chars?: number;
}

/** 机器可读参数规则：strict 覆盖用户值，soft 只记录。 */
export interface ParamRule {
  key: string;
  mode: 'floor' | 'ceiling' | 'exact' | 'forbid' | 'require';
  value: number | string | boolean;
  reason: string;
  enforce: 'strict' | 'soft';
}

/** 同一性的可测代理指标。 */
export interface SignatureTrait {
  name: string;
  mode: 'require_ge' | 'require_le' | 'require_between';
  value: number;
  value_max?: number;
  enforce: 'strict' | 'soft';
  reason: string;
}

export interface PlanSchema {
  required: string[];
  optional: string[];
  custom_allowed: boolean;
}

export interface TypeDeclares {
  required_animation_markers?: string[];
  outro_animation?: boolean;
  opening_animation?: boolean;
  semantic_qa_default?: boolean;
  search_hint?: string;
  neighbors?: string[];
  requires?: string[];
  plan_schema?: PlanSchema;
}

export interface TypeDefinition {
  id: string;
  name: string;
  description: string;
  shot_params: ShotParams;
  persona_mapping: Record<string, PersonaMappingItem>;
  post_process?: Record<string, unknown>;
  tags?: string[];
  /** 类型规范（PRD Part I F1/F3/F14） */
  prompts?: Record<string, PromptSlot>;
  param_rules?: ParamRule[];
  signature_traits?: SignatureTrait[];
  declares?: TypeDeclares;
  waivers?: string[];
}

/** 槽位键（与后端 SLOT_KEYS 一致；`global` 是 `genre` 的别名）。 */
export const IDENTITY_SLOTS = ['genre', 'anti_patterns', 'lexicon'] as const;
export const STAGE_SLOTS = [
  'structure',
  'material',
  'edit',
  'animation',
  'audio',
  'subtitle',
  'quality',
] as const;
export const SLOT_LABELS: Record<string, string> = {
  genre: '类型同一性（必填）',
  anti_patterns: '本类型不是什么',
  lexicon: '术语口径',
  structure: '结构',
  material: '选片',
  edit: '剪辑',
  animation: '动画',
  audio: '音频',
  subtitle: '字幕',
  quality: '质检',
};

export interface TypeListItem {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  tags: string[];
}

export interface TypePreviewResult {
  valid: boolean;
  errors: string[];
  shot_params: ShotParams;
  sample_translation: Record<string, unknown>;
}

export interface TypeMutationResult {
  status: string;
  id: string;
  file?: string;
}

export interface SpecIssue {
  code: string;
  message: string;
  where?: string;
}

export interface ValidateResult {
  ok: boolean;
  errors: SpecIssue[];
  warnings: SpecIssue[];
}

export interface ParamTrace {
  source_layer?: string;
  source_id?: string;
  overridden_by?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface ParamConflict {
  code: string;
  key: string;
  message: string;
  winner_layer?: string;
  user_value?: unknown;
  rule_value?: unknown;
  enforce?: 'strict' | 'soft';
  reason?: string;
}

export interface TraitPreview {
  name: string;
  mode: string;
  threshold: number;
  feasible?: boolean | null;
  note?: string;
}

export interface Deformation {
  code: string;
  reasons: string[];
  suggested_type?: string | null;
  note?: string;
}

export interface ResolveResult {
  params: Record<string, unknown>;
  trace: Record<string, ParamTrace>;
  conflicts: ParamConflict[];
  traits: TraitPreview[];
  deformation: Deformation | null;
  prompts: Record<string, string>;
  dropped_slots: string[];
}

export interface TraitJudgement {
  name: string;
  mode: string;
  threshold: number;
  value: number;
  passed: boolean;
  enforce: string;
  reason?: string;
}

export interface GenreCheckResult {
  type_id: string;
  traits_declared: number;
  measured: Record<string, number>;
  ok: boolean;
  judge: string;
  judge_detail: Record<string, unknown>;
  summary: string;
  traits: TraitJudgement[];
  mismatches: string[];
  warnings: string[];
}

export const typeMakerApi = {
  async list(): Promise<TypeListItem[]> {
    const { data } = await getApiClient().get<TypeListItem[]>('/api/type-maker/list');
    return data;
  },

  async get(id: string): Promise<TypeDefinition> {
    const { data } = await getApiClient().get(`/api/type-maker/${id}`);
    return data as TypeDefinition;
  },

  async create(definition: Partial<TypeDefinition> & { name: string }): Promise<TypeMutationResult> {
    const { data } = await getApiClient().post<TypeMutationResult>('/api/type-maker/create', definition);
    return data;
  },

  async update(id: string, definition: Partial<TypeDefinition>): Promise<TypeMutationResult> {
    const { data } = await getApiClient().put<TypeMutationResult>(`/api/type-maker/${id}`, definition);
    return data;
  },

  async remove(id: string): Promise<void> {
    await getApiClient().delete(`/api/type-maker/${id}`);
  },

  async preview(definition: TypeDefinition): Promise<TypePreviewResult> {
    const { data } = await getApiClient().post<TypePreviewResult>('/api/type-maker/preview', definition);
    return data;
  },

  /** 干跑规范校验（悬空数字 / 规则自洽 / 指标矛盾 / 槽位合法）。 */
  async validate(definition: Partial<TypeDefinition>): Promise<ValidateResult> {
    const { data } = await getApiClient().post<ValidateResult>('/api/type-maker/validate', definition);
    return data;
  },

  /** 干跑裁决：最终参数 + 冲突 + 变形判定（保存前预览用）。 */
  async resolve(definition: Partial<TypeDefinition> & { user_params?: Record<string, unknown> }): Promise<ResolveResult> {
    const { data } = await getApiClient().post<ResolveResult>('/api/type-maker/resolve', definition);
    return data;
  },

  /** 类型同一性校验：给时间线，返回指标与逐条判定。 */
  async genreCheck(
    typeId: string,
    payload: { timeline: unknown; bpm?: number; beat_zero_sec?: number; enable_genre_judge?: boolean },
  ): Promise<GenreCheckResult> {
    const { data } = await getApiClient().post<GenreCheckResult>(
      `/api/type-maker/${typeId}/genre-check`,
      payload,
    );
    return data;
  },
};
