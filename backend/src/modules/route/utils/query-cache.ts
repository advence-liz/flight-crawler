import { Repository } from 'typeorm';
import { QueryCache } from '../entities/query-cache.entity';

/**
 * query_cache 读写兜底。
 *
 * 缓存只是加速手段：表损坏、JSON 反序列化失败、磁盘写满都不应该让接口 500。
 * 读失败一律当未命中，写失败只丢日志。
 */

export async function readCache<T>(
  repo: Repository<QueryCache>,
  cacheKey: string,
): Promise<T | null> {
  try {
    const cached = await repo.findOne({ where: { cacheKey } });
    if (!cached || cached.expireAt <= new Date()) return null;
    return JSON.parse(cached.data) as T;
  } catch {
    return null;
  }
}

export async function writeCache(
  repo: Repository<QueryCache>,
  cacheKey: string,
  data: unknown,
  ttlMs: number,
): Promise<void> {
  if (!ttlMs || ttlMs <= 0) return;
  try {
    await repo.save({
      cacheKey,
      data: JSON.stringify(data),
      expireAt: new Date(Date.now() + ttlMs),
      createdAt: new Date(),
    });
  } catch {
    // 写缓存失败不影响主流程
  }
}
