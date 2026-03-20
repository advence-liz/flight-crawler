import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * 对 GET 接口自动设置浏览器缓存头（30 分钟）
 * POST/DELETE 等写操作不加缓存
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    return next.handle().pipe(
      tap(() => {
        if (request.method === 'GET') {
          response.setHeader('Cache-Control', 'public, max-age=1800'); // 30 分钟
        } else {
          response.setHeader('Cache-Control', 'no-store');
        }
      }),
    );
  }
}
