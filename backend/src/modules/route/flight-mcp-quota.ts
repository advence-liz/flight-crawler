import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';

const DAILY_DEFAULT = 100;
const DAY_SECONDS = 86_400;
const PAGE_SIZE = 20;
const BEIJING_DAY = `(statement_timestamp() AT TIME ZONE 'Asia/Shanghai')::date`;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export const isFlightMcpToken = (token: string) => /^sxf_[0-9a-f]{64}$/.test(token);
export const secondsUntilBeijingMidnight = (now: number) =>
  DAY_SECONDS - (Math.floor(now / 1000) + 8 * 3600) % DAY_SECONDS;

export interface McpUser extends QueryResultRow {
  id: string;
  name: string;
  active: boolean;
  hasToken: boolean;
  todayCalls: number;
  email: string | null;
}

export type SiteIdentity = { id: string; name: string; email: string };

@Injectable()
export class FlightMcpQuota implements OnModuleDestroy {
  private readonly logger = new Logger(FlightMcpQuota.name);
  private pool?: Pool;
  private ready?: Promise<unknown>;
  private pending = 0;

  private async query<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
    const connectionString = process.env.FLIGHT_MCP_QUOTA_DATABASE_URL?.trim();
    if (!connectionString || this.pending >= 8) throw new ServiceUnavailableException('MCP 用户及额度服务暂不可用');
    this.pending++;
    try {
      if (!this.pool) {
        this.pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000,
          statement_timeout: 2000, query_timeout: 3000 });
        this.pool.on('error', () => this.logger.warn('MCP storage idle connection failed'));
      }
      const pool = this.pool;
      this.ready ??= pool.query(`
        SELECT pg_advisory_xact_lock(1050901, 2);
        CREATE TABLE IF NOT EXISTS flight_mcp_daily_quota (
          day date PRIMARY KEY, calls integer NOT NULL CHECK (calls > 0)
        );
        CREATE TABLE IF NOT EXISTS flight_mcp_users (
          id uuid PRIMARY KEY, name varchar(60) NOT NULL, active boolean NOT NULL DEFAULT true,
          token_hash text UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE flight_mcp_users ADD COLUMN IF NOT EXISTS login_email varchar(254) UNIQUE;
        ALTER TABLE flight_mcp_users ADD COLUMN IF NOT EXISTS site_user_id text UNIQUE;
        ALTER TABLE flight_mcp_users ADD COLUMN IF NOT EXISTS otp_last_sent_at timestamptz;
        ALTER TABLE flight_mcp_users ADD COLUMN IF NOT EXISTS email_invited boolean NOT NULL DEFAULT false;
        CREATE TABLE IF NOT EXISTS flight_site_daily_email (
          day date PRIMARY KEY, calls integer NOT NULL
        );
        CREATE TABLE IF NOT EXISTS flight_site_daily_chat (
          user_id uuid NOT NULL REFERENCES flight_mcp_users (id), day date NOT NULL,
          calls integer NOT NULL, PRIMARY KEY (user_id, day)
        );
        CREATE TABLE IF NOT EXISTS flight_mcp_user_daily_usage (
          user_id uuid NOT NULL REFERENCES flight_mcp_users (id), day date NOT NULL,
          calls integer NOT NULL CHECK (calls > 0), PRIMARY KEY (user_id, day)
        );
      `).catch((error: unknown) => { this.ready = undefined; throw error; });
      await this.ready;
      return await pool.query<T>(sql, params);
    } catch {
      // Never log query parameters, driver error text, URLs, or raw credentials.
      this.logger.warn('MCP storage query failed');
      throw new ServiceUnavailableException('MCP 用户及额度服务暂不可用');
    } finally { this.pending--; }
  }

  async list(page: number) {
    const { rows } = await this.query<McpUser>(`
      SELECT u.id, u.name, u.active, u.login_email AS email, u.token_hash IS NOT NULL AS "hasToken", COALESCE(d.calls, 0) AS "todayCalls"
      FROM flight_mcp_users u
      LEFT JOIN flight_mcp_user_daily_usage d ON d.user_id = u.id AND d.day = ${BEIJING_DAY}
      ORDER BY u.created_at DESC, u.id LIMIT $1 OFFSET $2
    `, [PAGE_SIZE + 1, (page - 1) * PAGE_SIZE]);
    return { users: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
  }

  async create(name: string, email?: string) {
    const id = randomUUID();
    const { rowCount } = await this.query(`INSERT INTO flight_mcp_users (id, name, login_email, email_invited)
      VALUES ($1, $2, $3, $3::varchar IS NOT NULL) ON CONFLICT (login_email) DO NOTHING`, [id, name, email ?? null]);
    return rowCount === 1 ? { id } : null;
  }

  async isEmailInvited(email: string) {
    const { rowCount } = await this.query('SELECT 1 FROM flight_mcp_users WHERE active AND email_invited AND login_email = $1', [email.toLowerCase()]);
    return rowCount === 1;
  }

  async reserveEmail(email: string, limit: number) {
    const { rowCount } = await this.query(`
      WITH recipient AS (
        UPDATE flight_mcp_users SET otp_last_sent_at = now()
        WHERE active AND email_invited AND login_email = $1 AND $2::int > 0
          AND (otp_last_sent_at IS NULL OR otp_last_sent_at <= now() - interval '60 seconds') RETURNING id
      )
      INSERT INTO flight_site_daily_email (day, calls) SELECT ${BEIJING_DAY}, 1 FROM recipient
      ON CONFLICT (day) DO UPDATE SET calls = flight_site_daily_email.calls + 1
        WHERE flight_site_daily_email.calls < $2::int RETURNING calls
    `, [email.toLowerCase(), limit]);
    return rowCount === 1;
  }

  async siteUser(identity: SiteIdentity) {
    const columns = `id, name, active, login_email AS email, token_hash IS NOT NULL AS "hasToken", 0 AS "todayCalls"`;
    const existing = await this.query<McpUser>(`SELECT ${columns} FROM flight_mcp_users WHERE site_user_id = $1`, [identity.id]);
    if (existing.rows[0]) return existing.rows[0];
    const name = Array.from(identity.name.trim() || '网站用户').slice(0, 60).join('');
    const result = await this.query<McpUser>(`
      INSERT INTO flight_mcp_users (id, name, login_email, site_user_id) VALUES ($1, $2, $3, $4)
      ON CONFLICT (login_email) DO UPDATE SET site_user_id = EXCLUDED.site_user_id
      WHERE flight_mcp_users.site_user_id IS NULL OR flight_mcp_users.site_user_id = EXCLUDED.site_user_id
      RETURNING ${columns}
    `, [randomUUID(), name, identity.email.toLowerCase(), identity.id]);
    return result.rows[0] ?? null;
  }

  async reserveChat(id: string, limit: number) {
    const { rowCount } = await this.query(`
      INSERT INTO flight_site_daily_chat (user_id, day, calls)
      SELECT id, ${BEIJING_DAY}, 1 FROM flight_mcp_users WHERE id = $1 AND active AND $2::int > 0
      ON CONFLICT (user_id, day) DO UPDATE SET calls = flight_site_daily_chat.calls + 1
        WHERE flight_site_daily_chat.calls < $2::int RETURNING calls
    `, [id, limit]);
    return rowCount === 1;
  }

  async setActive(id: string, active: boolean) {
    const { rowCount } = await this.query(`UPDATE flight_mcp_users SET active = $2,
      token_hash = CASE WHEN $2 THEN token_hash ELSE NULL END WHERE id = $1`, [id, active]);
    return rowCount === 1;
  }

  async issue(id: string) {
    const token = `sxf_${randomBytes(32).toString('hex')}`;
    const { rowCount } = await this.query('UPDATE flight_mcp_users SET token_hash = $2 WHERE id = $1 AND active', [id, hash(token)]);
    return rowCount === 1 ? { token } : null;
  }

  async revoke(id: string) {
    const { rowCount } = await this.query('UPDATE flight_mcp_users SET token_hash = NULL WHERE id = $1', [id]);
    return rowCount === 1;
  }

  async authorize(token: string) {
    const { rowCount } = await this.query('SELECT 1 FROM flight_mcp_users WHERE active AND token_hash = $1', [hash(token)]);
    return rowCount === 1;
  }

  async take(token: string, limit: number): Promise<'admitted' | 'daily_quota' | 'unauthorized'> {
    // Authenticate and debit both counters in one statement. The row lock orders
    // admission against revocation; requests already admitted are allowed to finish.
    const { rows: [result] } = await this.query<{ authorized: boolean; admitted: boolean }>(`
      WITH credential AS MATERIALIZED (
        SELECT id FROM flight_mcp_users WHERE active AND token_hash = $1 FOR SHARE
      ), admitted AS (
        INSERT INTO flight_mcp_daily_quota (day, calls)
        SELECT ${BEIJING_DAY}, 1 FROM credential WHERE $2::integer > 0
        ON CONFLICT (day) DO UPDATE SET calls = flight_mcp_daily_quota.calls + 1
        WHERE flight_mcp_daily_quota.calls < $2::integer
        RETURNING day
      ), counted AS (
        INSERT INTO flight_mcp_user_daily_usage (user_id, day, calls)
        SELECT credential.id, admitted.day, 1 FROM credential CROSS JOIN admitted
        ON CONFLICT (user_id, day) DO UPDATE SET calls = flight_mcp_user_daily_usage.calls + 1
        RETURNING user_id
      )
      SELECT EXISTS (SELECT 1 FROM credential) AS authorized, EXISTS (SELECT 1 FROM counted) AS admitted
    `, [hash(token), limit]);
    return !result.authorized ? 'unauthorized' : result.admitted ? 'admitted' : 'daily_quota';
  }

  async onModuleDestroy() { await this.pool?.end(); }
}

export function flightMcpDailyLimit(raw: string | undefined): number | null {
  if (raw === undefined) return DAILY_DEFAULT;
  return /^\d{1,6}$/.test(raw.trim()) ? Number(raw) : null;
}
