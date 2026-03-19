const ORIGIN_COOKIE_KEY = 'flight_origin';
const DATE_RANGE_KEY = 'flight_date_range';       // DestinationQuery 日期区间
const DEPART_RANGE_KEY = 'flight_depart_range';   // RoutePlanner 去程区间
const RETURN_RANGE_KEY = 'flight_return_range';   // RoutePlanner 返程区间
const COOKIE_DAYS = 90;

export function getOriginCookie(): string {
  const row = document.cookie.split('; ').find(r => r.startsWith(`${ORIGIN_COOKIE_KEY}=`));
  return row ? decodeURIComponent(row.split('=').slice(1).join('=')) : '';
}

export function setOriginCookie(value: string): void {
  const expires = new Date(Date.now() + COOKIE_DAYS * 864e5).toUTCString();
  document.cookie = `${ORIGIN_COOKIE_KEY}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

/** 读取出发地：优先 cookie，没有则返回默认值 */
export function getDefaultOrigin(fallback = '北京首都'): string {
  return getOriginCookie() || fallback;
}

// ─── 日期区间持久化 ───────────────────────────────────────────

function getCookie(key: string): string {
  const row = document.cookie.split('; ').find(r => r.startsWith(`${key}=`));
  return row ? decodeURIComponent(row.split('=').slice(1).join('=')) : '';
}

function setCookie(key: string, value: string): void {
  const expires = new Date(Date.now() + COOKIE_DAYS * 864e5).toUTCString();
  document.cookie = `${key}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

/** DestinationQuery 日期区间：[startDate, endDate] */
export function getDateRange(): [string, string] | null {
  const v = getCookie(DATE_RANGE_KEY);
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed) && parsed.length === 2) return parsed as [string, string];
  } catch { /* ignore */ }
  return null;
}

export function setDateRange(start: string, end: string): void {
  setCookie(DATE_RANGE_KEY, JSON.stringify([start, end]));
}

/** RoutePlanner 去程区间 */
export function getDepartRange(): [string, string] | null {
  const v = getCookie(DEPART_RANGE_KEY);
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed) && parsed.length === 2) return parsed as [string, string];
  } catch { /* ignore */ }
  return null;
}

export function setDepartRange(start: string, end: string): void {
  setCookie(DEPART_RANGE_KEY, JSON.stringify([start, end]));
}

/** RoutePlanner 返程区间 */
export function getReturnRange(): [string, string] | null {
  const v = getCookie(RETURN_RANGE_KEY);
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed) && parsed.length === 2) return parsed as [string, string];
  } catch { /* ignore */ }
  return null;
}

export function setReturnRange(start: string, end: string): void {
  setCookie(RETURN_RANGE_KEY, JSON.stringify([start, end]));
}

/** 默认日期区间：今天 ~ 一个月后 */
export function getDefaultDateRange(): [string, string] {
  const today = new Date();
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return [fmt(today), fmt(nextMonth)];
}
