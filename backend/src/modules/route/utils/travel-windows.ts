import { getDayDetail } from 'chinese-days';
import { isWorkday } from './leave-days';

/**
 * 出行窗口：把查询区间拆成"可以走一趟"的时间块。
 *
 * 用户真正的决策不是"9 月 10 号到 10 月 20 号之间"，而是"中秋去哪""下个周末去哪"。
 * 这里把区间里连续的休息日（周末 / 法定节假日）找出来，各自算出一个去返程范围：
 *   去程：假期前一天（下班走）~ 假期第一天
 *   返程：假期第二天 ~ 假期最后一天
 * 这样前端可以直接给一排「中秋 / 国庆 / 本周末」的快捷筛选。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** 区间最多扫多久，避免异常参数把服务拖死 */
const MAX_SCAN_DAYS = 120;
/** 最多返回几个窗口 */
const MAX_WINDOWS = 6;

export interface TravelWindow {
  /** 稳定标识：窗口首日 */
  key: string;
  type: 'holiday' | 'weekend';
  /** 展示名：中秋 / 国庆节 / 本周末（周末的相对文案由前端补） */
  label: string;
  /** 连续休息日的第一天 */
  startDate: string;
  /** 连续休息日的最后一天 */
  endDate: string;
  departStart: string;
  departEnd: string;
  returnStart: string;
  returnEnd: string;
}

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function holidayName(dateStr: string): string | undefined {
  try {
    const detail = getDayDetail(dateStr) as { name?: string } | undefined;
    // "National Day,国庆节,3" -> 国庆节；周末则是 "Saturday"，没有中文名
    return detail?.name?.split(',')[1] || undefined;
  } catch {
    return undefined;
  }
}

/**
 * 找出区间内所有"连续休息日"块。
 * 单天的休息日（例如只放一天）不成行，至少 2 天才会被当成一个窗口。
 */
export function findTravelWindows(startDate: string, endDate: string): TravelWindow[] {
  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];

  // 1) 扫出所有休息日
  const restDays: string[] = [];
  let cursor = startMs;
  for (let i = 0; i < MAX_SCAN_DAYS && cursor <= endMs; i++) {
    const date = toDateStr(cursor);
    if (!isWorkday(date)) restDays.push(date);
    cursor += DAY_MS;
  }

  // 2) 合并成连续块
  const runs: string[][] = [];
  for (const date of restDays) {
    const last = runs[runs.length - 1];
    if (last && new Date(`${date}T00:00:00Z`).getTime() - new Date(`${last[last.length - 1]}T00:00:00Z`).getTime() === DAY_MS) {
      last.push(date);
    } else {
      runs.push([date]);
    }
  }

  // 3) 每个块算出去返程范围
  const windows: TravelWindow[] = [];
  for (const run of runs) {
    if (run.length < 2) continue;

    const runStartMs = new Date(`${run[0]}T00:00:00Z`).getTime();
    const runEndMs = new Date(`${run[run.length - 1]}T00:00:00Z`).getTime();

    // 去程：假期前一天（可下班后走）到假期中段。
    // 不放满整个假期，否则会组合出"假期最后一天才出发"的行程。
    //   普通周末 → 周五~周六
    //   3 天小长假 → 周四~周六
    //   7 天长假 → 节前~假期中间
    const departStart = toDateStr(runStartMs - DAY_MS);
    const departEnd = toDateStr(runStartMs + Math.floor((runEndMs - runStartMs) / 2 / DAY_MS) * DAY_MS);
    // 返程：假期第 2 天到假期最后一天
    const returnStart = toDateStr(Math.min(runStartMs + DAY_MS, runEndMs));
    const returnEnd = run[run.length - 1];

    const holiday = run.map(holidayName).find(Boolean);
    windows.push({
      key: run[0],
      type: holiday ? 'holiday' : 'weekend',
      label: holiday ?? '周末',
      startDate: run[0],
      endDate: run[run.length - 1],
      departStart,
      departEnd,
      returnStart,
      returnEnd,
    });

    if (windows.length >= MAX_WINDOWS) break;
  }

  // 4) 同名假期（如国庆跨两个块）只保留第一个
  const seen = new Set<string>();
  return windows.filter((w) => {
    const dedupeKey = `${w.type}|${w.label}|${w.startDate.slice(0, 7)}`;
    if (w.type === 'weekend') return true; // 周末各自独立
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
}
