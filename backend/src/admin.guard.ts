import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // 本地开发环境直接放行
    if (process.env.NODE_ENV === 'development') return true;

    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return true; // 未配置 Token 时放行

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    if (token !== adminToken) {
      throw new UnauthorizedException('Token 错误或未设置');
    }
    return true;
  }
}
