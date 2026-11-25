import { ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from '../../admin.guard';

// The CI crawler listens only on a private Unix socket, never a TCP port.
export function crawlerCiSocket() {
  const path = process.env.CRAWLER_CI_SOCKET;
  return process.env.GITHUB_ACTIONS === 'true' && !process.env.RENDER && path?.startsWith('/') ? path : undefined;
}

@Injectable()
export class CrawlerCiGuard extends AdminGuard {
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (crawlerCiSocket() && request.socket.remoteAddress === undefined && request.socket.localAddress === undefined) return true;
    return super.canActivate(context);
  }
}
