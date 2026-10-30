import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
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

/** 限制并发度的 Promise.all，每次最多同时执行 limit 个 */
async function pLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  const run = async (): Promise<void> => {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, run));
  return results;
}

interface GraphNode {
  city: string;
  flights: Flight[];
}

const TRANSFER_CACHE_TTL_MS = process.env.DISABLE_CACHE === 'true' ? 0 : 24 * 60 * 60 * 1000;

export interface WarmupStatus {
  running: boolean;
  total: number;
  warmed: number;
  skipped: number;
  current: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

@Injectable()
export class RouteService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RouteService.name);

  private warmupStatus: WarmupStatus = {
    running: false,
    total: 0,
    warmed: 0,
    skipped: 0,
    current: null,
    startedAt: null,
    finishedAt: null,
  };

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
    const maxTransfers = dto.maxTransfers ?? 2;

    this.logger.log(`开始规划单程路线: ${dto.origin} -> ${dto.destination || '所有目的地'}`);
    if (isDateRange) {
      this.logger.log(`日期区间: ${dto.departureDate} ~ ${dto.endDate}`);
    }

    // 1. 获取所有相关航班（支持日期区间，城市自动展开为机场）
    const { flights: allFlights, originAirports, destAirports } = await this.getAllRelevantFlights(dto, maxTransfers);

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
          maxTransfers,
        },
      };
    }

    // 2. 构建图
    const graph = this.buildGraph(allFlights);

    // 3. 使用 DFS 查找所有可行路径（多起点 × 多终点）
    const routes = this.findAllRoutesMulti(
      graph,
      originAirports,
      destAirports,
      maxTransfers,
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
        maxTransfers,
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
    flightType?: string;
  }): Promise<RouteResultDto[]> {
    // 跟 planRoute 保持一致：不指定结束日期时自动把搜索窗口多扩 1 天，支持跨天中转
    const endDate = params.departureDateEnd || this.addOneDay(params.departureDate);
    const maxTransfers = params.maxTransfers ?? 2;
    const flightType = params.flightType;

    // 展开城市为机场列表
    const originAirports = await this.flightService.expandCityToAirports(params.origin);
    const destAirports = await this.flightService.expandCityToAirports(params.destination);

    // 按跳数逐层加载航班池，确保图的深度覆盖 maxTransfers 次中转
    const allFlights = await this.loadFlightsByHops(
      originAirports,
      params.departureDate,
      endDate,
      maxTransfers,
      flightType,
    );

    const graph = this.buildGraph(allFlights);
    const routes = this.findAllRoutesMulti(
      graph,
      originAirports,
      destAirports,
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
    maxTransfers: number,
  ): Promise<{ flights: Flight[]; originAirports: string[]; destAirports: string[] }> {
    const startDateStr = dto.departureDate;
    // 不指定结束日期时自动把搜索窗口多扩 1 天，支持跨天中转
    const endDateStr = dto.endDate || this.addOneDay(dto.departureDate);

    // 展开城市为机场列表
    const originAirports = await this.flightService.expandCityToAirports(dto.origin);
    const destAirports = dto.destination
      ? await this.flightService.expandCityToAirports(dto.destination)
      : [];

    const flightType = dto.flightType;

    if (!dto.destination || maxTransfers === 0) {
      // 直飞only：只需起点自身的航班
      const directFlights = await this.flightService.queryFlights({
        origin: originAirports[0],
        origins: originAirports,
        startDate: startDateStr,
        endDate: endDateStr,
        flightType,
      });
      return { flights: directFlights, originAirports, destAirports };
    }

    // 按跳数逐层加载航班池，确保图的深度覆盖 maxTransfers 次中转
    const allFlights = await this.loadFlightsByHops(
      originAirports,
      startDateStr,
      endDateStr,
      maxTransfers,
      flightType,
    );

    return { flights: allFlights, originAirports, destAirports };
  }

  /**
   * 按跳数逐层展开加载航班池：先查起点自身航班，再按 maxTransfers 层数
   * 依次把上一层新出现的城市当出发地继续查，确保建图深度覆盖 maxTransfers
   * 次中转所需的全部航段——否则 DFS 允许走更多段，但图里压根没有更深层
   * 城市的出发航班，搜索会在还没到终点时就因为找不到节点而被截断。
   * 已查过的城市不会重复查询，查询总量有上限（<= 机场总数），不会随层数
   * 指数级增长。
   */
  private async loadFlightsByHops(
    originAirports: string[],
    startDate: string,
    endDate: string,
    maxTransfers: number,
    flightType?: string,
  ): Promise<Flight[]> {
    const firstLegFlights = await this.flightService.queryFlights({
      origin: originAirports[0],
      origins: originAirports,
      startDate,
      endDate,
      flightType,
    });

    const pool: Flight[] = [...firstLegFlights];
    const visited = new Set<string>(originAirports);
    let frontierFlights = firstLegFlights;

    for (let level = 0; level < maxTransfers && frontierFlights.length > 0; level++) {
      const nextCities = new Set<string>();
      for (const f of frontierFlights) {
        if (!visited.has(f.destination)) nextCities.add(f.destination);
      }
      if (nextCities.size === 0) break;
      nextCities.forEach((c) => visited.add(c));

      const legsArray = await pLimit(
        Array.from(nextCities).map(city =>
          () => this.flightService.queryFlights({ origin: city, startDate, endDate, flightType }),
        ), 10);
      frontierFlights = legsArray.flat();
      pool.push(...frontierFlights);
    }

    return pool;
  }

  /** 供 RoundTripService 调用的 public 代理 */
  buildGraphPublic(flights: Flight[]) { return this.buildGraph(flights); }
  findAllRoutesGroupedByDestPublic(...args: Parameters<typeof RouteService.prototype['findAllRoutesGroupedByDest']>) {
    return this.findAllRoutesGroupedByDest(...args);
  }
  calculateScorePublic(route: RouteResultDto) { return this.calculateScore(route); }
  expandReachableOriginsPublic(...args: Parameters<typeof RouteService.prototype['expandReachableOrigins']>) {
    return this.expandReachableOrigins(...args);
  }

  /**
   * 从若干起始城市出发，在已加载的航班列表里按跳数逐层展开"自身出发航班需要
   * 被纳入子图的城市集合"，用于从全量航班中筛出建图所需的子集。
   * excludeFromExpansion 里的城市只会作为到达终点，不会被当成继续展开的
   * 中转枢纽（比如返程图里不该把出发机场自己的出发航班当成中转段）。
   */
  private expandReachableOrigins(
    allFlights: Flight[],
    startCities: string[],
    maxTransfers: number,
    excludeFromExpansion?: Set<string>,
  ): Set<string> {
    const byOrigin = new Map<string, Flight[]>();
    for (const f of allFlights) {
      const list = byOrigin.get(f.origin);
      if (list) list.push(f); else byOrigin.set(f.origin, [f]);
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
    origin: string,
    destination: string,
    maxTransfers: number,
    minLayoverHours: number,
    maxLayoverHours: number,
  ): RouteResultDto[] {
    const routes: RouteResultDto[] = [];
    const visited = new Set<string>();
    const path: Flight[] = [];
    const minLayoverMs = minLayoverHours * 60 * 60 * 1000;
    const maxLayoverMs = maxLayoverHours * 60 * 60 * 1000;

    const dfs = (current: string) => {
      if (current === destination && path.length > 0) {
        routes.push(this.buildRouteResult([...path]));
        return;
      }
      if (path.length > maxTransfers + 1) return;
      if (visited.has(current)) return;

      visited.add(current);
      const node = graph.get(current);
      if (node) {
        for (const flight of node.flights) {
          if (path.length > 0) {
            const lastArrival = path[path.length - 1].arrivalTime.getTime();
            const layoverMs = flight.departureTime.getTime() - lastArrival;
            if (layoverMs < minLayoverMs || layoverMs > maxLayoverMs) continue;
          }
          path.push(flight);
          dfs(flight.destination);
          path.pop();
        }
      }
      visited.delete(current);
    };

    dfs(origin);
    return routes;
  }

  /**
   * 一次 DFS 收集所有目的地的路径，按目的地分组返回（避免对每个目的地单独跑 DFS）
   */
  private findAllRoutesGroupedByDest(
    graph: Map<string, GraphNode>,
    origins: string[],
    excludeOrigins: Set<string>,
    maxTransfers: number,
    minLayoverHours: number,
    maxLayoverHours: number,
  ): Map<string, RouteResultDto[]> {
    const result = new Map<string, RouteResultDto[]>();
    const visited = new Set<string>();
    const path: Flight[] = [];
    const minLayoverMs = minLayoverHours * 60 * 60 * 1000;
    const maxLayoverMs = maxLayoverHours * 60 * 60 * 1000;

    const dfs = (current: string) => {
      if (path.length > 0 && !excludeOrigins.has(current)) {
        // 到达一个非起点城市，记录路径
        if (!result.has(current)) result.set(current, []);
        result.get(current)!.push(this.buildRouteResult([...path]));
      }
      if (path.length >= maxTransfers + 1) return; // 已达最大段数
      if (visited.has(current)) return;

      visited.add(current);
      const node = graph.get(current);
      if (node) {
        for (const flight of node.flights) {
          if (path.length > 0) {
            const lastArrival = path[path.length - 1].arrivalTime.getTime();
            const layoverMs = flight.departureTime.getTime() - lastArrival;
            if (layoverMs < minLayoverMs || layoverMs > maxLayoverMs) continue;
          }
          path.push(flight);
          dfs(flight.destination);
          path.pop();
        }
      }
      visited.delete(current);
    };

    for (const origin of origins) {
      visited.clear();
      dfs(origin);
    }
    return result;
  }

  /**
   * 多起点 × 多终点 DFS（支持城市下多机场）
   */
  private findAllRoutesMulti(
    graph: Map<string, GraphNode>,
    origins: string[],
    destinations: string[],
    maxTransfers: number,
    minLayoverHours: number,
    maxLayoverHours: number,
  ): RouteResultDto[] {
    const destSet = new Set(destinations);
    const routes: RouteResultDto[] = [];
    const visited = new Set<string>();
    const path: Flight[] = [];
    const minLayoverMs = minLayoverHours * 60 * 60 * 1000;
    const maxLayoverMs = maxLayoverHours * 60 * 60 * 1000;

    const dfs = (current: string) => {
      if (destSet.has(current) && path.length > 0) {
        routes.push(this.buildRouteResult([...path]));
        return;
      }
      if (path.length >= maxTransfers + 1) return;
      if (visited.has(current)) return;

      visited.add(current);
      const node = graph.get(current);
      if (node) {
        for (const flight of node.flights) {
          if (path.length > 0) {
            const lastArrival = path[path.length - 1].arrivalTime.getTime();
            const layoverMs = flight.departureTime.getTime() - lastArrival;
            if (layoverMs < minLayoverMs || layoverMs > maxLayoverMs) continue;
          }
          path.push(flight);
          dfs(flight.destination);
          path.pop();
        }
      }
      visited.delete(current);
    };

    for (const origin of origins) {
      visited.clear();
      dfs(origin);
    }
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

  /** 日期字符串（YYYY-MM-DD）加 1 天 */
  private addOneDay(dateStr: string): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
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

    // 1. 一次性加载日期范围内所有航班，内存建图（消除 N+1）
    const originAirports = await this.flightService.expandCityToAirports(params.origin);
    const allFlights = await this.flightService.queryAllFlightsInRange(params.departureDate, endDate);
    this.logger.log(`全量加载航班 ${allFlights.length} 条，开始内存建图`);

    // 去程图：出发城市机场 + 按 maxTransfers 层数展开可达的城市出发的航班
    const originSet = new Set(originAirports);
    const outboundReachableOrigins = this.expandReachableOrigins(allFlights, originAirports, maxTransfers);
    const outboundFlights = allFlights.filter(f => outboundReachableOrigins.has(f.origin));
    const outboundGraph = this.buildGraph(outboundFlights);

    // 2. 收集去程可达的所有目的地（排除出发城市的所有机场）
    const outboundReachable = new Set<string>();
    for (const [, node] of outboundGraph) {
      for (const f of node.flights) {
        if (!originAirports.includes(f.destination)) outboundReachable.add(f.destination);
      }
    }
    const candidateCities = Array.from(outboundReachable);
    this.logger.log(`去程可达 ${candidateCities.length} 个目的地`);

    // 3. 返程图：候选目的地 + 按 maxTransfers 层数展开可达的城市出发的航班
    //    （出发机场只作为返程终点，不当成继续展开的中转枢纽，全量数据已在内存，直接过滤）
    const returnReachableOrigins = this.expandReachableOrigins(allFlights, candidateCities, maxTransfers, originSet);
    const returnFlights = allFlights.filter(f => returnReachableOrigins.has(f.origin));
    const returnGraph = this.buildGraph(returnFlights);

    // 4. 一次 DFS 收集所有目的地路径，按目的地分组

    // 去程：从出发机场出发，一次 DFS 得到所有目的地的路径
    const outboundByDest = this.findAllRoutesGroupedByDest(
      outboundGraph, originAirports, originSet, maxTransfers, minLayoverHours, maxLayoverHours,
    );

    // 返程：从各候选城市出发，一次 DFS 得到能回到出发城市的路径
    const returnByDest = this.findAllRoutesGroupedByDest(
      returnGraph, candidateCities, new Set(candidateCities), maxTransfers, minLayoverHours, maxLayoverHours,
    );
    // returnByDest 的 key 是返程的终点，只保留终点是出发机场的路径
    const returnBySrc = new Map<string, RouteResultDto[]>();
    for (const [dest, routes] of returnByDest) {
      if (originAirports.includes(dest)) {
        // dest 是出发机场，routes 的出发地是候选城市
        for (const route of routes) {
          const src = route.segments[0].origin;
          if (!returnBySrc.has(src)) returnBySrc.set(src, []);
          returnBySrc.get(src)!.push(route);
        }
      }
    }

    const roundTripResults: Array<{ city: string; outboundRoutes: RouteResultDto[]; returnRoutes: RouteResultDto[]; outboundCount: number; returnCount: number }> = [];
    const oneWayResults: Array<{ city: string; routes: RouteResultDto[]; routeCount: number }> = [];

    for (const city of candidateCities) {
      const outboundRoutes = outboundByDest.get(city);
      if (!outboundRoutes?.length) continue;
      const scoredOutbound = outboundRoutes.map(r => this.calculateScore(r)).sort((a, b) => b.score - a.score);

      const returnRoutes = returnBySrc.get(city);
      const scoredReturn = returnRoutes ? returnRoutes.map(r => this.calculateScore(r)).sort((a, b) => b.score - a.score) : [];

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

  /**
   * 按出发地清除 transfer 缓存（定时刷新时使用）
   */
  async clearTransferCacheByOrigin(origin: string): Promise<void> {
    const items = await this.queryCacheRepository
      .createQueryBuilder('c')
      .where('c.cacheKey LIKE :pattern', { pattern: `transfer|${origin}|%` })
      .getMany();
    if (items.length > 0) {
      await this.queryCacheRepository.remove(items);
      this.logger.log(`已清除 ${items.length} 条 ${origin} 的 transfer 缓存`);
    }
  }

  /**
   * 应用启动后不自动预热，避免占用事件循环导致 health check 超时
   * 预热通过数据管理页面手动触发，或 db 中已有缓存数据时自动命中
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('RouteService 已就绪，中转缓存预热可通过数据管理页面手动触发');
  }

  /** 供 Controller 调用的公开预热入口（幂等：已在运行则跳过） */
  warmupTransferCachePublic(): void {
    if (this.warmupStatus.running) {
      this.logger.log('中转缓存预热已在运行中，跳过重复触发');
      return;
    }
    this.warmupTransferCache().catch(err =>
      this.logger.error(`中转缓存预热失败: ${err.message}`),
    );
  }

  /** 查询当前预热进度 */
  getWarmupStatus(): WarmupStatus {
    return { ...this.warmupStatus };
  }

  private async warmupTransferCache(): Promise<void> {
    if (this.warmupStatus.running) return;

    // 等待 3 秒，确保数据库连接完全就绪
    await new Promise(resolve => setTimeout(resolve, 3000));

    const cities = await this.flightService.getAvailableCities();
    const { origins, minDate, maxDate } = cities;

    if (!minDate || !maxDate || origins.length === 0) {
      this.logger.log('中转缓存预热：无航班数据，跳过');
      return;
    }

    this.warmupStatus = {
      running: true,
      total: origins.length,
      warmed: 0,
      skipped: 0,
      current: null,
      startedAt: new Date(),
      finishedAt: null,
    };

    this.logger.log(`中转缓存预热开始：${origins.length} 个出发地，日期 ${minDate} ~ ${maxDate}`);

    for (const origin of origins) {
      this.warmupStatus.current = origin;
      const cacheKey = `transfer|${origin}|${minDate}|${maxDate}|1|2|24`;
      const cached = await this.queryCacheRepository.findOne({ where: { cacheKey } });
      if (cached && cached.expireAt > new Date()) {
        this.warmupStatus.skipped++;
        continue;
      }

      try {
        await this.discoverTransferDestinations({
          origin,
          departureDate: minDate,
          endDate: maxDate,
          maxTransfers: 1,
        });
        this.warmupStatus.warmed++;
        this.logger.log(`预热进度 [${this.warmupStatus.warmed + this.warmupStatus.skipped}/${origins.length}] ${origin} ✓`);
      } catch (err) {
        this.logger.warn(`预热 ${origin} 失败: ${err.message}`);
      }
    }

    this.warmupStatus.running = false;
    this.warmupStatus.current = null;
    this.warmupStatus.finishedAt = new Date();
    this.logger.log(`中转缓存预热完成：新增 ${this.warmupStatus.warmed} 个，跳过 ${this.warmupStatus.skipped} 个（已有缓存）`);
  }
}
