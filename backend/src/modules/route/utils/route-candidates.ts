import { RouteResultDto } from '../dto/route-result.dto';

/**
 * 往返组合的候选选择。
 *
 * 关键点：请假成本取决于「去程是不是下班后出发」「返程是不是早上落地」，
 * 而综合评分（时长 + 中转）完全不感知这两个维度。如果只按评分取每天前 N，
 * 晚班/早班会在进候选池之前就被淘汰，后面排序再准也救不回来。
 * 所以按「出发日 + 请假相关维度」分桶，每桶各取若干条。
 */

/** 下班后出发的判定点（含） */
export const EVENING_DEPARTURE_HOUR = 18;
/** 上午的判定点（不含） */
export const MORNING_HOUR = 12;
/** 赶得上上班的落地判定点（不含） */
export const MORNING_ARRIVAL_HOUR = 8;

/**
 * 按起飞时刻分早/午/晚三段。
 *
 * 只用「18 点前/后」两段不够用：同一个周日下午，07:30 和 21:25 的返程都会落进
 * 同一个桶，桶内按评分（时长越短越好）取前 2 时，晚上的航班会被白天的挤掉，
 * 于是「周日晚回」这种更舒服的走法根本进不了候选池。
 */
function departurePeriod(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < MORNING_HOUR) return 'morning';
  if (hour >= EVENING_DEPARTURE_HOUR) return 'evening';
  return 'afternoon';
}

/** 去程分桶：按首段起飞时段 */
export function outboundBucket(route: RouteResultDto): string {
  const first = route.segments[0];
  const hour = first ? new Date(first.departureTime).getUTCHours() : 12;
  return departurePeriod(hour);
}

/**
 * 返程分桶：早上落地（赶得上上班）单独一桶，其余按起飞时段分。
 * 早到和晚走是两件不同的事，都要在候选池里留位置。
 */
export function returnBucket(route: RouteResultDto): string {
  const last = route.segments[route.segments.length - 1];
  const first = route.segments[0];
  const arrivalHour = last ? new Date(last.arrivalTime).getUTCHours() : 12;
  if (arrivalHour < MORNING_ARRIVAL_HOUR) return 'early-arrival';
  const departHour = first ? new Date(first.departureTime).getUTCHours() : 12;
  return departurePeriod(departHour);
}

/**
 * 按「首段出发日 + 分桶」分组，每组取评分最高的前 perDate 条。
 */
export function pickCandidatesPerDate(
  routes: RouteResultDto[],
  perDate: number,
  bucketOf: (route: RouteResultDto) => string,
): RouteResultDto[] {
  const byKey = new Map<string, RouteResultDto[]>();
  for (const route of routes) {
    const first = route.segments[0];
    if (!first) continue;
    const date = new Date(first.departureTime).toISOString().slice(0, 10);
    const key = `${date}|${bucketOf(route)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(route);
  }
  const picked: RouteResultDto[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => b.score - a.score);
    picked.push(...list.slice(0, perDate));
  }
  return picked;
}

/**
 * 结果精简：同一对「去程日 + 返程日」只保留排名最高的那一条。
 *
 * 排序按请假/周末契合度排完后，前 N 名常常是「同一批周末 × 不同的航班组合」——
 * 对用户来说这不算更多选择，只是同一趟行程换个航班号。与其堆数量，
 * 不如每个周末只给最优的那一条，让列表里的每张卡都是不同的出行时间。
 */
export function keepBestPerDatePair<T extends { departDate: string; returnDate: string }>(
  routes: T[],
  limit: number,
): T[] {
  const seen = new Set<string>();
  const picked: T[] = [];
  for (const route of routes) {
    const key = `${route.departDate}|${route.returnDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(route);
    if (picked.length >= limit) break;
  }
  return picked;
}
