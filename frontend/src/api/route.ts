import api from './index';

// 单程行程参数
export interface PlanRouteParams {
  origin: string;
  destination?: string;
  departureDate: string;
  endDate?: string; // 单程区间模式的结束日期
  maxTransfers?: number;
  minLayoverHours?: number;
  maxLayoverHours?: number;
  flightType?: '666权益卡航班' | '2666权益卡航班';
  /** 排序：score（默认）/ duration（总耗时最短）/ departure（出发最早） */
  sortBy?: 'score' | 'duration' | 'departure';
}

// 往返行程参数
export interface PlanRoundTripParams {
  origin: string;
  destination?: string;
  departureDate: string;
  departureDateEnd?: string;  // 去程日期范围结束
  returnDate: string;
  returnDateEnd?: string;     // 返程日期范围结束
  maxTransfers?: number;
  minLayoverHours?: number;
  maxLayoverHours?: number;
  autoDiscover?: boolean;
  flightType?: '666权益卡航班' | '2666权益卡航班';
  /** 排序：leave（默认，请假最少）/ stay（停留最久）/ departure（出发最早）/ duration（总耗时最短） */
  sortBy?: 'leave' | 'stay' | 'departure' | 'duration';
  /** 返回条数上限，默认 10 */
  limit?: number;
  /** 目的地最大停留天数，0/不传 = 不限 */
  maxStayDays?: number;
}

export interface FlightSegment {
  flightNo: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration: number;
}

export interface RouteResult {
  segments: FlightSegment[];
  totalDuration: number;
  transferCount: number;
  layovers: {
    city: string;
    duration: number;
  }[];
  score: number;
}

// 单程行程响应
export interface RoutePlanResponse {
  routes: RouteResult[];
  searchParams: {
    origin: string;
    destination?: string;
    departureDate: string;
    endDate?: string;
    maxTransfers: number;
  };
}

// 往返行程结果
export interface RoundTripResult {
  outbound: RouteResult;
  return: RouteResult;
  totalDuration: number;
  totalTransferCount: number;
  score: number;
  /** 在目的地停留时长（分钟）= 返程起飞 - 去程落地 */
  stayDuration: number;
  /** 需要请几天假（0 = 不占用工作日，周末/节假日走完） */
  leaveDays: number;
  departDate: string;
  returnDate: string;
  /** 是否无需请假 */
  noLeaveNeeded: boolean;
  /** 在目的地过几晚（0 = 当天往返） */
  nights: number;
  /** 0~100，越大越贴近"下班走、周末回" */
  weekendScore: number;
  /** 如「周五走 · 周日回」 */
  patternLabel: string;
}

// 往返行程响应
export interface RoundTripPlanResponse {
  routes: RoundTripResult[];
  searchParams: {
    origin: string;
    destination?: string;
    departureDate: string;
    returnDate: string;
    maxTransfers: number;
    autoDiscover: boolean;
  };
}

// 探索模式：找所有可往返目的地
export interface ExploreParams {
  origin: string;
  departureDate: string;
  departureDateEnd?: string;
  returnDate: string;
  returnDateEnd?: string;
  maxTransfers?: number;
  flightType?: '666权益卡航班' | '2666权益卡航班';
}

export interface ExploreDestination {
  city: string;
  bestOutbound: RouteResult;
  bestReturn: RouteResult;
  outboundCount: number;
  returnCount: number;
  score: number;
  /** 请假成本：0 = 周末/假期走完 */
  leaveDays: number;
  departDate: string;
  returnDate: string;
  noLeaveNeeded: boolean;
  /** 在目的地过几晚（0 = 当天往返） */
  nights: number;
  /** 0~100，越大越贴近"下班走、周末回" */
  weekendScore: number;
  /** 如「周五走 · 周日回」 */
  patternLabel: string;
}

export interface ExplorePlanResponse {
  destinations: ExploreDestination[];
  searchParams: {
    origin: string;
    departureDate: string;
    returnDate: string;
    maxTransfers: number;
  };
}

// 规划单程路线
export const planRoute = (params: PlanRouteParams): Promise<RoutePlanResponse> => {
  return api.post('/routes/plan', params);
};

// 规划往返行程（指定目的地）
export const planRoundTrip = (params: PlanRoundTripParams): Promise<RoundTripPlanResponse> => {
  return api.post('/routes/round-trip', params);
};

// 探索模式：发现所有可往返目的地（首次无缓存时耗时较长，timeout 延长至 120s）
export const exploreDestinations = (params: ExploreParams): Promise<ExplorePlanResponse> => {
  return api.post('/routes/explore', params, { timeout: 120000 });
};

// ─── 航线可飞日期窗口 ────────────────────────────────────────

export interface DirectionWindow {
  /** 该方向所有可飞日期（升序） */
  dates: string[];
  first: string | null;
  last: string | null;
}

export interface RouteDateWindow {
  origin: string;
  destination: string;
  /** 实际参与计算的搜索窗口 */
  window: { start: string | null; end: string | null };
  maxTransfers: number;
  outbound: DirectionWindow;
  return: DirectionWindow;
  /** 是否存在任一返程方案（直飞或中转） */
  hasReturn: boolean;
}

/**
 * 查询某条航线（含中转）真实可飞的日期窗口。
 * 规划页用它把去程/返程区间对齐到真实有航班的日期，
 * 避免"默认一个月区间但一条数据都没有"。
 */
export const getRouteDateWindow = (params: {
  origin: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  maxTransfers?: number;
  flightType?: '666权益卡航班' | '2666权益卡航班';
}): Promise<RouteDateWindow> => {
  return api.get('/routes/date-window', { params, timeout: 120000 });
};
