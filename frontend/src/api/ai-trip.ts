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

export const getAiTripStatus = () => api.get<unknown, { enabled: boolean }>('/routes/ai-trip/status');
export const interpretAiTrip = (text: string) => api.post<unknown, AiTripIntent>('/routes/ai-trip/interpret', { text });
export const searchAiTrip = (intent: AiTripIntent) => api.post<unknown, AiTripResults>('/routes/ai-trip/search', intent);
