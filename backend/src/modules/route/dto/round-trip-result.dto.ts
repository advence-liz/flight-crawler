import { FlightSegmentDto } from './route-result.dto';

/**
 * 往返行程结果 DTO
 */
export class RoundTripResultDto {
  // 去程信息
  outbound: {
    segments: FlightSegmentDto[];
    totalDuration: number;
    transferCount: number;
    layovers: {
      city: string;
      duration: number;
    }[];
  };

  // 返程信息
  return: {
    segments: FlightSegmentDto[];
    totalDuration: number;
    transferCount: number;
    layovers: {
      city: string;
      duration: number;
    }[];
  };

  // 往返总计
  totalDuration: number;
  totalTransferCount: number;
  score: number; // 综合评分
  /** 在目的地的停留时长（分钟）= 返程起飞 - 去程落地 */
  stayDuration: number;

  // ── 请假成本（用于把周末/节假日友好行程排到前面）──
  /** 需要请几天假（0 = 完全不占用工作日） */
  leaveDays: number;
  /** 出发日 YYYY-MM-DD */
  departDate: string;
  /** 返程落地日 YYYY-MM-DD */
  returnDate: string;
  /** 是否无需请假（完整落在周末或法定节假日里） */
  noLeaveNeeded: boolean;
}

/**
 * 往返行程规划响应 DTO
 */
export class RoundTripPlanResponseDto {
  routes: RoundTripResultDto[];
  searchParams: {
    origin: string;
    destination?: string;
    departureDate: string;
    returnDate: string;
    maxTransfers: number;
    autoDiscover: boolean;
  };
}
