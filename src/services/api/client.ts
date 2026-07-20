import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { useSettingsStore } from '@/stores/settingsStore';

let client: AxiosInstance | null = null;

export function getApiClient(): AxiosInstance {
  if (!client) {
    const baseURL = useSettingsStore.getState().apiBaseUrl || 'http://localhost:8000';
    client = axios.create({
      baseURL,
      timeout: 300_000, // 5 min for long operations
      headers: { 'Content-Type': 'application/json' },
    });

    // Request interceptor: attach auth token
    client.interceptors.request.use((config) => {
      const token = useSettingsStore.getState().authToken;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Response interceptor: handle common errors
    client.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) {
          // TODO: redirect to login
        }
        if (err.response?.status === 503) {
          console.warn('[API] Service busy, retry later');
        }
        return Promise.reject(err);
      },
    );
  }
  return client;
}

/** Reset client (e.g., when API base URL changes) */
export function resetApiClient() {
  client = null;
}
