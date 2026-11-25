import { All, Controller, HttpException, Injectable, Logger, Req, Res } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod/v4';
import { FlightService } from '../flight/flight.service';
import { AiTripService } from './ai-trip.service';
import { FlightMcpQuota, flightMcpDailyLimit, isFlightMcpToken, secondsUntilBeijingMidnight } from './flight-mcp-quota';
import { FlightSitePriority } from './flight-site-priority';
import { beijingNow, DAY_MS, MAX_SEARCH_DAYS } from './ai-trip-intent';

const location = z.string().trim().min(1).max(40).describe('Chinese city or airport name, e.g. 北京 or 北京首都');
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('Beijing time, HH:mm');
const weekday = z.number().int().min(0).max(6).describe('0 = Sunday, 6 = Saturday');
const base = {
  origin: location, startDate: z.iso.date().describe('Inclusive, Beijing date'),
  endDate: z.iso.date().describe('Inclusive; at most 42 days from startDate'),
  card: z.enum(['666', '2666']).optional().describe('Required entitlement card; omit for both'),
};
const flightInput = z.strictObject({ ...base, destination: location, limit: z.number().int().min(1).max(50).optional() });
const tripInput = z.strictObject({
  ...base, destination: location.optional(), maxTransfers: z.literal(0).optional().describe('Direct flights only on this endpoint'),
  maxLeaveDays: z.number().int().min(0).max(42).optional(), minStayHours: z.number().int().min(0).max(1008).optional(),
  maxStayHours: z.number().int().min(0).max(1008).optional(),
  departureWeekday: weekday.optional(), arrivalWeekday: weekday.optional(), departAfter: clock.optional(),
  arriveBefore: clock.optional(), returnDepartAfter: clock.optional(), excludeDestinations: z.array(location).max(10).optional(),
});
const source = { timeZone: 'Asia/Shanghai', inventory: 'snapshot_not_live' } as const;
const serializeFlightTime = (value: Date) => new Date(value).toISOString().replace(/Z$/, '+08:00'); // Flight DB stores Beijing wall time in UTC fields.
const respond = (data: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data,
});
const problem = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });

@Injectable()
export class FlightMcpTools {
  private readonly logger = new Logger(FlightMcpTools.name);

  constructor(private readonly flights: FlightService, private readonly trips: AiTripService) {}

  private async search(input: z.infer<typeof flightInput>) {
    const { origin, destination, startDate, endDate, card, limit = 20 } = input;
    const now = beijingNow();
    if (startDate > endDate || startDate < now.slice(0, 10)
      || (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS >= MAX_SEARCH_DAYS) {
      return problem('Choose a future date range of no more than 42 days.');
    }
    const [range, { crawledAt }, origins, destinations] = await Promise.all([
      this.flights.getFlightDateRange(), this.flights.getDataFreshness(),
      this.flights.expandCityToAirports(origin), this.flights.expandCityToAirports(destination),
    ]);
    const snapshot = { ...source, range, crawledAt };
    if (!range.minDate || !range.maxDate || startDate > range.maxDate || endDate < range.minDate) {
      return respond({ ...snapshot, coverage: 'none', truncated: false, flights: [] });
    }
    const rows = await this.flights.queryFlights({ origin, origins, startDate, endDate,
      flightType: card && `${card}权益卡航班` }, { destinations, notBefore: new Date(now), limit: limit + 1 });
    return respond({ ...snapshot, coverage: startDate < range.minDate || endDate > range.maxDate ? 'partial' : 'full',
      truncated: rows.length > limit, flights: rows.slice(0, limit).map(row => ({
        flightNo: row.flightNo, origin: row.origin, destination: row.destination,
        departureTime: serializeFlightTime(row.departureTime), arrivalTime: serializeFlightTime(row.arrivalTime),
        cards: [...(row.has666Card ? ['666'] : []), ...(row.has2666Card ? ['2666'] : [])],
      })) });
  }

  private async roundTrips(input: z.infer<typeof tripInput>) {
    const { destinations, ...snapshot } = await this.trips.search({
      ...input, destination: input.destination ?? null, card: input.card ?? null, maxTransfers: input.maxTransfers ?? 0,
      maxLeaveDays: input.maxLeaveDays ?? null, minStayHours: input.minStayHours ?? null, maxStayHours: input.maxStayHours ?? null,
      departureWeekday: input.departureWeekday ?? null, arrivalWeekday: input.arrivalWeekday ?? null,
      departAfter: input.departAfter ?? null, arriveBefore: input.arriveBefore ?? null, unresolved: [],
    }, 'mcp');
    const segments = (route: typeof destinations[number]['bestOutbound']) => route.segments.map(leg => ({
      flightNo: leg.flightNo, origin: leg.origin, destination: leg.destination,
      departureTime: serializeFlightTime(leg.departureTime), arrivalTime: serializeFlightTime(leg.arrivalTime),
      cards: (leg.cardType ?? '').split(',').map(label => label.trim()).flatMap(label =>
        label === '666权益卡航班' ? ['666'] : label === '2666权益卡航班' ? ['2666'] : []),
    }));
    return respond({ ...source, ...snapshot, trips: destinations.map(trip => ({ city: trip.city, leaveDays: trip.leaveDays,
      stayMinutes: trip.stayMinutes, travelMinutes: trip.travelMinutes, outbound: segments(trip.bestOutbound),
      inbound: segments(trip.bestReturn) })) });
  }

  private async safe(action: () => Promise<ReturnType<typeof respond> | ReturnType<typeof problem>>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof HttpException && [400, 429].includes(error.getStatus())) return problem(error.message);
      this.logger.warn('Flight MCP query failed');
      return problem('Flight data is temporarily unavailable.');
    }
  }

  createServer() {
    const server = new McpServer({ name: 'suixinfei-flights', version: '1.0.0' });
    const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    server.registerTool('search_flights', { description: 'Find single-direction flights in the latest Suixinfei snapshot. Not live inventory. Coverage none means the date range is not available.', inputSchema: flightInput, annotations },
      input => this.safe(() => this.search(input)));
    server.registerTool('find_round_trips', { description: 'Find up to three grounded round trips in the Suixinfei snapshot. Specify Beijing dates and optional entitlement, leave days and time constraints. Not live inventory.', inputSchema: tripInput, annotations },
      input => this.safe(() => this.roundTrips(input)));
    return server;
  }
}

@Controller('mcp')
export class FlightMcpController {
  private minute = -1;
  private requests = 0;
  private inFlight = 0;
  private toolInFlight = false;
  private readonly logger = new Logger(FlightMcpController.name);

  constructor(private readonly tools: FlightMcpTools, private readonly quota: FlightMcpQuota,
    private readonly site: FlightSitePriority) {}

  @All()
  async handle(@Req() req: Request, @Res() res: Response) {
    const reject = (status: number, message: string, reason?: string) => {
      const id = req.body?.id;
      res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message, ...(reason && { data: { reason } }) },
        id: typeof id === 'number' || typeof id === 'string' ? id : null });
    };
    if (process.env.FLIGHT_MCP_ENABLED !== 'true') return reject(404, 'Flight MCP is not enabled');
    // Pilot only supports server-to-server clients, not browser origins.
    if (req.headers.origin !== undefined) return reject(403, 'Browser origins are not supported');
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    const unauthorized = () => reject(401, 'A valid Flight MCP bearer token is required');
    if (!isFlightMcpToken(token) || token === process.env.ADMIN_TOKEN?.trim()) return unauthorized();
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reject(405, 'Method not allowed');
    }
    if (Array.isArray(req.body)) return reject(400, 'Batch requests are not supported');
    const minute = Math.floor(Date.now() / 60000);
    if (this.minute !== minute) { this.minute = minute; this.requests = 0; }
    const isTool = req.body?.method === 'tools/call';
    if (this.requests >= 30 || this.inFlight >= 2) {
      res.setHeader('Retry-After', this.requests >= 30 ? String(60 - Math.floor(Date.now() / 1000) % 60) : '1');
      return reject(429, 'Flight MCP is busy; retry later', 'rate_limit');
    }
    this.requests++;
    const yieldToSite = () => {
      res.setHeader('Retry-After', '1');
      return reject(429, 'Flight MCP yields to website traffic; retry later', 'site_priority');
    };
    if (isTool && (this.site.busy || this.toolInFlight)) return yieldToSite();
    if (isTool) this.toolInFlight = true;
    this.inFlight++;
    let server: McpServer | undefined;
    try {
      try {
        if (isTool) {
          const limit = flightMcpDailyLimit(process.env.FLIGHT_MCP_DAILY_LIMIT);
          if (limit === null) return reject(503, 'Flight MCP quota is unavailable', 'quota_unavailable');
          const result = await this.quota.take(token, limit);
          if (result === 'unauthorized') return unauthorized();
          if (result === 'daily_quota') {
            res.setHeader('Retry-After', String(secondsUntilBeijingMidnight(Date.now())));
            return reject(429, 'Flight MCP daily quota reached; resets at Beijing midnight', 'daily_quota');
          }
          // A site request may have arrived while reserving the slot.
          if (this.site.busy) return yieldToSite();
        } else if (!await this.quota.authorize(token)) return unauthorized();
      } catch {
        return reject(503, 'Flight MCP access or quota is unavailable', 'quota_unavailable');
      }
      server = this.tools.createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      this.logger.warn('Flight MCP transport failed');
      if (!res.headersSent) reject(500, 'Flight MCP is temporarily unavailable');
    } finally {
      if (isTool) this.toolInFlight = false;
      this.inFlight--;
      await server?.close();
    }
  }
}
