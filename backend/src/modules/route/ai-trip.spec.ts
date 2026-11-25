import { BadRequestException } from '@nestjs/common';
import { AiTripService } from './ai-trip.service';
import { DeepSeekTripModel } from './deepseek-trip-model';
import { FlightService } from '../flight/flight.service';
import { RoundTripService } from './round-trip.service';
import { RouteResultDto } from './dto/route-result.dto';

const intent = {
  origin: '上海', destination: null, startDate: '2026-12-01', endDate: '2026-12-20',
  card: '666', maxTransfers: 0, maxLeaveDays: 0, minStayHours: 30, maxStayHours: 72,
  departureWeekday: 5, arrivalWeekday: 0, departAfter: '18:00', arriveBefore: '22:00',
  unresolved: [],
};

function route(departure: string, arrival: string, origin: string, destination: string): RouteResultDto {
  return { totalDuration: 60, transferCount: 0, layovers: [], score: 1, segments: [{
    flightNo: 'HU1234', origin, destination, duration: 60,
    departureTime: new Date(departure), arrivalTime: new Date(arrival),
  }] };
}

const out = route('2026-12-04T18:30Z', '2026-12-04T19:30Z', '上海浦东', '海口');
const back = route('2026-12-06T19:30Z', '2026-12-06T20:30Z', '海口', '上海浦东');

function setup() {
  const model = { parse: jest.fn().mockResolvedValue(intent) };
  const flights = {
    getFlightDateRange: jest.fn().mockResolvedValue({ minDate: '2026-12-01', maxDate: '2026-12-10' }),
    getDataFreshness: jest.fn().mockResolvedValue({ crawledAt: '2026-11-30T00:00:00Z' }),
    getAirportCityMap: jest.fn().mockResolvedValue(new Map([['上海浦东', '上海'], ['海口', '海口']])),
  };
  const routes = { exploreDestinations: jest.fn().mockResolvedValue({ destinations: [] }) };
  const service = new AiTripService(model as unknown as DeepSeekTripModel, flights as unknown as FlightService,
    routes as unknown as RoundTripService);
  return { service, model, routes, flights };
}

describe('AI trip planning', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-30T10:00Z')));
  afterEach(() => jest.useRealTimers());

  it('validates model output and never searches before confirmation', async () => {
    const { service, model, routes } = setup();
    await expect(service.interpret({ text: '上海出发，周末玩两天' })).resolves.toEqual(intent);
    expect(routes.exploreDestinations).not.toHaveBeenCalled();
    model.parse.mockResolvedValueOnce({ ...intent, flightNo: 'HU9999' });
    await expect(service.interpret({ text: '编一个航班' })).rejects.toMatchObject({ status: 502 });
  });

  it('rejects invalid dates and unresolved constraints before searching', async () => {
    const { service, routes } = setup();
    await expect(service.search({ ...intent, endDate: '2026-12-32' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.search({ ...intent, unresolved: ['目的地要暖和'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(routes.exploreDestinations).not.toHaveBeenCalled();
  });

  it('returns a distinct no-data response and does not call the planner', async () => {
    const { service, routes } = setup();
    await expect(service.search({ ...intent, startDate: '2026-12-12' })).resolves.toMatchObject({ coverage: 'none', destinations: [] });
    expect(routes.exploreDestinations).not.toHaveBeenCalled();
  });

  it('enforces destination exclusions at city and airport level and a separate return takeoff cutoff', async () => {
    const { service, flights, routes } = setup();
    flights.getAirportCityMap.mockResolvedValue(new Map([['上海浦东', '上海'], ['北京首都', '北京']]));
    await service.search({ ...intent, excludeDestinations: ['北京'], returnDepartAfter: '20:00' });
    const [, filter] = routes.exploreDestinations.mock.calls[0];
    expect(filter.acceptOutbound(route('2026-12-04T18:30Z', '2026-12-04T19:30Z', '上海浦东', '北京首都'))).toBe(false);
    expect(filter.acceptOutbound(out)).toBe(true);
    expect(filter.acceptReturn(back)).toBe(false);
    expect(filter.acceptReturn(route('2026-12-06T20:00Z', '2026-12-06T21:00Z', '海口', '上海浦东'))).toBe(true);
  });

  it('preserves hard constraints before the planner ranks candidates', async () => {
    const { service, model, routes } = setup();
    await expect(service.search(intent)).resolves.toMatchObject({ coverage: 'partial', destinations: [] });
    expect(model.parse).not.toHaveBeenCalled();
    const [dto, filter] = routes.exploreDestinations.mock.calls[0];
    expect(dto).toMatchObject({ departureDate: '2026-12-01', returnDateEnd: '2026-12-10', maxTransfers: 0, flightType: '666权益卡航班' });
    expect(filter.acceptOutbound(out)).toBe(true);
    expect(filter.acceptOutbound(route('2026-12-04T17:59Z', '2026-12-04T19:00Z', '上海浦东', '海口'))).toBe(false);
    expect(filter.acceptReturn(back)).toBe(true);
    expect(filter.acceptReturn(route('2026-12-06T21:00Z', '2026-12-07T00:01Z', '海口', '上海浦东'))).toBe(false);
    expect(filter.acceptPair(out, back, 0)).toBe(true);
    expect(filter.acceptPair(out, back, 1)).toBe(false);
    expect(filter.acceptPair(out, route('2026-12-05T19:30Z', '2026-12-05T20:30Z', '海口', '上海浦东'), 0)).toBe(false);
  });
});
