import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * 航班时刻格式化。
 *
 * 背景：crawler 在 UTC 环境里用 `new Date('YYYY-MM-DD HH:mm')` 解析页面上的
 * 北京时间，所以库里存的是"北京墙钟时间当成 UTC"。API 序列化后形如
 * `2026-11-13T19:00:00.000Z`。
 *
 * 如果按浏览器本地时区展示，+8 的浏览器会显示成次日 03:00，与后端
 * （按 UTC 小时判断"是否下班后出发"）的请假成本计算口径脱节，
 * 出现"标着周五出发、时间线却是周六凌晨"的自相矛盾。
 *
 * 因此航班时刻一律按 UTC 读取；系统时间戳（crawledAt/日志时间等真正的
 * instant）仍用本地时区，不要套这个函数。
 */
export function formatFlightTime(value: string | Date | null | undefined, fmt = 'MM-DD HH:mm'): string {
  if (!value) return '-';
  return dayjs.utc(value).format(fmt);
}

/** 航班日期（YYYY-MM-DD），同样按 UTC 口径 */
export function flightDateString(value: string | Date): string {
  return dayjs.utc(value).format('YYYY-MM-DD');
}
