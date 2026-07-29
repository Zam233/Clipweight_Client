import { getApiClient } from './client';

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  created_at: string;
  last_delivery_at?: string;
}

export const webhookApi = {
  async listEvents(): Promise<{ events: string[] }> {
    const { data } = await getApiClient().get('/api/webhook/events');
    return data;
  },

  async list(): Promise<WebhookSubscription[]> {
    const { data } = await getApiClient().get('/api/webhook/list');
    return data;
  },

  async register(sub: { url: string; events: string[]; secret?: string }): Promise<WebhookSubscription> {
    const { data } = await getApiClient().post('/api/webhook/register', sub);
    return data;
  },

  async remove(id: string): Promise<void> {
    await getApiClient().delete(`/api/webhook/${id}`);
  },

  async toggle(id: string): Promise<WebhookSubscription> {
    const { data } = await getApiClient().put(`/api/webhook/${id}/toggle`);
    return data;
  },

  async test(id: string): Promise<{ success: boolean; status_code?: number; body?: string }> {
    const { data } = await getApiClient().post(`/api/webhook/${id}/test`);
    return data;
  },
};
