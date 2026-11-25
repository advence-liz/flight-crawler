import { ForbiddenException, Injectable, Logger, OnModuleDestroy, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { FlightMcpQuota, type SiteIdentity } from './flight-mcp-quota';

type Mailer = (email: string, code: string) => Promise<void>;
type Provider = { clientId: string; clientSecret: string };
type RuntimeConfig = { origin: string; secret: string; databaseUrl: string; github?: Provider; google?: Provider; mail?: Mailer; emailDayLimit: number };
type Runtime = { handle(req: Request, res: Response): Promise<unknown>; session(headers: Request['headers']): Promise<SiteIdentity | null>; close(): Promise<void> };
const digest = (value: string) => createHash('sha256').update(value).digest();
export function isSiteAdmin(req: Request) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  const got = req.headers.authorization;
  return Boolean(expected && got?.startsWith('Bearer ') && timingSafeEqual(digest(got.slice(7)), digest(expected)));
}

@Injectable()
export class SiteAuthService implements OnModuleDestroy {
  private runtime?: Runtime;
  private config?: RuntimeConfig;
  private inFlight = 0;
  private readonly logger = new Logger(SiteAuthService.name);
  constructor(private readonly access: FlightMcpQuota) {}

  initialize(testMail?: Mailer) {
    if (this.runtime || process.env.SITE_AUTH_ENABLED !== 'true') return;
    const secret = process.env.SITE_AUTH_SECRET?.trim();
    const databaseUrl = process.env.FLIGHT_MCP_QUOTA_DATABASE_URL?.trim();
    const origin = process.env.SITE_AUTH_ORIGIN?.trim();
    const url = URL.canParse(origin || '') ? new URL(origin!) : undefined;
    if (!secret || secret.length < 32 || !databaseUrl || !url || origin !== url.origin
      || !(url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) {
      this.logger.warn('Website login disabled: missing or invalid configuration');
      return;
    }
    const load = createRequire(__filename);
    const runtime: { buildSiteAuth(config: RuntimeConfig, access: FlightMcpQuota): Runtime; resendMailer(key: string, from: string): Mailer } =
      load(join(__dirname, '../../../auth/site-auth.cjs'));
    const provider = (name: string): Provider | undefined => {
      const clientId = process.env[`SITE_AUTH_${name}_CLIENT_ID`]?.trim();
      const clientSecret = process.env[`SITE_AUTH_${name}_CLIENT_SECRET`]?.trim();
      return clientId && clientSecret ? { clientId, clientSecret } : undefined;
    };
    const key = process.env.SITE_AUTH_RESEND_API_KEY?.trim();
    const from = process.env.SITE_AUTH_EMAIL_FROM?.trim();
    const emailLimit = process.env.SITE_AUTH_EMAIL_DAILY_LIMIT ?? '80';
    const emailDayLimit = /^\d{1,2}$/.test(emailLimit) ? Math.min(Number(emailLimit), 80) : 0;
    const mail = testMail ?? (key && from ? runtime.resendMailer(key, from) : undefined);
    this.config = { origin, secret, databaseUrl, github: provider('GITHUB'), google: provider('GOOGLE'), mail, emailDayLimit };
    this.runtime = runtime.buildSiteAuth(this.config, this.access);
  }

  status() { return { email: Boolean(this.config?.mail && this.config.emailDayLimit > 0), github: Boolean(this.config?.github), google: Boolean(this.config?.google) }; }

  // Must run ahead of Nest's JSON parser. Better Auth reads the original request stream.
  middleware = (req: Request, res: Response, next: NextFunction) => {
    if (!/^\/api\/auth(?:\/|$)/.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-store');
    if (!this.runtime) return res.status(404).json({ message: '登录未启用' });
    if (this.inFlight >= 8) return res.status(429).json({ message: '登录繁忙，请稍后重试' });
    this.inFlight++;
    void this.runtime.handle(req, res).catch(() => {
      if (!res.headersSent) res.status(503).json({ message: '登录暂不可用' });
      else res.end();
    }).finally(() => { this.inFlight--; });
  };

  async user(req: Request, write = false) {
    if (!this.runtime || !req.headers.cookie) throw new UnauthorizedException('请先登录');
    if (write && req.headers.origin !== this.config!.origin) throw new ForbiddenException('请求来源无效');
    if (this.inFlight >= 8) throw new ServiceUnavailableException('登录服务繁忙');
    this.inFlight++;
    try {
      const identity = await this.runtime.session(req.headers).catch(() => { throw new ServiceUnavailableException('登录暂不可用'); });
      if (!identity) throw new UnauthorizedException('请重新登录');
      const user = await this.access.siteUser(identity);
      if (!user?.active) throw new ForbiddenException('此账号已停用');
      return user;
    } finally { this.inFlight--; }
  }

  async onModuleDestroy() { await this.runtime?.close(); }
}
