import { RouteResultDto } from './route-result.dto';

export class ExploreDestinationDto {
  city: string;
  /** 该目的地请假成本最低的一组去程/返程（同组内按评分最优） */
  bestOutbound: RouteResultDto;
  bestReturn: RouteResultDto;
  outboundCount: number;
  returnCount: number;
  score: number;

  // ── 请假成本 ──
  /** 需要请几天假（0 = 周末/假期走完） */
  leaveDays: number;
  departDate: string;
  returnDate: string;
  noLeaveNeeded: boolean;

  // ── 行程形态 ──
  /** 在目的地过几晚（0 = 当天往返） */
  nights: number;
  /** 0~100，越大越贴近"下班走、周末回" */
  weekendScore: number;
  /** 人类可读标签，如「周五走 · 周日回」 */
  patternLabel: string;
  /** 行程命中的法定节假日（如「中秋」「国庆节」），没有则为空 */
  holiday?: string;
}

export class ExplorePlanResponseDto {
  /** 本次返回的目的地（已按请假成本 → 周末契合度 → 评分排好序，只返回最优的前若干个） */
  destinations: ExploreDestinationDto[];
  /** 可往返目的地的总数（可能大于 destinations.length） */
  total: number;
  searchParams: {
    origin: string;
    departureDate: string;
    returnDate: string;
    maxTransfers: number;
  };
}
