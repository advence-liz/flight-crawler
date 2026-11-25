import { adminApi as api } from './index';

export interface McpUser {
  id: string;
  name: string;
  active: boolean;
  hasToken: boolean;
  todayCalls: number;
  email: string | null;
}

const base = '/admin/mcp-users';
export const listMcpUsers = (page: number) => api.get<unknown, { users: McpUser[]; hasMore: boolean }>(base, { params: { page } });
export const createMcpUser = (name: string, email?: string) => api.post<unknown, { id: string }>(base, { name, email });
export const setMcpUserActive = (id: string, active: boolean) => api.patch(`${base}/${id}`, { active });
export const issueMcpToken = (id: string) => api.post<unknown, { token: string }>(`${base}/${id}/token`);
export const revokeMcpToken = (id: string) => api.delete(`${base}/${id}/token`);
