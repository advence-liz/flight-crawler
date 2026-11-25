import type { Repository } from 'typeorm';
import type { Flight } from '../flight/entities/flight.entity';
import type { FlightService } from '../flight/flight.service';
import type { QueryCache } from './entities/query-cache.entity';
import { RouteService } from './route.service';
import { buildGraph, firstDepartureAtOrAfter } from './utils/flight-graph';

const flight = (origin: string, destination: string, name: string, depart: string, arrive: string) => ({
  origin, destination, flightNo: name, departureTime: new Date(depart), arrivalTime: new Date(arrive),
} as Flight);

const flights = [
  flight('A', 'B', 'AB', '2026-12-01T20:00:00Z', '2026-12-01T22:00:00Z'),
  flight('A', 'C', 'AC', '2026-12-01T21:00:00Z', '2026-12-01T23:00:00Z'),
  flight('B', 'C', 'BC', '2026-12-02T00:00:00Z', '2026-12-02T02:00:00Z'),
  flight('B', 'D', 'BD', '2026-12-02T00:00:00Z', '2026-12-02T02:00:00Z'),
  flight('C', 'D', 'CD', '2026-12-02T04:00:00Z', '2026-12-02T06:00:00Z'),
  flight('C', 'B', 'CB', '2026-12-02T04:00:00Z', '2026-12-02T06:00:00Z'),
  flight('D', 'F', 'DF', '2026-12-02T08:00:00Z', '2026-12-02T10:00:00Z'),
];

function planner() {
  const queryFlights = jest.fn(async ({ origin, origins }: { origin: string; origins?: string[] }) =>
    flights.filter(row => (origins ?? [origin]).includes(row.origin)));
  const service = new RouteService({
    queryFlights, expandCityToAirports: async (city: string) => [city],
  } as unknown as FlightService, {} as Repository<QueryCache>);
  return { service, queryFlights };
}

it('batches each frontier while preserving cross-midnight routes and the requested card filter', async () => {
  const { service, queryFlights } = planner();
  const result = await service.planOneWay({ origin: 'A', destination: 'F', departureDate: '2026-12-01',
    maxTransfers: 2, flightType: '666权益卡航班' });
  expect(result.map(route => route.segments.map(segment => segment.flightNo))).toEqual([['AC', 'CD', 'DF'], ['AB', 'BD', 'DF']]);
  expect(queryFlights.mock.calls.map(([dto]) => dto.origins)).toEqual([['A'], ['B', 'C'], ['D']]);
  for (const [dto] of queryFlights.mock.calls) {
    expect(dto).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-02', flightType: '666权益卡航班' });
  }
});

it('collects only requested destinations without changing their paths or order', () => {
  const { service } = planner();
  const graph = buildGraph(flights);
  const args = [graph, ['A'] as string[], new Set(['A']), 2, 2, 24] as const;
  const all = service.findAllRoutesGroupedByDestPublic(...args);
  const focused = service.findAllRoutesGroupedByDestPublic(...args, new Set(['D', 'F']));
  expect([...focused]).toEqual([...all].filter(([destination]) => destination === 'D' || destination === 'F'));
  expect(focused.get('F')).toHaveLength(2);
});

it('indexes departures in chronological order and keeps the lower bound inclusive', () => {
  const graph = buildGraph([...flights].reverse());
  const outgoing = graph.get('A')!.flights;
  expect(outgoing.map(row => row.flightNo)).toEqual(['AB', 'AC']);
  expect(firstDepartureAtOrAfter(outgoing, Date.parse('2026-12-01T21:00:00Z'))).toBe(1);
  expect(firstDepartureAtOrAfter(outgoing, Date.parse('2026-12-01T21:00:00.001Z'))).toBe(2);
});
