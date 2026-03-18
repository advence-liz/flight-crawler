import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return true; // 未配置时放行（本地开发）

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    if (token !== adminToken) {
      throw new UnauthorizedException('Token 错误或未设置');
    }
    return true;
  }
}
