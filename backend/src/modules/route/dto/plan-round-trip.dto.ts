import { IsString, IsDateString, IsOptional, IsInt, Min, Max, IsBoolean, IsIn, IsNotEmpty } from 'class-validator';

/**
 * 往返行程规划 DTO
 */
export class PlanRoundTripDto {
  @IsString()
  @IsNotEmpty()
  origin: string;

  @IsString()
  @IsIn(['666权益卡航班', '2666权益卡航班'])
  @IsOptional()
  flightType?: string; // 不传则显示全部（2666 含全部）

  @IsString()
  @IsOptional()
  destination?: string; // 不填则自动发现所有往返方案

  @IsDateString()
  departureDate: string; // 出发日期（范围开始）

  @IsDateString()
  @IsOptional()
  departureDateEnd?: string; // 出发日期范围结束（不填则等于 departureDate）

  @IsDateString()
  returnDate: string; // 返程日期（范围开始，必填）

  @IsDateString()
  @IsOptional()
  returnDateEnd?: string; // 返程日期范围结束（不填则等于 returnDate）

  @IsInt()
  @Min(0)
  @Max(3)
  @IsOptional()
  maxTransfers?: number = 0; // 往返默认只考虑直飞（避免组合爆炸）

  @IsInt()
  @Min(1)
  @Max(24)
  @IsOptional()
  minLayoverHours?: number = 2;

  @IsInt()
  @Min(1)
  @Max(48)
  @IsOptional()
  maxLayoverHours?: number = 24;

  @IsBoolean()
  @IsOptional()
  autoDiscover?: boolean = false; // 是否自动发现所有往返方案

  /**
   * 排序方式：
   * - leave（默认）请假最少优先，其次综合评分
   * - stay    在目的地停留最久优先（想看长行程/年假行程时用）
   * - departure 出发最早优先
   * - duration  总耗时最短优先
   */
  @IsString()
  @IsIn(['leave', 'stay', 'departure', 'duration'])
  @IsOptional()
  sortBy?: string = 'leave';

  /**
   * 目的地的最大停留天数（默认由前端传 14）。
   * 0 或不传 = 不限；用于避免"停留最久"排序把两个月的行程顶到第一。
   */
  @IsInt()
  @Min(0)
  @Max(90)
  @IsOptional()
  maxStayDays?: number;

  /** 返回条数上限（默认 10） */
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number = 10;
}
