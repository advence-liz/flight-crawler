import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { FlightSitePriority } from './modules/route/flight-site-priority';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly priority: FlightSitePriority) {}

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
    if (method !== 'OPTIONS' && /^\/api\/(?:flights|routes)(?=\/|\?|$)/.test(originalUrl)) {
      const finish = this.priority.begin();
      res.once('finish', finish);
      res.once('close', finish);
    }
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;
      // 带上 UA：区分"真人访问"和"保活探针"（cron-job.org / UptimeRobot 等都带特征 UA），
      // 排查"实例到底是被谁唤醒的"时全靠这个字段
      // （只记 UA 不记 IP：够定位来源，也不会在日志里留下访客地址）
      const ua = req.get('user-agent') || '-';
      this.logger.log(`${method} ${originalUrl} ${statusCode} ${duration}ms ua="${ua}"`);
    });

    next();
  }
}
