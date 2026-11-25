import type { TripAgentReply, TripChatMessage, TripSearchCriteria } from './ai-trip';

export type LoginOptions = { email: boolean; github: boolean; google: boolean };
export type SiteAccount = { name: string; email: string; hasToken: boolean; mcpEnabled: boolean };
export const MCP_ENDPOINT = 'https://flight-crawler.onrender.com/api/mcp';
export class SiteRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

// Account authentication is same-origin so browsers accept the HttpOnly session cookie.
async function request<T>(path: string, method = 'GET', data?: object, timeout = 15_000): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', cache: 'no-store',
    signal: AbortSignal.timeout(timeout), ...(data !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new SiteRequestError(response.status, typeof result.message === 'string' ? result.message : '请求失败');
  return result as T;
}
export const getLoginOptions = () => request<LoginOptions>('/account/status');
export const getSiteAccount = () => request<SiteAccount>('/account');
export const sendEmailCode = (email: string) => request('/auth/email-otp/send-verification-otp', 'POST', { email, type: 'sign-in' });
export const enterEmailCode = (email: string, otp: string) => request('/auth/sign-in/email-otp', 'POST', { email, otp });
export const beginSocialLogin = (provider: 'github' | 'google') => {
  const home = location.origin + location.pathname;
  return request<{ url: string }>('/auth/sign-in/social', 'POST', { provider, callbackURL: `${home}#/account`, errorCallbackURL: `${home}?login=error#/account` });
};
export const signOutSite = () => request('/auth/sign-out', 'POST', {});
export const issueOwnMcpToken = () => request<{ token: string }>('/account/mcp/token', 'POST', {});
export const revokeOwnMcpToken = () => request<void>('/account/mcp/token', 'DELETE');
export const chatAsSiteUser = (messages: TripChatMessage[], previous?: TripSearchCriteria) =>
  request<TripAgentReply>('/routes/ai-trip/chat', 'POST', { messages, previous }, 55_000);
