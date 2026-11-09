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
/** 赶得上上班的落地判定点（不含） */
export const MORNING_ARRIVAL_HOUR = 8;

/** 去程分桶：是否下班后出发 */
export function outboundBucket(route: RouteResultDto): string {
  const first = route.segments[0];
  const hour = first ? new Date(first.departureTime).getUTCHours() : 12;
  return hour >= EVENING_DEPARTURE_HOUR ? 'evening' : 'day';
}

/** 返程分桶：是否早上落地（赶得上上班） */
export function returnBucket(route: RouteResultDto): string {
  const last = route.segments[route.segments.length - 1];
  const hour = last ? new Date(last.arrivalTime).getUTCHours() : 12;
  return hour < MORNING_ARRIVAL_HOUR ? 'early' : 'late';
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
