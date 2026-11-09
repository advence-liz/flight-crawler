/**
 * 行程「像不像人安排的」评分。
 *
 * 只按请假天数排序会选出「周六早上出发、周六晚上回来」这种当天往返：
 * 它请假 0 天、总耗时最短，综合评分最高，于是排在第一——但那根本不是一趟旅行。
 *
 * 所以把常识固化成可排序的分数（分数越高越符合人的习惯）：
 *   出发点：周五下班后走 > 周六上午走 > 周五白天 > 周六下午 > 工作日晚走 > 其他
 *   返回点：周日回 > 周一早班机 > 周六回 > 其他
 *   过夜数：2 晚最优，1 晚次之，0 晚（当天往返）不给分
 *
 * 时间口径与 leave-days 一致：航班时间按北京墙钟时间入库，
 * 这里统一用 UTC 读取，等价于「北京的几号几点」。
 */

/** 下班后出发的判定点（含） */
const EVENING_DEPARTURE_HOUR = 18;
/** 周六上午出发的判定点（不含） */
const MORNING_DEPARTURE_HOUR = 12;
/** 赶得上上班的落地判定点（不含） */
const EARLY_ARRIVAL_HOUR = 8;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface TripPattern {
  /** 在目的地过几晚（返程起飞日 - 去程落地日） */
  nights: number;
  /** 0~100，越大越符合"下班走/周末回"的人类习惯 */
  weekendScore: number;
  /** 人类可读的标签，如「周五晚走 · 周日回」 */
  label: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekdayOf(d: Date): number {
  return d.getUTCDay();
}

/** 出发日打分：越"不用上班的时间段出发"越高 */
function scoreDeparture(departureTime: Date): number {
  const w = weekdayOf(departureTime);
  const hour = departureTime.getUTCHours();
  const evening = hour >= EVENING_DEPARTURE_HOUR;
  const morning = hour < MORNING_DEPARTURE_HOUR;

  if (w === 5) return evening ? 45 : 30; // 周五：下班走 / 白天走
  if (w === 6) return morning ? 42 : 28; // 周六：上午走 / 下午走
  if (w === 4) return evening ? 24 : 8; // 周四：下班走（请周五一天）
  if (w === 0) return 18; // 周日出发也算周末
  return evening ? 22 : 8; // 工作日晚走 / 工作日白天
}

/** 返回日打分：周末回 > 周一早班机 > 其他 */
function scoreReturn(arrivalTime: Date): number {
  const w = weekdayOf(arrivalTime);
  const hour = arrivalTime.getUTCHours();

  if (w === 0) return 40; // 周日回
  if (w === 1 && hour < EARLY_ARRIVAL_HOUR) return 30; // 周一早班机落地，赶得上上班
  if (w === 6) return 25; // 周六回
  if (w === 5) return 20; // 周五回（请周五一整天）
  return 10;
}

/** 过夜数打分：2 晚最优，1 晚次之，当天往返不给分 */
function scoreNights(nights: number): number {
  if (nights <= 0) return 0;
  if (nights === 1) return 10;
  return 15;
}

/**
 * 评估一趟往返行程的"人类友好度"。
 *
 * @param departureTime       去程首段起飞时间
 * @param returnDepartureTime 返程首段起飞时间（用来算过夜数）
 * @param finalArrivalTime    返程末段落地时间
 */
export function evaluateTripPattern(
  departureTime: Date,
  returnDepartureTime: Date,
  finalArrivalTime: Date,
): TripPattern {
  const departDate = toDateStr(departureTime);
  const returnDepartDate = toDateStr(returnDepartureTime);
  const nights = Math.max(
    0,
    Math.round(
      (new Date(`${returnDepartDate}T00:00:00Z`).getTime() -
        new Date(`${departDate}T00:00:00Z`).getTime()) /
        DAY_MS,
    ),
  );

  const weekendScore = Math.min(
    100,
    scoreDeparture(departureTime) + scoreReturn(finalArrivalTime) + scoreNights(nights),
  );

  return {
    nights,
    weekendScore,
    label: `${WEEKDAY_NAMES[weekdayOf(departureTime)]}走 · ${WEEKDAY_NAMES[weekdayOf(finalArrivalTime)]}回`,
  };
}
