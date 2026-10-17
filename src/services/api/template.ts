import { getApiClient } from './client';

export interface Template {
  id: string;
  name: string;
  description: string;
  tags: string[];
  track_count: number;
  duration_sec: number;
  created_at: string;
  updated_at?: string;
}

export interface ApplyTemplateResult {
  status: string;
  template_id: string;
  timeline: Record<string, unknown>;
}

export const templateApi = {
  async list(): Promise<Template[]> {
    const { data } = await getApiClient().get('/api/template/list');
    return data;
  },

  async get(id: string): Promise<Template & { timeline?: Record<string, unknown> }> {
    const { data } = await getApiClient().get(`/api/template/${id}`);
    return data;
  },

  async create(template: Partial<Template> & { name: string }): Promise<Template> {
    const { data } = await getApiClient().post('/api/template/create', template);
    return data;
  },

  async update(id: string, template: Partial<Template>): Promise<Template> {
    const { data } = await getApiClient().put(`/api/template/${id}`, template);
    return data;
  },

  async remove(id: string): Promise<void> {
    await getApiClient().delete(`/api/template/${id}`);
  },

  async apply(id: string, targetProjectId?: string): Promise<ApplyTemplateResult> {
    // 待验证项证实并修复：旧实现提交空 body——后端 target_project_id 素材
    // 重映射通道（轮86）永不生效，跨项目应用时素材在渲染期静默降级色块。
    const { data } = await getApiClient().post<ApplyTemplateResult>(
      `/api/template/${id}/apply`,
      targetProjectId ? { target_project_id: targetProjectId } : {},
    );
    return data;
  },

  /** P8: 批量应用模板（批量选题生成）— 一次对多个选题生成时间线副本 */
  async batchApply(id: string, items: { topic: string; overrides?: Record<string, unknown> }[]): Promise<{
    status: string;
    template_id: string;
    results: { topic: string; timeline: Record<string, unknown> }[];
  }> {
    const { data } = await getApiClient().post(`/api/template/${id}/batch-apply`, { items });
    return data;
  },
};
