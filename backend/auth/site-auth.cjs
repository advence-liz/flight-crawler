// Runtime bridge for Better Auth's ESM package in the CommonJS Nest app (Node 22).
const { createHmac, randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { betterAuth } = require('better-auth');
const { APIError, createAuthMiddleware } = require('better-auth/api');
const { getMigrations } = require('better-auth/db/migration');
const { fromNodeHeaders, toNodeHandler } = require('better-auth/node');
const { emailOTP } = require('better-auth/plugins/email-otp');

function buildSiteAuth(config, access) {
  const { origin, secret, databaseUrl, github, google, mail } = config;
  const pool = new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 5000,
    statement_timeout: 5000, query_timeout: 6000, idleTimeoutMillis: 10000 });
  pool.on('error', () => undefined);
  const invited = (email) => access.isEmailInvited(email);
  const hashOtp = async (otp) => createHmac('sha256', secret).update(`email-otp:${otp}`).digest('hex');
  const auth = betterAuth({
    baseURL: origin, basePath: '/api/auth', secret, database: pool, trustedOrigins: [origin],
    appName: '随心飞', telemetry: { enabled: false }, logger: { disabled: true },
    session: { expiresIn: 7 * 86400, updateAge: 86400, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, window: 60, max: 60, storage: 'database', customRules: { '/sign-in/social': { window: 60, max: 12 } } },
    advanced: { cookiePrefix: 'flight-site', useSecureCookies: origin.startsWith('https:') },
    onAPIError: { errorURL: `${origin}/?login=error#/account` },
    socialProviders: { ...(github && { github }), ...(google && { google }) },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: true, trustedProviders: [] } },
    user: { validateUserInfo: async ({ user, source }) => {
      if (!user.email || user.emailVerified !== true) return { error: { code: 'VERIFIED_EMAIL_REQUIRED', message: 'Verified email required' } };
      if (source.method === 'email-otp' && !await invited(user.email)) {
        return { error: { code: 'INVITATION_REQUIRED', message: 'Email invitation required' } };
      }
    } },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (!['/email-otp/send-verification-otp', '/sign-in/email-otp'].includes(ctx.path)) return;
        const sending = ctx.path === '/email-otp/send-verification-otp';
        const email = ctx.body?.email;
        if (!mail || (sending && ctx.body?.type !== 'sign-in')) throw new APIError('BAD_REQUEST', { message: 'Email sign-in unavailable' });
        if (typeof email !== 'string' || !await invited(email)) {
          if (sending) return ctx.json({ success: true });
          throw new APIError('UNAUTHORIZED', { message: 'Invalid sign-in code' });
        }
        // Admit before generating the next code so rejected resends cannot invalidate the current one.
        if (sending && !await access.reserveEmail(email, config.emailDayLimit)) {
          throw new APIError('TOO_MANY_REQUESTS', { message: 'Try again later' });
        }
      }),
      after: createAuthMiddleware(async ctx => {
        // Use only the HttpOnly cookie; do not expose the session token to JS.
        if (ctx.path === '/sign-in/email-otp' && ctx.context.newSession) return ctx.json({ ok: true });
      }),
    },
    plugins: mail ? [emailOTP({ expiresIn: 300, allowedAttempts: 3, storeOTP: { hash: hashOtp },
      async sendVerificationOTP({ email, otp }) { await mail(email, otp); },
    })] : [],
  });
  let migration;
  async function ready() {
    // Session-level lock across instances; migration itself uses the other pool connection.
    migration ??= (async () => {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(1050901, 3)');
        const { runMigrations } = await getMigrations(auth.options);
        await runMigrations();
      } finally { client.release(true); }
    })().catch(error => { migration = undefined; throw error; });
    return migration;
  }
  const nodeHandler = toNodeHandler(auth);
  const routes = new Set(['/email-otp/send-verification-otp', '/sign-in/email-otp', '/sign-in/social', '/sign-out']);
  return {
    async handle(req, res) {
      const path = req.path.slice('/api/auth'.length);
      const provider = path === '/callback/github' ? github : path === '/callback/google' ? google : undefined;
      if (!(req.method === 'GET' && provider) && !(req.method === 'POST' && routes.has(path) && req.headers.origin === origin)) {
        return res.status(404).json({ message: 'Unavailable' });
      }
      await ready();
      return nodeHandler(req, res);
    },
    async session(headers) {
      if (!headers.cookie?.includes('flight-site.session_token=')) return null;
      await ready();
      const result = await auth.api.getSession({ headers: fromNodeHeaders(headers), query: { disableRefresh: true } });
      return result?.user?.emailVerified ? { id: result.user.id, name: result.user.name, email: result.user.email } : null;
    },
    close: () => pool.end(),
  };
}

function resendMailer(apiKey, from) {
  return async (email, otp) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(7000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomBytes(16).toString('hex') },
      body: JSON.stringify({ from, to: [email], subject: '随心飞登录验证码', text: `登录验证码：${otp}。5 分钟内有效。如非本人操作，请忽略。` }),
    });
    await res.body?.cancel();
    if (!res.ok) throw new APIError('SERVICE_UNAVAILABLE', { message: 'Email delivery unavailable' });
  };
}

module.exports = { buildSiteAuth, resendMailer };
