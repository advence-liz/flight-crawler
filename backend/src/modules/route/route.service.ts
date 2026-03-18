import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { FlightService } from '../flight/flight.service';
import { PlanRouteDto } from './dto/plan-route.dto';
import {
  RouteResultDto,
  RoutePlanResponseDto,
  FlightSegmentDto,
} from './dto/route-result.dto';
import { Flight } from '../flight/entities/flight.entity';
import { QueryCache } from './entities/query-cache.entity';

interface GraphNode {
  city: string;
  flights: Flight[];
}

const TRANSFER_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

@Injectable()
export class RouteService {
  private readonly logger = new Logger(RouteService.name);

  constructor(
    private readonly flightService: FlightService,
    @InjectRepository(QueryCache)
    private readonly queryCacheRepository: Repository<QueryCache>,
  ) {}

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
    roundTrip: Array<{ city: string; outboundRoutes: RouteResultDto[]; returnRoutes: RouteResultDto[]; outboundCount: number; returnCount: number }>;
    oneWay: Array<{ city: string; routes: RouteResultDto[]; routeCount: number }>;
    total: number;
  }> {
    const endDate = params.endDate || params.departureDate;
    const maxTransfers = params.maxTransfers ?? 1;
    const minLayoverHours = params.minLayoverHours ?? 2;
    const maxLayoverHours = params.maxLayoverHours ?? 24;

    // 缓存命中检查（DB）
    const cacheKey = `transfer|${params.origin}|${params.departureDate}|${endDate}|${maxTransfers}|${minLayoverHours}|${maxLayoverHours}`;
    const cached = await this.queryCacheRepository.findOne({ where: { cacheKey } });
    if (cached && cached.expireAt > new Date()) {
      this.logger.log(`中转搜索命中 DB 缓存: ${cacheKey}`);
      return JSON.parse(cached.data);
    }

    // 1. 建去程完整图：A 出发的直飞 + 所有一跳中转城市出发的航班
    const firstLegFlights = await this.flightService.queryFlights({
      origin: params.origin,
      startDate: params.departureDate,
      endDate,
    });
    const firstHopCities = new Set<string>();
    for (const f of firstLegFlights) {
      if (f.destination !== params.origin) firstHopCities.add(f.destination);
    }
    const outboundTransitLegsArray = await Promise.all(
      Array.from(firstHopCities).map(city =>
        this.flightService.queryFlights({ origin: city, startDate: params.departureDate, endDate }),
      ),
    );
    const outboundFlights = [...firstLegFlights];
    outboundTransitLegsArray.forEach(legs => outboundFlights.push(...legs));
    const outboundGraph = this.buildGraph(outboundFlights);

    // 2. 收集去程可达的所有目的地（排除起点自身）
    const outboundReachable = new Set<string>();
    for (const [, node] of outboundGraph) {
      for (const f of node.flights) {
        if (f.destination !== params.origin) outboundReachable.add(f.destination);
      }
    }
    const candidateCities = Array.from(outboundReachable);

    this.logger.log(`去程可达 ${candidateCities.length} 个目的地`);

    // 3. 建返程完整图：所有候选目的地出发的航班 + 它们的一跳邻居
    const returnFirstLegsArray = await Promise.all(
      candidateCities.map(city =>
        this.flightService.queryFlights({ origin: city, startDate: params.departureDate, endDate })
          .then(legs => ({ city, legs })),
      ),
    );
    const returnFlightsMap = new Map<string, Flight[]>();
    returnFirstLegsArray.forEach(({ city, legs }) => returnFlightsMap.set(city, legs));

    // 收集返程的中转城市（候选目的地的邻居，且不是起点）
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
    const returnTransitLegsArray = await Promise.all(
      Array.from(returnTransitCities).map(city =>
        this.flightService.queryFlights({ origin: city, startDate: params.departureDate, endDate }),
      ),
    );
    returnTransitLegsArray.forEach(legs => returnAllFlights.push(...legs));
    const returnGraph = this.buildGraph(returnAllFlights);

    // 4. 对每个候选目的地分别搜索去程和返程路径
    const roundTripResults: Array<{ city: string; outboundRoutes: RouteResultDto[]; returnRoutes: RouteResultDto[]; outboundCount: number; returnCount: number }> = [];
    const oneWayResults: Array<{ city: string; routes: RouteResultDto[]; routeCount: number }> = [];

    for (const city of candidateCities) {
      // 去程：origin -> city（允许中转）
      const outboundRoutes = this.findAllRoutes(outboundGraph, params.origin, city, maxTransfers, minLayoverHours, maxLayoverHours);
      if (outboundRoutes.length === 0) continue;
      const scoredOutbound = outboundRoutes.map(r => this.calculateScore(r)).sort((a, b) => b.score - a.score);

      // 返程：city -> origin（允许中转）
      const returnRoutes = this.findAllRoutes(returnGraph, city, params.origin, maxTransfers, minLayoverHours, maxLayoverHours);
      const scoredReturn = returnRoutes.map(r => this.calculateScore(r)).sort((a, b) => b.score - a.score);

      if (scoredReturn.length > 0) {
        roundTripResults.push({
          city,
          outboundRoutes: scoredOutbound.slice(0, 10),
          returnRoutes: scoredReturn.slice(0, 10),
          outboundCount: scoredOutbound.length,
          returnCount: scoredReturn.length,
        });
      } else {
        oneWayResults.push({ city, routes: scoredOutbound.slice(0, 10), routeCount: scoredOutbound.length });
      }
    }

    roundTripResults.sort((a, b) => b.outboundRoutes[0].score - a.outboundRoutes[0].score);
    oneWayResults.sort((a, b) => b.routes[0].score - a.routes[0].score);

    this.logger.log(`中转往返 ${roundTripResults.length} 个，中转单程 ${oneWayResults.length} 个`);

    const result = {
      roundTrip: roundTripResults,
      oneWay: oneWayResults,
      total: roundTripResults.length + oneWayResults.length,
    };

    // 写入 DB 缓存（upsert）
    const expireAt = new Date(Date.now() + TRANSFER_CACHE_TTL_MS);
    await this.queryCacheRepository.save({
      cacheKey,
      data: JSON.stringify(result),
      expireAt,
      createdAt: new Date(),
    });
    this.logger.log(`中转搜索结果已写入 DB 缓存: ${cacheKey}，TTL 10 分钟`);

    return result;
  }

  /**
   * 清除过期的 DB 缓存（可定期调用）
   */
  async cleanExpiredCache(): Promise<void> {
    const result = await this.queryCacheRepository.delete({ expireAt: LessThan(new Date()) });
    this.logger.log(`已清除 ${result.affected ?? 0} 条过期 DB 缓存`);
  }

  /**
   * 清除所有中转搜索缓存（爬虫更新数据后调用）
   */
  async clearTransferCache(): Promise<void> {
    const result = await this.queryCacheRepository.delete({});
    this.logger.log(`已清除 ${result.affected ?? 0} 条 DB 缓存`);
  }
}
