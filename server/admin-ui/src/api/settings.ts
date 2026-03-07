import { apiClient } from './client';

export interface SettingsResponse {
  registration_code_masked: string;
  registration_code_preview: string;
}

export async function getSettings(): Promise<SettingsResponse> {
  const resp = await apiClient.get('/admin/settings');
  return resp.data;
}

export async function updateSettings(registration_code: string): Promise<{ message: string; masked: string }> {
  const resp = await apiClient.put('/admin/settings', { registration_code });
  return resp.data;
}
