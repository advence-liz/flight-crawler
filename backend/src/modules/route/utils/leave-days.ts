import { getDayDetail } from 'chinese-days';

/**
 * 请假成本（去程/返程日期组合要用几天年假）
 *
 * 目标：把"周五下班走、周日回，不请假"这类行程排到最前面，
 * 其次是"周五或周一请一天"的，最后才是需要请更多天的。
 *
 * 判定规则（与用户心智一致）：
 * - 起点日：18:00 及之后出发，视为下班后走，不计请假
 * - 终点日：08:00 之前落地，视为赶得上上班，不计请假
 * - 中间所有工作日都计请假
 * - 工作日判定交给 chinese-days：法定节假日不算，调休上班的周末算
 *
 * 时间口径：航班时间按北京墙钟时间入库（crawler 用本地时间字符串解析），
 * 所以这里统一用 UTC 的日期/小时读取，等价于"北京的几号几点"。
 */

/** 下班后出发的判定点（含） */
const EVENING_DEPARTURE_HOUR = 18;
/** 赶得上上班的落地判定点（不含） */
const MORNING_ARRIVAL_HOUR = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD -> 是否工作日（含法定节假日与调休判断） */
export function isWorkday(dateStr: string): boolean {
  try {
    const detail = getDayDetail(dateStr);
    if (detail && typeof detail.work === 'boolean') return detail.work;
  } catch {
    // 超出节假日数据覆盖年份，退回"周一~周五"
  }
  const d = new Date(`${dateStr}T00:00:00Z`);
  const w = d.getUTCDay();
  return w >= 1 && w <= 5;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 两个日期之间（含首尾）的所有 YYYY-MM-DD */
function eachDate(startStr: string, endStr: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${startStr}T00:00:00Z`).getTime();
  const end = new Date(`${endStr}T00:00:00Z`).getTime();
  // 上限兜底，避免异常数据导致死循环
  for (let i = 0; i < 120 && cur <= end; i++) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += DAY_MS;
  }
  return out;
}

export interface LeaveInfo {
  /** 需要请几天假 */
  leaveDays: number;
  /** 出发日（YYYY-MM-DD） */
  departDate: string;
  /** 返回落地日（YYYY-MM-DD） */
  returnDate: string;
  /** 出发日是否属于"下班后走"（不计假） */
  eveningDeparture: boolean;
  /** 落地日是否"赶得上上班"（不计假） */
  earlyArrival: boolean;
  /** 行程是否完整落在周末/假期内（不用请假） */
  noLeaveNeeded: boolean;
}

/**
 * 根据整段行程的首段起飞时间和末段落地时间，计算请假成本。
 */
export function calcLeaveDays(departureTime: Date, arrivalTime: Date): LeaveInfo {
  const departDate = toDateStr(departureTime);
  const returnDate = toDateStr(arrivalTime);
  const depHour = departureTime.getUTCHours();
  const arrHour = arrivalTime.getUTCHours();

  const eveningDeparture = depHour >= EVENING_DEPARTURE_HOUR;
  const earlyArrival = arrHour < MORNING_ARRIVAL_HOUR;

  let leaveDays = 0;
  for (const date of eachDate(departDate, returnDate)) {
    if (!isWorkday(date)) continue;
    if (date === departDate && eveningDeparture) continue;
    if (date === returnDate && earlyArrival) continue;
    leaveDays++;
  }

  return {
    leaveDays,
    departDate,
    returnDate,
    eveningDeparture,
    earlyArrival,
    noLeaveNeeded: leaveDays === 0,
  };
}
