import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsDateString, IsInt, IsIn, Min, Max } from 'class-validator';

/**
 * 查询某条航线（含中转）真实可飞日期窗口的入参。
 *
 * 用于规划页进入时把去程/返程日期区间自动对齐到真实有航班的日期，
 * 避免"默认一个月区间但一条数据都没有"的死局。
 */
export class RouteDateWindowDto {
  @IsString()
  @IsNotEmpty()
  origin: string;

  @IsString()
  @IsNotEmpty()
  destination: string;

  /** 搜索窗口开始日期，不传则用数据库内最早航班日期 */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** 搜索窗口结束日期，不传则用数据库内最晚航班日期 */
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2)
  maxTransfers?: number;

  @IsOptional()
  @IsString()
  @IsIn(['666权益卡航班', '2666权益卡航班'])
  flightType?: string;
}

export interface DirectionWindow {
  /** 该方向所有可飞日期（升序） */
  dates: string[];
  /** 最早可飞日期 */
  first: string | null;
  /** 最晚可飞日期 */
  last: string | null;
}

export interface RouteDateWindowResult {
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
