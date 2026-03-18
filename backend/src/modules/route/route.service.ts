import { Injectable, Logger } from '@nestjs/common';
import { FlightService } from '../flight/flight.service';
import { PlanRouteDto } from './dto/plan-route.dto';
import {
  RouteResultDto,
  RoutePlanResponseDto,
  FlightSegmentDto,
} from './dto/route-result.dto';
import { Flight } from '../flight/entities/flight.entity';

interface GraphNode {
  city: string;
  flights: Flight[];
}

@Injectable()
export class RouteService {
  private readonly logger = new Logger(RouteService.name);

  constructor(private readonly flightService: FlightService) {}

  /**
   * 规划单程路线（对外接口）
   * - 如果提供 endDate：查询日期区间内的航班
   * - 如果不提供目的地：返回所有直飞航班
   * - 如果提供目的地：使用 DFS 搜索最优路径
   */
  async planRoute(dto: PlanRouteDto): Promise<RoutePlanResponseDto> {
    const isDateRange = !!dto.endDate;

    this.logger.log(`开始规划单程路线: ${dto.origin} -> ${dto.destination || '所有目的地'}`);
    if (isDateRange) {
      this.logger.log(`日期区间: ${dto.departureDate} ~ ${dto.endDate}`);
    }

    // 1. 获取所有相关航班（支持日期区间）
    const allFlights = await this.getAllRelevantFlights(dto);

    // 如果目的地为空，直接返回所有航班
    if (!dto.destination) {
      this.logger.log(`目的地为空，返回所有 ${allFlights.length} 条航班`);
      const directRoutes = allFlights.map(flight => this.buildRouteResult([flight]));
      return {
        routes: directRoutes,
        searchParams: {
          origin: dto.origin,
          destination: dto.destination,
          departureDate: dto.departureDate,
          endDate: dto.endDate,
          maxTransfers: dto.maxTransfers || 2,
        },
      };
    }

    // 2. 构建图
    const graph = this.buildGraph(allFlights);

    // 3. 使用 DFS 查找所有可行路径
    const routes = this.findAllRoutes(
      graph,
      dto.origin,
      dto.destination,
      dto.maxTransfers || 2,
      dto.minLayoverHours || 2,
      dto.maxLayoverHours || 24,
    );

    // 4. 计算评分并排序
    const scoredRoutes = routes.map((route) => this.calculateScore(route));
    scoredRoutes.sort((a, b) => b.score - a.score);

    // 5. 返回 Top 10
    return {
      routes: scoredRoutes.slice(0, 10),
      searchParams: {
        origin: dto.origin,
        destination: dto.destination,
        departureDate: dto.departureDate,
        endDate: dto.endDate,
        maxTransfers: dto.maxTransfers || 2,
      },
    };
  }

  /**
   * 规划单程路线（内部方法，供 RoundTripService 调用）
   * 返回所有可行路径的评分结果
   */
  async planOneWay(params: {
    origin: string;
    destination: string;
    departureDate: string;
    departureDateEnd?: string;
    maxTransfers?: number;
    minLayoverHours?: number;
    maxLayoverHours?: number;
  }): Promise<RouteResultDto[]> {
    const endDate = params.departureDateEnd || params.departureDate;
    const maxTransfers = params.maxTransfers ?? 2;

    // 查起点出发的所有航班
    const firstLegFlights = await this.flightService.queryFlights({
      origin: params.origin,
      startDate: params.departureDate,
      endDate,
    });

    const allFlights = [...firstLegFlights];

    if (maxTransfers > 0) {
      // 查中转城市出发的航班
      const transitCities = new Set<string>();
      for (const f of firstLegFlights) {
        if (f.destination !== params.origin) {
          transitCities.add(f.destination);
        }
      }
      for (const city of transitCities) {
        const legs = await this.flightService.queryFlights({
          origin: city,
          startDate: params.departureDate,
          endDate,
        });
        allFlights.push(...legs);
      }
    }

    const graph = this.buildGraph(allFlights);
    const routes = this.findAllRoutes(
      graph,
      params.origin,
      params.destination,
      maxTransfers,
      params.minLayoverHours ?? 2,
      params.maxLayoverHours ?? 24,
    );

    const scoredRoutes = routes.map((route) => this.calculateScore(route));
    scoredRoutes.sort((a, b) => b.score - a.score);

    return scoredRoutes;
  }

  /**
   * 获取所有相关航班（用于路径搜索）
   * 注意：不传 destination，查询起点出发的所有航班，以及后续中转城市的航班
   */
  private async getAllRelevantFlights(
    dto: PlanRouteDto,
  ): Promise<Flight[]> {
    const startDate = new Date(dto.departureDate);
    let endDate: Date;

    if (dto.endDate) {
      endDate = new Date(dto.endDate);
    } else {
      // 查询当天和次日，支持跨天中转
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
    }

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // 第一步：查询起点出发的所有航班（不过滤 destination）
    const firstLegFlights = await this.flightService.queryFlights({
      origin: dto.origin,
      startDate: startDateStr,
      endDate: endDateStr,
    });

    if (!dto.destination || dto.maxTransfers === 0) {
      // 无目的地或不允许中转：只返回直飞
      return firstLegFlights;
    }

    // 第二步：收集所有中转城市，查询它们出发的航班
    const transitCities = new Set<string>();
    for (const f of firstLegFlights) {
      if (f.destination !== dto.origin) {
        transitCities.add(f.destination);
      }
    }

    const allFlights = [...firstLegFlights];
    for (const city of transitCities) {
      const legs = await this.flightService.queryFlights({
        origin: city,
        startDate: startDateStr,
        endDate: endDateStr,
      });
      allFlights.push(...legs);
    }

    return allFlights;
  }

  /**
   * 构建航班图
   */
  private buildGraph(flights: Flight[]): Map<string, GraphNode> {
    const graph = new Map<string, GraphNode>();

    flights.forEach((flight) => {
      if (!graph.has(flight.origin)) {
        graph.set(flight.origin, { city: flight.origin, flights: [] });
      }
      graph.get(flight.origin)!.flights.push(flight);
    });

    return graph;
  }

  /**
   * 查找所有可行路径（DFS）
   */
  private findAllRoutes(
    graph: Map<string, GraphNode>,
    current: string,
    destination: string,
    maxTransfers: number,
    minLayoverHours: number,
    maxLayoverHours: number,
    currentPath: Flight[] = [],
    visited: Set<string> = new Set(),
  ): RouteResultDto[] {
    const routes: RouteResultDto[] = [];

    // 到达目的地
    if (current === destination && currentPath.length > 0) {
      routes.push(this.buildRouteResult(currentPath));
      return routes;
    }

    // 超过最大中转次数
    if (currentPath.length > maxTransfers + 1) {
      return routes;
    }

    // 防止循环
    if (visited.has(current)) {
      return routes;
    }

    visited.add(current);

    const node = graph.get(current);
    if (!node) {
      visited.delete(current);
      return routes;
    }

    // 遍历所有可用航班
    for (const flight of node.flights) {
      // 检查中转时间是否合理
      if (currentPath.length > 0) {
        const lastFlight = currentPath[currentPath.length - 1];
        const layoverMinutes = this.calculateLayover(lastFlight, flight);

        if (
          layoverMinutes < minLayoverHours * 60 ||
          layoverMinutes > maxLayoverHours * 60
        ) {
          continue;
        }
      }

      // 递归搜索
      const subRoutes = this.findAllRoutes(
        graph,
        flight.destination,
        destination,
        maxTransfers,
        minLayoverHours,
        maxLayoverHours,
        [...currentPath, flight],
        new Set(visited),
      );

      routes.push(...subRoutes);
    }

    visited.delete(current);
    return routes;
  }

  /**
   * 构建路线结果
   */
  private buildRouteResult(flights: Flight[]): RouteResultDto {
    const segments: FlightSegmentDto[] = flights.map((flight) => ({
      flightNo: flight.flightNo,
      origin: flight.origin,
      destination: flight.destination,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      duration: this.calculateDuration(
        flight.departureTime,
        flight.arrivalTime,
      ),
    }));

    const layovers = [];
    for (let i = 0; i < flights.length - 1; i++) {
      layovers.push({
        city: flights[i].destination,
        duration: this.calculateLayover(flights[i], flights[i + 1]),
      });
    }

    const totalDuration = this.calculateDuration(
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

  /**
   * 计算评分
   */
  private calculateScore(route: RouteResultDto): RouteResultDto {
    // 评分因素：
    // 1. 总耗时（越短越好）- 权重 70%
    // 2. 中转次数（越少越好）- 权重 30%

    const timeScore = 1000 / (route.totalDuration / 60); // 时间权重
    const transferScore = 100 / (route.transferCount + 1); // 中转权重

    route.score = timeScore * 0.7 + transferScore * 0.3;

    return route;
  }

  /**
   * 计算航班时长（分钟）
   */
  private calculateDuration(start: Date, end: Date): number {
    return Math.floor((end.getTime() - start.getTime()) / 1000 / 60);
  }

  /**
   * 计算中转时间（分钟）
   */
  private calculateLayover(flight1: Flight, flight2: Flight): number {
    return this.calculateDuration(flight1.arrivalTime, flight2.departureTime);
  }

  /**
   * 发现所有通过中转可达但直飞不可达的目的地，区分中转往返和中转单程
   * POST /api/routes/discover-transfer
   */
  async discoverTransferDestinations(params: {
    origin: string;
    departureDate: string;
    endDate?: string;
    maxTransfers?: number;
    minLayoverHours?: number;
    maxLayoverHours?: number;
  }): Promise<{
    roundTrip: Array<{ city: string; bestOutbound: RouteResultDto; bestReturn: RouteResultDto; outboundCount: number; returnCount: number }>;
    oneWay: Array<{ city: string; bestRoute: RouteResultDto; routeCount: number }>;
    total: number;
  }> {
    const endDate = params.endDate || params.departureDate;
    const maxTransfers = params.maxTransfers ?? 1;
    const minLayoverHours = params.minLayoverHours ?? 2;
    const maxLayoverHours = params.maxLayoverHours ?? 24;

    // 1. 查询起点直飞目的地（用于排除）
    const directFlights = await this.flightService.queryFlights({
      origin: params.origin,
      startDate: params.departureDate,
      endDate,
    });
    const directDestinations = new Set(directFlights.map(f => f.destination));

    // 2. 建去程完整图（起点 + 中转城市）
    const transitCities = new Set<string>();
    for (const f of directFlights) {
      if (f.destination !== params.origin) transitCities.add(f.destination);
    }
    const outboundFlights = [...directFlights];
    for (const city of transitCities) {
      const legs = await this.flightService.queryFlights({ origin: city, startDate: params.departureDate, endDate });
      outboundFlights.push(...legs);
    }
    const outboundGraph = this.buildGraph(outboundFlights);

    // 3. 收集所有中转可达目的地（排除直飞和起点）
    const reachableCities = new Set<string>();
    for (const [, node] of outboundGraph) {
      for (const f of node.flights) {
        if (f.destination !== params.origin) reachableCities.add(f.destination);
      }
    }
    const transferOnlyCities = Array.from(reachableCities).filter(
      city => !directDestinations.has(city) && city !== params.origin,
    );

    this.logger.log(`中转可达 ${transferOnlyCities.length} 个目的地（直飞 ${directDestinations.size} 个）`);

    // 4. 为每个中转目的地建返程图（city -> origin）
    // 预先查各目的地出发的航班，合并后建图，DFS 找回 origin 的路径
    const returnFlightsMap = new Map<string, Flight[]>();
    for (const city of transferOnlyCities) {
      const legs = await this.flightService.queryFlights({ origin: city, startDate: params.departureDate, endDate });
      returnFlightsMap.set(city, legs);
    }
    // 还需要查中转城市（目的地的邻居）出发的航班
    const returnTransitCities = new Set<string>();
    for (const legs of returnFlightsMap.values()) {
      for (const f of legs) {
        if (!returnFlightsMap.has(f.destination) && f.destination !== params.origin) {
          returnTransitCities.add(f.destination);
        }
      }
    }
    const returnAllFlights: Flight[] = [];
    for (const legs of returnFlightsMap.values()) returnAllFlights.push(...legs);
    for (const city of returnTransitCities) {
      const legs = await this.flightService.queryFlights({ origin: city, startDate: params.departureDate, endDate });
      returnAllFlights.push(...legs);
    }
    const returnGraph = this.buildGraph(returnAllFlights);

    // 5. 对每个中转目的地分别搜索去程和返程路径
    const roundTripResults: Array<{ city: string; bestOutbound: RouteResultDto; bestReturn: RouteResultDto; outboundCount: number; returnCount: number }> = [];
    const oneWayResults: Array<{ city: string; bestRoute: RouteResultDto; routeCount: number }> = [];

    for (const city of transferOnlyCities) {
      // 去程：origin -> city（中转）
      const outboundRoutes = this.findAllRoutes(outboundGraph, params.origin, city, maxTransfers, minLayoverHours, maxLayoverHours);
      if (outboundRoutes.length === 0) continue;
      const scoredOutbound = outboundRoutes.map(r => this.calculateScore(r)).sort((a, b) => b.score - a.score);

      // 返程：city -> origin（中转）
      const returnRoutes = this.findAllRoutes(returnGraph, city, params.origin, maxTransfers, minLayoverHours, maxLayoverHours);
      const scoredReturn = returnRoutes.map(r => this.calculateScore(r)).sort((a, b) => b.score - a.score);

      if (scoredReturn.length > 0) {
        roundTripResults.push({
          city,
          bestOutbound: scoredOutbound[0],
          bestReturn: scoredReturn[0],
          outboundCount: scoredOutbound.length,
          returnCount: scoredReturn.length,
        });
      } else {
        oneWayResults.push({ city, bestRoute: scoredOutbound[0], routeCount: scoredOutbound.length });
      }
    }

    roundTripResults.sort((a, b) => b.bestOutbound.score - a.bestOutbound.score);
    oneWayResults.sort((a, b) => b.bestRoute.score - a.bestRoute.score);

    this.logger.log(`中转往返 ${roundTripResults.length} 个，中转单程 ${oneWayResults.length} 个`);

    return {
      roundTrip: roundTripResults,
      oneWay: oneWayResults,
      total: roundTripResults.length + oneWayResults.length,
    };
  }
}
