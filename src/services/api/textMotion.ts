import { getApiClient } from './client';
import { connectSseStream, type SseStreamHandle } from './sseStream';
import type { MotionSpec, MotionValidationError } from '@/features/textMotion/types';

export interface TextMotionCapabilities {
  schema_version?: string;
  compiler_version?: string;
  capability_version?: string;
  motions?: Array<Record<string, unknown>>;
  fields?: Record<string, unknown>;
  primitives?: string[];
}

export interface StylePackSummary {
  id: string;
  name: string;
  style: Record<string, unknown>;
}

export interface AssetPackSummary {
  id: string;
  name: string;
  assets: Array<Record<string, unknown>>;
}

export interface ValidateSpecRequest {
  clip_id: string;
  base_revision?: string;
  base_hash: string;
  schema_version: string;
  capability_version: string;
  draft_spec: MotionSpec;
}

export interface ValidateSpecResponse {
  ok: boolean;
  errors: MotionValidationError[];
  warnings: MotionValidationError[];
  capability_version?: string;
}

export interface CompileSpecResponse {
  spec_hash: string;
  compiler_version: string;
  mg_def: Record<string, unknown>;
  preview_ops: Array<Record<string, unknown>>;
  fidelity: 'exact' | 'approx' | 'unsupported';
  errors?: MotionValidationError[];
}

export interface CommitSpecRequest {
  project_id: string;
  clip_id: string;
  base_hash: string;
  spec: MotionSpec;
  spec_hash?: string;
  compiler_version?: string;
  fidelity?: string;
}

export interface CommitSpecResponse {
  ok: boolean;
  spec_hash: string;
  revision?: string;
}

export interface AuthorStartRequest {
  clip_id: string;
  project_id?: string;
  text?: string;
  duration_sec?: number;
  style?: Record<string, unknown>;
  idempotency_key?: string;
}

export interface AuthorTaskResponse {
  task_id: string;
  clip_id: string;
  revision?: string;
  status: string;
}

export interface AuthorTaskStatus {
  task_id: string;
  status: string;
  seq?: number;
  progress?: number;
  error?: string;
  cancelable?: boolean;
  spec?: Record<string, unknown>;
  spec_hash?: string;
}

/**
 * 这些路由由后端 PRD 定义为待新增；在真实实现/联调前不得在 UI 中调用。
 * 本模块只冻结请求/响应类型，避免组件继续裸写不存在的 endpoint。
 */
export const textMotionApi = {
  capabilities: async () => {
    const { data } = await getApiClient().get<TextMotionCapabilities>(
      '/api/text-animation/capabilities');
    return data;
  },
  stylePacks: async () => {
    const { data } = await getApiClient().get<{ style_packs: StylePackSummary[] }>(
      '/api/text-animation/style-packs');
    return data.style_packs ?? [];
  },
  assetPacks: async () => {
    const { data } = await getApiClient().get<{ asset_packs: AssetPackSummary[] }>(
      '/api/text-animation/asset-packs');
    return data.asset_packs ?? [];
  },
  validateSpec: async (payload: ValidateSpecRequest) => {
    const { data } = await getApiClient().post<ValidateSpecResponse>(
      '/api/text-animation/validate-spec', payload);
    return data;
  },
  compile: async (payload: ValidateSpecRequest) => {
    const { data } = await getApiClient().post<CompileSpecResponse>(
      '/api/text-animation/compile', payload);
    return data;
  },
  startAuthor: async (payload: AuthorStartRequest) => {
    const { data } = await getApiClient().post<AuthorTaskResponse>(
      '/api/text-animation/author', payload);
    return data;
  },
  getAuthorTask: async (taskId: string) => {
    const { data } = await getApiClient().get<AuthorTaskStatus>(
      `/api/text-animation/author/${encodeURIComponent(taskId)}`);
    return data;
  },
  cancelAuthor: async (taskId: string) => {
    const { data } = await getApiClient().post<AuthorTaskStatus>(
      `/api/text-animation/author/${encodeURIComponent(taskId)}/cancel`);
    return data;
  },
  commit: async (payload: CommitSpecRequest) => {
    const { data } = await getApiClient().post<CommitSpecResponse>(
      '/api/text-animation/commit', payload);
    return data;
  },
  /**
   * author SSE 状态流。终态后由服务端关闭；重连由共享工具负责。
   * 注意：现有 sseStream 以事件消息为健康信号，不携带 last-event-id。
   */
  watchAuthor: (
    taskId: string,
    onStatus: (status: AuthorTaskStatus) => void,
    onRetry?: (attempt: number) => void,
    onGiveUp?: () => void,
  ): SseStreamHandle => connectSseStream({
    url: `/api/text-animation/author/${encodeURIComponent(taskId)}/events`,
    onMessage: (data) => {
      if (data && typeof data === 'object') onStatus(data as AuthorTaskStatus);
    },
    onRetry,
    onGiveUp,
  }),
};
