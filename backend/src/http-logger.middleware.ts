import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
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
