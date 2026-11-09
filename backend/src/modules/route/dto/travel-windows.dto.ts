import { IsDateString } from 'class-validator';

export class TravelWindowsDto {
  /** 查询区间开始日期 YYYY-MM-DD */
  @IsDateString()
  startDate: string;

  /** 查询区间结束日期 YYYY-MM-DD */
  @IsDateString()
  endDate: string;
}
