import api from './index';
import type { ExploreDestination } from './route';

export interface AiTripIntent {
  origin: string | null;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  card: '666' | '2666' | null;
  maxTransfers: 0 | 1;
  maxLeaveDays: number | null;
  minStayHours: number | null;
  maxStayHours: number | null;
  departureWeekday: number | null;
  arrivalWeekday: number | null;
  departAfter: string | null;
  arriveBefore: string | null;
  unresolved: string[];
}

interface AiDestination extends ExploreDestination {
  stayMinutes: number;
  travelMinutes: number;
  reason: string;
}

export interface AiTripResults {
  coverage: 'none' | 'partial' | 'full';
  range: { minDate: string | null; maxDate: string | null };
  crawledAt: string | null;
  destinations: AiDestination[];
}

export type TripChatMessage = { role: 'user' | 'assistant'; content: string };
export type TripSearchCriteria = AiTripIntent & { excludeDestinations?: string[] | null; returnDepartAfter?: string | null };
export interface TripAgentReply {
  text: string;
  results?: AiTripResults;
  criteria?: TripSearchCriteria;
}

export const getAiTripStatus = () => api.get<unknown, { chatEnabled?: boolean }>('/routes/ai-trip/status');
export const chatWithTripAgent = (messages: TripChatMessage[], previous?: TripSearchCriteria) =>
  api.post<unknown, TripAgentReply>('/routes/ai-trip/chat', { messages, previous }, { timeout: 55_000 });
