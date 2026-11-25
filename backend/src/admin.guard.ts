import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Preserve the legacy local shortcut only when website accounts are disabled.
    if (process.env.NODE_ENV === 'development' && process.env.SITE_AUTH_ENABLED !== 'true') return true;

    const adminToken = process.env.ADMIN_TOKEN?.trim();
    if (!adminToken) throw new UnauthorizedException('未配置管理员 Token');

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    if (token !== adminToken) {
      throw new UnauthorizedException('Token 错误或未设置');
    }
    return true;
  }
}
