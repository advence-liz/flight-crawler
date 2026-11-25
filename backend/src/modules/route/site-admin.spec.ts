import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from '../../admin.guard';
import { FlightMcpQuota } from './flight-mcp-quota';
import { SiteAuthService } from './site-auth.service';

const origin = 'https://flight.example.test';
const email = 'admin@example.test';
const verified = { id: 'real-account', name: 'Admin', email };
const request = (headers: Request['headers'] = {}, method = 'GET') => ({ headers, method }) as Request;

describe('account-bound administrator', () => {
  let auth: SiteAuthService;
  let active: boolean;
  const former = process.env.SITE_ADMIN_EMAIL;
  const legacy = process.env.ADMIN_TOKEN;
  beforeEach(() => {
    process.env.SITE_ADMIN_EMAIL = email.toUpperCase();
    process.env.ADMIN_TOKEN = 'legacy-admin-test';
    active = true;
    const access = { siteUser: jest.fn(async () => ({ id: 'quota-id', active, email, hasToken: false })) } as unknown as FlightMcpQuota;
    auth = new SiteAuthService(access);
    Reflect.set(auth, 'config', { origin });
    // Runtime returns only authentically verified identities. The quota row email is deliberately always the administrator email.
    Reflect.set(auth, 'runtime', { session: async (headers: Request['headers']) => headers.cookie === 'session=admin' ? verified
      : headers.cookie === 'session=member' ? { ...verified, id: 'member', email: 'member@example.test' } : null });
  });
  afterEach(() => {
    if (former === undefined) delete process.env.SITE_ADMIN_EMAIL; else process.env.SITE_ADMIN_EMAIL = former;
    if (legacy === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = legacy;
  });

  const context = (req: Request) => ({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ setHeader: jest.fn() }) }) }) as unknown as ExecutionContext;
  const guard = () => new AdminGuard(auth);

  it('uses the verified session email, not the quota row, and rejects the former token', async () => {
    await expect(guard().canActivate(context(request({ cookie: 'session=admin' })))).resolves.toBe(true);
    await expect(guard().canActivate(context(request({ cookie: 'session=member' })))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard().canActivate(context(request({ authorization: 'Bearer legacy-admin-test' })))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard().canActivate(context(request({ cookie: 'session=unverified' })))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('checks the exact origin for writes and protects anonymous development too', async () => {
    for (const source of [undefined, 'https://other.example.test']) {
      await expect(guard().canActivate(context(request({ cookie: 'session=admin', origin: source }, 'POST')))).rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(guard().canActivate(context(request({ cookie: 'session=admin', origin }, 'DELETE')))).resolves.toBe(true);
  });

  it('fails closed when the admin account is disabled or not configured', async () => {
    active = false;
    await expect(guard().canActivate(context(request({ cookie: 'session=admin' })))).rejects.toBeInstanceOf(ForbiddenException);
    active = true;
    delete process.env.SITE_ADMIN_EMAIL;
    await expect(guard().canActivate(context(request({ cookie: 'session=admin' })))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
