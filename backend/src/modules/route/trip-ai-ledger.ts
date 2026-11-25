import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, QueryResultRow } from 'pg';
import { BUDGET_MODEL, dailyLimitNanoCny, MAX_ATTEMPT_NANO_CNY, TARIFF_VERSION, UsageQuote } from './trip-ai-pricing';

type Channel = 'chat' | 'interpret';
type Reservation = { id: string; startedAt: Date };
const BEIJING_DAY = "(statement_timestamp() AT TIME ZONE 'Asia/Shanghai')::date";
type Operation = 'schema' | 'reserve' | 'settle' | 'mark-unknown' | 'summary';

export class TripAiLedgerError extends Error {
  constructor(operation: Operation, phase: 'connect' | 'query' | 'config', error: unknown, elapsedMs: number) {
    const { code, message } = error instanceof Error ? error as NodeJS.ErrnoException : {};
    const category = phase === 'config' ? 'invalid_limit'
      : typeof code === 'string' && (/^[0-9A-Z]{5}$/.test(code)
      || /^(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS_CERT_ALTNAME_INVALID)$/.test(code))
      ? code
      : typeof message === 'string' && /timeout/i.test(message) ? 'timeout' : 'other';
    // Never include the driver's message, stack, connection URI, or SQL values.
    super(`operation=${operation} phase=${phase} code=${category} elapsedMs=${elapsedMs}`);
  }
}

// Dedicated DB, independent of the flight SQLite snapshot. The schema lock
// serializes first startup across app instances. One implicit SQL transaction.
const SCHEMA = `
  SELECT pg_advisory_xact_lock(1050901, 1);
  CREATE TABLE IF NOT EXISTS trip_ai_days (
    day date PRIMARY KEY,
    accounted_nano_cny bigint NOT NULL CHECK (accounted_nano_cny >= 0)
  );
  CREATE TABLE IF NOT EXISTS trip_ai_attempts (
    id uuid PRIMARY KEY,
    budget_day date NOT NULL REFERENCES trip_ai_days(day),
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    channel text NOT NULL CHECK (channel IN ('chat', 'interpret')),
    model text NOT NULL,
    tariff_version text NOT NULL,
    state text NOT NULL CHECK (state IN ('pending', 'unknown', 'settled')),
    reserved_nano_cny bigint NOT NULL CHECK (reserved_nano_cny > 0),
    upper_nano_cny bigint CHECK (upper_nano_cny BETWEEN 0 AND reserved_nano_cny),
    estimated_nano_cny bigint CHECK (estimated_nano_cny BETWEEN 0 AND upper_nano_cny),
    rate text,
    cache_hit_tokens integer,
    cache_miss_tokens integer,
    output_tokens integer,
    reasoning_tokens integer
  );
  CREATE INDEX IF NOT EXISTS trip_ai_attempts_day_idx ON trip_ai_attempts (budget_day);
`;

@Injectable()
export class TripAiLedger implements OnModuleDestroy {
  private pool?: Pool;
  private ready?: Promise<unknown>;

  async onModuleDestroy() {
    await this.pool?.end();
  }

  private async query<Row extends QueryResultRow = QueryResultRow>(pool: Pool, operation: Operation, sql: string,
    values?: unknown[]) {
    const start = performance.now();
    let phase: 'connect' | 'query' = 'connect';
    let client;
    let discard = false;
    try {
      client = await pool.connect();
      phase = 'query';
      return await client.query<Row>(sql, values);
    } catch (error) {
      discard = true;
      throw new TripAiLedgerError(operation, phase, error, Math.round(performance.now() - start));
    } finally {
      client?.release(discard);
    }
  }

  private async connect(connectionString: string) {
    // A cold managed Postgres connection may need more time than a SQL statement.
    this.pool ??= new Pool({ connectionString, max: 4, connectionTimeoutMillis: 12_000, statement_timeout: 3000,
      query_timeout: 4000, lock_timeout: 2500 });
    // Idle socket errors must not take down the unmetered flight routes.
    if (!this.pool.listenerCount('error')) this.pool.on('error', () => undefined);
    this.ready ??= this.query(this.pool, 'schema', SCHEMA).catch((err: unknown) => { this.ready = undefined; throw err; });
    await this.ready;
    return this.pool;
  }

  private configuredLimit(operation: 'reserve' | 'summary') {
    try {
      return dailyLimitNanoCny(process.env.TRIP_AI_DAILY_LIMIT_CNY);
    } catch (error) {
      throw new TripAiLedgerError(operation, 'config', error, 0);
    }
  }

  async reserve(connectionString: string, channel: Channel): Promise<Reservation | null> {
    const limit = this.configuredLimit('reserve');
    if (limit < MAX_ATTEMPT_NANO_CNY) return null;
    const pool = await this.connect(connectionString);
    // The upsert rechecks the cap under a row lock; the attempt is inserted only
    // if the allocation succeeded. Both effects commit before the model call.
    const result = await this.query<Reservation>(pool, 'reserve', `
      WITH allocation AS (
        INSERT INTO trip_ai_days (day, accounted_nano_cny)
        VALUES (${BEIJING_DAY}, $1::bigint)
        ON CONFLICT (day) DO UPDATE
          SET accounted_nano_cny = trip_ai_days.accounted_nano_cny + EXCLUDED.accounted_nano_cny
          WHERE trip_ai_days.accounted_nano_cny + EXCLUDED.accounted_nano_cny <= $2::bigint
        RETURNING day
      )
      INSERT INTO trip_ai_attempts (id, budget_day, started_at, channel, model, tariff_version, state, reserved_nano_cny)
      SELECT $3, day, statement_timestamp(), $4, $5, $6, 'pending', $1 FROM allocation
      RETURNING id, started_at AS "startedAt"
    `, [MAX_ATTEMPT_NANO_CNY, limit, randomUUID(), channel, BUDGET_MODEL, TARIFF_VERSION]);
    return result.rows[0] ?? null;
  }

  async settle(connectionString: string, id: string, quote: UsageQuote) {
    const pool = await this.connect(connectionString);
    await this.query(pool, 'settle', `
      WITH receipt AS (
        UPDATE trip_ai_attempts
        SET state = 'settled', finished_at = statement_timestamp(), upper_nano_cny = $2,
          estimated_nano_cny = $3, cache_hit_tokens = $4, cache_miss_tokens = $5, output_tokens = $6,
          reasoning_tokens = $7, rate = $8
        WHERE id = $1 AND state = 'pending'
        RETURNING budget_day, reserved_nano_cny, upper_nano_cny
      )
      UPDATE trip_ai_days AS d SET accounted_nano_cny = d.accounted_nano_cny - r.reserved_nano_cny + r.upper_nano_cny
      FROM receipt AS r WHERE d.day = r.budget_day
    `, [id, quote.upperNanoCny, quote.estimatedNanoCny, quote.cacheHitTokens, quote.cacheMissTokens,
      quote.outputTokens, quote.reasoningTokens, quote.rate]);
  }

  async markUnknown(connectionString: string, id: string) {
    const pool = await this.connect(connectionString);
    await this.query(pool, 'mark-unknown', `UPDATE trip_ai_attempts SET state = 'unknown', finished_at = statement_timestamp()
      WHERE id = $1 AND state = 'pending'`, [id]);
  }

  async summary(connectionString: string) {
    const limitNanoCny = this.configuredLimit('summary');
    const pool = await this.connect(connectionString);
    const { rows: [row] } = await this.query<{
      date: string; accounted: string; estimated: string; pending: number; unknown: number; settled: number;
    }>(pool, 'summary', `
      SELECT ${BEIJING_DAY}::text AS date,
        COALESCE((SELECT accounted_nano_cny FROM trip_ai_days WHERE day = ${BEIJING_DAY}), 0) AS accounted,
        COALESCE(SUM(estimated_nano_cny), 0) AS estimated,
        COUNT(*) FILTER (WHERE state = 'pending' AND started_at > statement_timestamp() - INTERVAL '1 minute')::int AS pending,
        COUNT(*) FILTER (WHERE state = 'unknown' OR
          (state = 'pending' AND started_at <= statement_timestamp() - INTERVAL '1 minute'))::int AS unknown,
        COUNT(*) FILTER (WHERE state = 'settled')::int AS settled
      FROM trip_ai_attempts WHERE budget_day = ${BEIJING_DAY}
    `);
    return { date: row.date, limitNanoCny, accountedNanoCny: Number(row.accounted),
      estimatedNanoCny: Number(row.estimated), pendingAttempts: row.pending, unknownAttempts: row.unknown, settledAttempts: row.settled };
  }
}
