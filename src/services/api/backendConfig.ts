import { getApiClient } from './client';

/** 后端配置字段元数据（对应 GET /api/settings 的 fields[] 项） */
export interface BackendConfigField {
  key: string;
  group: string;
  label: string;
  description: string;
  kind: 'string' | 'int' | 'float' | 'bool' | 'enum' | 'list' | 'path';
  choices: string[];
  secret: boolean;
  hot: boolean;
  requires_restart: boolean;
  source: 'store' | 'env' | 'default';
  default: unknown;
  /** secret 字段恒为 null（绝不回显明文） */
  value: unknown;
  has_value: boolean;
  /** secret 有值时的掩码占位符 */
  masked?: string;
}

export interface BackendConfigGroup {
  id: string;
  label: string;
  fields: BackendConfigField[];
}

export interface BackendConfigResponse {
  groups: BackendConfigGroup[];
  has_encryption_key: boolean;
  note: string;
}

export interface SettingsUpdateResult {
  ok: boolean;
  applied: string[];
  cleared: string[];
  requires_restart: string[];
  warnings: string[];
}

export const backendConfigApi = {
  async get(): Promise<BackendConfigResponse> {
    const { data } = await getApiClient().get<BackendConfigResponse>('/api/settings');
    return data;
  },

  /** 部分更新：value 为 null/'' 表示清除该键的覆盖（回退 env/默认） */
  async update(values: Record<string, unknown>): Promise<SettingsUpdateResult> {
    const { data } = await getApiClient().put<SettingsUpdateResult>('/api/settings', { values });
    return data;
  },

  /** 清除 store 覆盖（keys 为空 = 全部） */
  async reset(keys: string[]): Promise<SettingsUpdateResult> {
    const { data } = await getApiClient().post<SettingsUpdateResult>('/api/settings/reset', { keys });
    return data;
  },
};
