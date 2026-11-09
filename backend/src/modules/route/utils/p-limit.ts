/**
 * 限制并发度的 Promise.all：每次最多同时执行 limit 个任务。
 * route.service 和 round-trip.service 原先各有一份拷贝，统一放这里。
 */
export async function pLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  const run = async (): Promise<void> => {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, run));
  return results;
}
