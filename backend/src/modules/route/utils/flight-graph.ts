import { Flight } from '../../flight/entities/flight.entity';
import { RouteResultDto, FlightSegmentDto } from '../dto/route-result.dto';

/**
 * 航班图的纯函数工具。
 * 从 route.service 抽出来：不依赖任何注入、可单独测试，也让 service 只留编排逻辑。
 */

export interface GraphNode {
  city: string;
  flights: Flight[];
}

/** 构建航班图：节点是城市，边是该城市出发的航班 */
export function buildGraph(flights: Flight[]): Map<string, GraphNode> {
  const graph = new Map<string, GraphNode>();
  for (const flight of flights) {
    if (!graph.has(flight.origin)) {
      graph.set(flight.origin, { city: flight.origin, flights: [] });
    }
    graph.get(flight.origin)!.flights.push(flight);
  }
  return graph;
}

/**
 * 从若干起始城市出发，在已加载的航班列表里按跳数逐层展开
 * "自身出发航班需要被纳入子图的城市集合"。
 * excludeFromExpansion 里的城市只会作为到达终点，不会被当成继续展开的中转枢纽。
 */
export function expandReachableOrigins(
  allFlights: Flight[],
  startCities: string[],
  maxTransfers: number,
  excludeFromExpansion?: Set<string>,
): Set<string> {
  const byOrigin = new Map<string, Flight[]>();
  for (const f of allFlights) {
    const list = byOrigin.get(f.origin);
    if (list) list.push(f);
    else byOrigin.set(f.origin, [f]);
  }

  const reachable = new Set<string>(startCities);
  let frontier = startCities;
  for (let level = 0; level < maxTransfers; level++) {
    const next = new Set<string>();
    for (const city of frontier) {
      for (const f of byOrigin.get(city) ?? []) {
        if (!reachable.has(f.destination) && !excludeFromExpansion?.has(f.destination)) {
          next.add(f.destination);
        }
      }
    }
    if (next.size === 0) break;
    next.forEach((c) => reachable.add(c));
    frontier = Array.from(next);
  }
  return reachable;
}

/** 计算航班时长（分钟） */
export function calculateDuration(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 1000 / 60);
}

/** 计算中转时间（分钟） */
export function calculateLayover(flight1: Flight, flight2: Flight): number {
  return calculateDuration(flight1.arrivalTime, flight2.departureTime);
}

/** 把一串航段组装成路线结果（评分由调用方计算） */
export function buildRouteResult(flights: Flight[]): RouteResultDto {
  const segments: FlightSegmentDto[] = flights.map((flight) => ({
    flightNo: flight.flightNo,
    origin: flight.origin,
    destination: flight.destination,
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    duration: calculateDuration(flight.departureTime, flight.arrivalTime),
    cardType: flight.cardType,
  }));

  const layovers = [];
  for (let i = 0; i < flights.length - 1; i++) {
    layovers.push({
      city: flights[i].destination,
      duration: calculateLayover(flights[i], flights[i + 1]),
    });
  }

  const totalDuration = calculateDuration(
    flights[0].departureTime,
    flights[flights.length - 1].arrivalTime,
  );

  return {
    segments,
    totalDuration,
    transferCount: flights.length - 1,
    layovers,
    score: 0, // 稍后计算
  };
}
