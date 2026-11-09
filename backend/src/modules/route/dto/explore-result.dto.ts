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
}

export class ExplorePlanResponseDto {
  destinations: ExploreDestinationDto[];
  searchParams: {
    origin: string;
    departureDate: string;
    returnDate: string;
    maxTransfers: number;
  };
}
