import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

// 不缓存的路径前缀（管理类、实时查询类接口）
const NO_CACHE_PATHS = [
  '/api/crawler/logs',
  '/api/crawler/cache',
  '/api/crawler/cron',
  '/api/crawler/debug',
  '/api/airports',
  '/api/flights/paginated',
  '/api/health',
];

/**
 * 对用户侧 GET 接口自动设置浏览器缓存头（30 分钟）
 * 管理类接口和写操作不加缓存
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    return next.handle().pipe(
      tap(() => {
        const isNoCache = request.method !== 'GET' ||
          NO_CACHE_PATHS.some(p => request.url.startsWith(p));
        if (isNoCache) {
          response.setHeader('Cache-Control', 'no-store');
        } else {
          response.setHeader('Cache-Control', 'public, max-age=1800');
        }
      }),
    );
  }
}
