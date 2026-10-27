import { getApiClient } from './client';

/** 源类型（对应「模型提供商」页顶部 tab） */
export type ProviderKind = 'llm' | 'embedding' | 'rerank' | 'tts';

/** 角色（工程文件按角色分配：主/Flash/视觉 LLM、嵌入、重排序、语音） */
export type ProviderRole = 'main' | 'flash' | 'vision' | 'embed' | 'rerank' | 'tts';

/**
 * 逐模型生成参数（2026-10-28 PRD B4）。
 *
 * 语义：缺席 = 沿用调用方/默认值；显式数值 = 真实下发给该模型的每次请求
 * （含工具循环每一轮）。
 */
export interface ModelGeneration {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

/** 各参数的合法区间（与后端 `provider_sources.GENERATION_LIMITS` 一致）。 */
export const GENERATION_LIMITS: Record<keyof ModelGeneration, { min: number; max: number; int: boolean; label: string }> = {
  temperature: { min: 0, max: 2, int: false, label: 'temperature' },
  top_p: { min: 0, max: 1, int: false, label: 'top_p' },
  max_tokens: { min: 1, max: 200000, int: true, label: 'max_tokens' },
};

export interface GenerationValidation {
  /** 只含合法值（空串/未填 = 不提交该键） */
  value: ModelGeneration;
  /** 字段 → 可读错误（页面 inline 显示，不静默吞掉） */
  errors: Partial<Record<keyof ModelGeneration, string>>;
}

/** 校验用户在模型行填的生成参数；非法值不进 payload。 */
export function validateGeneration(raw: Partial<Record<keyof ModelGeneration, string | number | null | undefined>>): GenerationValidation {
  const value: ModelGeneration = {};
  const errors: GenerationValidation['errors'] = {};
  (Object.keys(GENERATION_LIMITS) as Array<keyof ModelGeneration>).forEach((key) => {
    const limits = GENERATION_LIMITS[key];
    const input = raw[key];
    if (input === undefined || input === null || input === '') return;
    const num = typeof input === 'number' ? input : Number(input);
    if (!Number.isFinite(num)) {
      errors[key] = `${limits.label} 必须是数字`;
      return;
    }
    if (num < limits.min || num > limits.max) {
      errors[key] = `${limits.label} 需在 ${limits.min}–${limits.max} 之间`;
      return;
    }
    value[key] = limits.int ? Math.round(num) : num;
  });
  return { value, errors };
}

/** 模型列表探测的状态与错误码（与后端 `providers/model_listing.py` 一致） */
export type ModelListingStatus = 'ok' | 'empty' | 'unsupported' | 'error';
export const LISTING_STATUSES: ModelListingStatus[] = ['ok', 'empty', 'unsupported', 'error'];
export type ModelListingErrorCode =
  | 'provider_unsupported'
  | 'http_error'
  | 'invalid_response'
  | 'credential_error'
  | 'timeout';
export const LISTING_ERROR_CODES: ModelListingErrorCode[] = [
  'provider_unsupported', 'http_error', 'invalid_response', 'credential_error', 'timeout',
];

export interface ProviderModel {
  id: string;
  name?: string;
  enabled?: boolean;
  generation?: ModelGeneration;
}

/** 源（脱敏形态：明文密钥绝不回传，只有掩码） */
export interface ProviderSource {
  id: string;
  name: string;
  kind: ProviderKind;
  provider: string;
  base_url?: string;
  timeout_sec?: number;
  proxy?: string;
  headers?: Record<string, string>;
  models?: ProviderModel[];
  /** 每条密钥的掩码（顺序与后端一致，编辑时回传掩码=保留旧值） */
  api_keys_masked?: string[];
  key_count?: number;
  has_keys?: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface RoleBinding {
  source_id: string;
  model: string;
}

export type RoleBindings = Partial<Record<ProviderRole, RoleBinding>>;

export interface AvailableProviders {
  llm_provider: string[];
  tts_provider: string[];
  embedding_provider: string[];
  rerank_provider: string[];
  role_kinds: Record<ProviderRole, ProviderKind>;
  tts_aliases: Record<string, string>;
}

export interface ProviderSourceInput {
  name: string;
  kind?: ProviderKind;
  provider?: string;
  base_url?: string;
  timeout_sec?: number;
  proxy?: string;
  headers?: Record<string, string>;
  api_keys?: string[];
  models?: ProviderModel[];
}

/** 源类型 → 门面 provider 列表键（下拉选项的唯一来源） */
export const KIND_PROVIDER_KEY: Record<ProviderKind, keyof AvailableProviders> = {
  llm: 'llm_provider',
  embedding: 'embedding_provider',
  rerank: 'rerank_provider',
  tts: 'tts_provider',
};

/** 源类型 → 该 tab 下可分配的角色 */
export const KIND_ROLES: Record<ProviderKind, ProviderRole[]> = {
  llm: ['main', 'flash', 'vision'],
  embedding: ['embed'],
  rerank: ['rerank'],
  tts: ['tts'],
};

export const ROLE_LABELS: Record<ProviderRole, string> = {
  main: '主 LLM',
  flash: 'Flash LLM',
  vision: '视觉 LLM',
  embed: '嵌入模型',
  rerank: '重排序模型',
  tts: '语音 TTS',
};

export function providersForKind(
  available: AvailableProviders | null,
  kind: ProviderKind,
): string[] {
  if (!available) return [];
  const key = KIND_PROVIDER_KEY[kind];
  const list = available[key];
  return Array.isArray(list) ? list : [];
}

export const providersApi = {
  /** 源列表（可按类型过滤）+ 角色绑定总览 */
  async list(kind?: ProviderKind): Promise<{ sources: ProviderSource[]; roles: RoleBindings }> {
    const { data } = await getApiClient().get('/api/providers', {
      params: kind ? { kind } : undefined,
    });
    return {
      sources: Array.isArray(data?.sources) ? data.sources : [],
      roles: (data?.roles ?? {}) as RoleBindings,
    };
  },

  /** 各类型可选 provider 名（门面驱动，含插件贡献） */
  async available(): Promise<AvailableProviders> {
    const { data } = await getApiClient().get('/api/providers/available');
    return {
      llm_provider: data?.llm_provider ?? [],
      tts_provider: data?.tts_provider ?? [],
      embedding_provider: data?.embedding_provider ?? [],
      rerank_provider: data?.rerank_provider ?? [],
      role_kinds: data?.role_kinds ?? ({} as Record<ProviderRole, ProviderKind>),
      tts_aliases: data?.tts_aliases ?? {},
    };
  },

  async create(payload: ProviderSourceInput): Promise<ProviderSource> {
    const { data } = await getApiClient().post('/api/providers', payload);
    return data;
  },

  async update(id: string, payload: Partial<ProviderSourceInput>): Promise<ProviderSource> {
    const { data } = await getApiClient().put(`/api/providers/${id}`, payload);
    return data;
  },

  async remove(id: string): Promise<void> {
    await getApiClient().delete(`/api/providers/${id}`);
  },

  /** 绑定/解绑角色（source_id 为空串 = 解绑） */
  async setRole(role: ProviderRole, sourceId: string, model = ''): Promise<unknown> {
    const { data } = await getApiClient().put('/api/providers/roles', {
      role, source_id: sourceId, model,
    });
    return data;
  },

  async setModels(id: string, models: ProviderModel[]): Promise<ProviderSource> {
    const { data } = await getApiClient().post(`/api/providers/${id}/models`, { models });
    return data;
  },

  async upsertModel(id: string, model: ProviderModel): Promise<ProviderSource> {
    const { data } = await getApiClient().post(`/api/providers/${id}/models/upsert`, model);
    return data;
  },

  async deleteModel(id: string, modelId: string): Promise<ProviderSource> {
    const { data } = await getApiClient().delete(
      `/api/providers/${id}/models/${encodeURIComponent(modelId)}`,
    );
    return data;
  },

  /**
   * 「获取模型列表」（2026-10-28 PRD B6）：返回状态机而不是一个裸数组。
   *
   * - `status='ok'` 时才覆盖已有模型；
   * - `empty`/`unsupported`/`error` 都带可读 `note`，前端保留旧清单并继续允许手动添加；
   * - `errorCode` 区分 `provider_unsupported / http_error / invalid_response /
   *   credential_error / timeout`（旧后端没有这些字段时回落为 `empty`/`error`）。
   */
  async fetchModels(id: string): Promise<{
    status: ModelListingStatus;
    models: ProviderModel[];
    note: string;
    errorCode?: ModelListingErrorCode;
  }> {
    const { data } = await getApiClient().post(`/api/providers/${id}/models/fetch`);
    const models = Array.isArray(data?.models) ? (data.models as ProviderModel[]) : [];
    const raw = typeof data?.status === 'string' ? data.status : '';
    const status: ModelListingStatus = LISTING_STATUSES.includes(raw as ModelListingStatus)
      ? (raw as ModelListingStatus)
      : (models.length ? 'ok' : 'empty');
    const code = typeof data?.error_code === 'string' ? data.error_code : '';
    return {
      status,
      models,
      note: typeof data?.note === 'string' ? data.note : '',
      errorCode: LISTING_ERROR_CODES.includes(code as ModelListingErrorCode)
        ? (code as ModelListingErrorCode)
        : undefined,
    };
  },

  /** B3：探测某个源（不改动角色绑定）。失败也返回 200，按 ok 展示。 */
  async testSource(id: string): Promise<{ ok: boolean; latencyMs?: number; detail: string }> {
    const { data } = await getApiClient().post(`/api/providers/${id}/test`);
    return {
      ok: Boolean(data?.ok),
      latencyMs: typeof data?.latency_ms === 'number' ? data.latency_ms : undefined,
      detail: typeof data?.detail === 'string' ? data.detail : '',
    };
  },
};

/** 表单 → 请求体：掩码条目原样回传（后端按「含 **** = 保留旧值」处理） */
export function buildSourcePayload(input: {
  name: string;
  kind: ProviderKind;
  provider: string;
  baseUrl: string;
  timeoutSec: string;
  proxy: string;
  headers: { key: string; value: string }[];
  keys: string[];
}): ProviderSourceInput {
  const headers: Record<string, string> = {};
  for (const h of input.headers) {
    const key = h.key.trim();
    if (key) headers[key] = h.value;
  }
  const payload: ProviderSourceInput = {
    name: input.name.trim(),
    kind: input.kind,
    provider: input.provider,
    base_url: input.baseUrl.trim(),
    proxy: input.proxy.trim(),
    headers,
    api_keys: input.keys.map((k) => k.trim()).filter(Boolean),
  };
  const t = Number(input.timeoutSec);
  if (input.timeoutSec.trim() && Number.isFinite(t) && t > 0) payload.timeout_sec = t;
  return payload;
}
