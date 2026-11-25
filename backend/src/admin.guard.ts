import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SiteAuthService } from './modules/route/site-auth.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: SiteAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const account = await this.auth.user(req, !['GET', 'HEAD', 'OPTIONS'].includes(req.method));
    if (!account.isAdmin) throw new ForbiddenException('此账号没有管理员权限');
    return true;
  }
}
