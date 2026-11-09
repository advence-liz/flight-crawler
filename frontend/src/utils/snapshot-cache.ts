/**
 * 前端结果快照缓存（localStorage）。
 *
 * 为什么要这个：国内访问 Render 链路 RTT 高，免费实例 15 分钟没请求就休眠，
 * 首次访问经常要等 15~40 秒。航班数据每天只更新一次，同一个查询几小时内重复结果完全一样，
 * 所以采用「先渲染快照，再后台刷新」：
 *
 *   1. 命中快照 → 立刻渲染（0 延迟），同时照常发真实请求
 *   2. 真实结果回来 → 覆盖页面 + 更新快照
 *
 * 允许短暂不一致（最终一致）：快照最多旧 TTL 时长，且一定会被真实结果覆盖。
 *
 * localStorage 在隐私模式 / 配额满 / 被禁用时会抛异常，所有读写都必须兜底。
 */

/**
 * 键前缀里带版本号：接口返回结构变化时把版本号 +1，旧快照自动失效，
 * 避免发版后旧结构的数据被读出来渲染（可能直接白屏）。
 */
const SNAPSHOT_VERSION = 'v2';
const PREFIX = `fc-snapshot:${SNAPSHOT_VERSION}:`;
/** 单条快照上限，避免把 localStorage 撑爆（超出直接不写） */
const MAX_ENTRY_BYTES = 512 * 1024;

interface Entry<T> {
  /** 写入时间戳 */
  t: number;
  /** 数据 */
  d: T;
}

/** 由命名空间 + 查询参数生成稳定的缓存键 */
export function snapshotKey(namespace: string, params: Record<string, unknown>): string {
  // 参数排序后再序列化，保证同样的查询得到同样的 key
  const sorted = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('&');
  return `${PREFIX}${namespace}?${sorted}`;
}

/**
 * 读快照。超过 ttlMs 视为失效返回 null。
 * 返回的 ageMs 用于在界面上标注"快照有多旧"。
 */
export function readSnapshot<T>(key: string, ttlMs: number): { data: T; ageMs: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (!entry || typeof entry.t !== 'number') return null;
    const ageMs = Date.now() - entry.t;
    if (ageMs < 0 || ageMs > ttlMs) return null;
    return { data: entry.d, ageMs };
  } catch {
    return null;
  }
}

/** 写快照。写失败（配额满 / 禁用）静默忽略，不影响主流程 */
export function writeSnapshot(key: string, data: unknown): void {
  try {
    const payload = JSON.stringify({ t: Date.now(), d: data } as Entry<unknown>);
    if (payload.length > MAX_ENTRY_BYTES) return;
    localStorage.setItem(key, payload);
  } catch {
    // 忽略
  }
}

/** 把快照年龄格式化成「刚刚 / 3 分钟前 / 2 小时前」 */
export function formatAge(ageMs: number): string {
  const min = Math.floor(ageMs / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.floor(hour / 24)} 天前`;
}
