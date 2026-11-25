import { BadGatewayException, BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { FlightService } from '../flight/flight.service';
import { aiTripIntent, aiTripRequest, beijingNow, DAY_MS, MAX_SEARCH_DAYS, tripSearchCriteria } from './ai-trip-intent';
import { DeepSeekTripModel } from './deepseek-trip-model';
import { RoundTripService } from './round-trip.service';
import { RouteResultDto } from './dto/route-result.dto';

const stamp = (value: Date | string) => new Date(value).toISOString();
const durationHours = (out: RouteResultDto, back: RouteResultDto) =>
  (new Date(back.segments[0].departureTime).getTime() -
    new Date(out.segments[out.segments.length - 1].arrivalTime).getTime()) / 3_600_000;

@Injectable()
export class AiTripService {
  private searching = false;

  constructor(
    private readonly model: DeepSeekTripModel,
    private readonly flights: FlightService,
    private readonly routes: RoundTripService,
  ) {}

  async interpret(input: unknown) {
    const request = aiTripRequest.safeParse(input);
    if (!request.success) throw new BadRequestException('请输入 1–500 字的出行需求');
    const result = aiTripIntent.safeParse(await this.model.parse(request.data.text, beijingNow()));
    if (!result.success) throw new BadGatewayException('DeepSeek 没能提取有效的行程条件，请换一种表述重试');
    return result.data;
  }

  async search(input: unknown) {
    const result = tripSearchCriteria.safeParse(input);
    if (!result.success) throw new BadRequestException('行程条件格式不正确');
    const { origin, destination, startDate, endDate, card, maxTransfers, maxLeaveDays, minStayHours,
      maxStayHours, departureWeekday, arrivalWeekday, departAfter, arriveBefore, unresolved,
      excludeDestinations, returnDepartAfter } = result.data;
    const excluded = new Set(excludeDestinations ?? []);
    const now = beijingNow();
    if (unresolved.length) throw new BadRequestException('请先重新描述尚未支持或不明确的条件');
    if (!origin || !startDate || !endDate) throw new BadRequestException('请确认出发地与起止日期');
    if (startDate > endDate || startDate < now.slice(0, 10) ||
      (Date.parse(endDate) - Date.parse(startDate)) / DAY_MS >= MAX_SEARCH_DAYS) {
      throw new BadRequestException('请选择从今天起、最多 42 天的有效日期区间');
    }
    if (minStayHours !== null && maxStayHours !== null && minStayHours > maxStayHours) {
      throw new BadRequestException('最短停留时间不能大于最长停留时间');
    }
    if (this.searching) throw new HttpException('航班搜索正在忙，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
    this.searching = true;
    try {
      const [range, { crawledAt }, airportCities] = await Promise.all([
        this.flights.getFlightDateRange(), this.flights.getDataFreshness(), this.flights.getAirportCityMap(),
      ]);
      const airports = new Set([...airportCities.keys(), ...airportCities.values()]);
      if (airports.size && (!airports.has(origin) || (destination && !airports.has(destination)))) {
        throw new BadRequestException('出发地或目的地不在机场库中，请使用城市名或机场全名');
      }
      if (!range.minDate || !range.maxDate || endDate < range.minDate || startDate > range.maxDate) {
        return { coverage: 'none' as const, range, crawledAt, destinations: [] };
      }
      const start = startDate > range.minDate ? startDate : range.minDate;
      const end = endDate < range.maxDate ? endDate : range.maxDate;
      const { destinations } = await this.routes.exploreDestinations({
        origin, departureDate: start, departureDateEnd: end, returnDate: start, returnDateEnd: end,
        maxTransfers, flightType: card ? `${card}权益卡航班` : undefined,
      }, {
        acceptOutbound: (route) => {
          const first = new Date(route.segments[0].departureTime);
          const departure = first.toISOString();
          const arrivalAirport = route.segments[route.segments.length - 1].destination;
          const city = airportCities.get(arrivalAirport);
          return departure >= now && (departureWeekday === null || first.getUTCDay() === departureWeekday)
            && (!departAfter || departure.slice(11, 16) >= departAfter)
            && !excluded.has(arrivalAirport) && (!city || !excluded.has(city))
            && (!destination || arrivalAirport === destination || city === destination);
        },
        acceptReturn: (route) => {
          const last = new Date(route.segments[route.segments.length - 1].arrivalTime);
          const arrival = last.toISOString();
          const returnDeparture = stamp(route.segments[0].departureTime);
          return arrival.slice(0, 10) <= end && (arrivalWeekday === null || last.getUTCDay() === arrivalWeekday)
            && (!arriveBefore || arrival.slice(11, 16) <= arriveBefore)
            && (!returnDepartAfter || returnDeparture.slice(11, 16) >= returnDepartAfter);
        },
        acceptPair: (out, back, leaveDays) => {
          const hours = durationHours(out, back);
          return (maxLeaveDays === null || leaveDays <= maxLeaveDays)
            && (minStayHours === null || hours >= minStayHours) && (maxStayHours === null || hours <= maxStayHours);
        },
      });
      const candidates = destinations.map((item) => ({
        ...item,
        stayMinutes: Math.round(durationHours(item.bestOutbound, item.bestReturn) * 60),
        travelMinutes: item.bestOutbound.totalDuration + item.bestReturn.totalDuration,
      }));
      const picks: Array<(typeof candidates)[number] & { reason: string }> = [];
      const remaining = [...candidates];
      for (const [reason, compare] of [
        ['优先少请假', (a, b) => a.leaveDays - b.leaveDays],
        ['其他目的地中停留最久', (a, b) => b.stayMinutes - a.stayMinutes],
        ['其他目的地中往返耗时最短', (a, b) => a.travelMinutes - b.travelMinutes],
      ] satisfies Array<[string, (a: (typeof candidates)[number], b: (typeof candidates)[number]) => number]>) {
        remaining.sort(compare);
        const next = remaining.shift();
        if (next) picks.push({ ...next, reason });
      }
      return { coverage: start === startDate && end === endDate ? 'full' as const : 'partial' as const,
        range, crawledAt: crawledAt ? stamp(crawledAt) : null, destinations: picks };
    } finally {
      this.searching = false;
    }
  }
}
