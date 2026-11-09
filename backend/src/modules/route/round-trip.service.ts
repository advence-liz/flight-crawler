import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FlightService } from '../flight/flight.service';
import { RouteService } from './route.service';
import { PlanRoundTripDto } from './dto/plan-round-trip.dto';
import {
  RoundTripResultDto,
  RoundTripPlanResponseDto,
} from './dto/round-trip-result.dto';
import { RouteResultDto } from './dto/route-result.dto';
import { ExploreRouteDto } from './dto/explore-route.dto';
import {
  ExploreDestinationDto,
  ExplorePlanResponseDto,
} from './dto/explore-result.dto';
import { QueryCache } from './entities/query-cache.entity';
import { calcLeaveDays } from './utils/leave-days';
import { evaluateTripPattern, TripPattern } from './utils/trip-pattern';
import { readCache, writeCache } from './utils/query-cache';
import { pLimit } from './utils/p-limit';
import {
  pickCandidatesPerDate,
  outboundBucket,
  returnBucket,
} from './utils/route-candidates';

// 探索查询缓存 TTL：6 小时
const EXPLORE_CACHE_TTL_MS = process.env.DISABLE_CACHE === 'true' ? 0 : 6 * 60 * 60 * 1000;

/**
 * 组合往返时，每个出发日保留几条候选。
 * 按日期分组而不是全局取前 N，保证周末/节假日那几天的航班能进入候选池，
 * 否则它们可能因为耗时不占优而被直接淘汰，"周末友好"就无从谈起。
 */
const CANDIDATES_PER_DATE = 2;

/**
 * 往返组合在目的地的最短停留时间。
 * 不做这个约束时，会出现"20:20 落地、21:10 就返程"的假往返——它总耗时最短、
 * 在 0 请假日里评分最高，会被排到第一位，用户点进去发现根本没时间玩。
 */
const MIN_STAY_MS = 4 * 60 * 60 * 1000;

/**
 * 默认排序：请假最少 → 不是当天往返 → 越贴近"下班走/周末回"越靠前 → 综合评分。
 *
 * 第二档很关键：只按请假天数排时，「周六出发周六回」这种当天往返请假 0 天、
 * 总耗时还最短，会牢牢霸占第一名，但没人会把它当成一趟旅行。
 */
function sortByLeaveThenScore(a: RoundTripResultDto, b: RoundTripResultDto): number {
  if (a.leaveDays !== b.leaveDays) return a.leaveDays - b.leaveDays;
  const aSameDay = (a.nights ?? 0) <= 0 ? 1 : 0;
  const bSameDay = (b.nights ?? 0) <= 0 ? 1 : 0;
  if (aSameDay !== bSameDay) return aSameDay - bSameDay;
  if ((a.weekendScore ?? 0) !== (b.weekendScore ?? 0)) {
    return (b.weekendScore ?? 0) - (a.weekendScore ?? 0);
  }
  return b.score - a.score;
}

export class RoundTripService {
  private readonly logger = new Logger(RoundTripService.name);

  constructor(
    private readonly flightService: FlightService,
    private readonly routeService: RouteService,
    @InjectRepository(QueryCache)
    private readonly queryCacheRepository: Repository<QueryCache>,
  ) {}

  /**
   * 规划往返行程
   * - 如果指定目的地：规划指定目的地的往返
   * - 如果不指定目的地：自动发现所有可能的往返方案
   */
  async planRoundTrip(dto: PlanRoundTripDto): Promise<RoundTripPlanResponseDto> {
    if (dto.destination) {
      return this.planSpecificRoundTrip(dto);
    } else {
      return this.planAutoDiscoverRoundTrip(dto);
    }
  }

  /**
   * 规划指定目的地的往返行程
   */
  private async planSpecificRoundTrip(
    dto: PlanRoundTripDto,
  ): Promise<RoundTripPlanResponseDto> {
    this.logger.log(`规划往返行程: ${dto.origin} ⇄ ${dto.destination}`);

    // 1. 规划去程（支持日期范围：范围内任意一天的航班都算）
    const outboundRoutes = await this.routeService.planOneWay({
      origin: dto.origin,
      destination: dto.destination!,
      departureDate: dto.departureDate,
      departureDateEnd: dto.departureDateEnd,
      maxTransfers: dto.maxTransfers || 0,
      minLayoverHours: dto.minLayoverHours || 2,
      maxLayoverHours: dto.maxLayoverHours || 24,
      flightType: dto.flightType,
    });

    // 2. 规划返程（支持日期范围）
    const returnRoutes = await this.routeService.planOneWay({
      origin: dto.destination!,
      destination: dto.origin,
      departureDate: dto.returnDate,
      departureDateEnd: dto.returnDateEnd,
      maxTransfers: dto.maxTransfers || 0,
      minLayoverHours: dto.minLayoverHours || 2,
      maxLayoverHours: dto.maxLayoverHours || 24,
      flightType: dto.flightType,
    });

    // 3. 组合去程和返程
    //    候选按"每个出发日取最优的几条"来挑，而不是全局取前 5——否则周末/假期
    //    那几天的航班可能因为耗时不占优，压根进不了候选池，也就永远排不到前面。
    const outboundCandidates = pickCandidatesPerDate(outboundRoutes, CANDIDATES_PER_DATE, outboundBucket);
    const returnCandidates = pickCandidatesPerDate(returnRoutes, CANDIDATES_PER_DATE, returnBucket);

    const roundTripRoutes: RoundTripResultDto[] = [];
    for (const outbound of outboundCandidates) {
      const lastOutbound = outbound.segments[outbound.segments.length - 1];
      const outboundArrival = new Date(lastOutbound.arrivalTime).getTime();
      for (const returnRoute of returnCandidates) {
        // 返程必须晚于去程落地，且留出足够的停留时间：
        // 否则会组合出"落地 5 分钟就返程"的假往返，还会因为总耗时最短排到第一
        const returnDeparture = new Date(returnRoute.segments[0].departureTime).getTime();
        if (returnDeparture - outboundArrival < MIN_STAY_MS) continue;
        roundTripRoutes.push(this.combineRoutes(outbound, returnRoute));
      }
    }

    // 4. 排序：先按请假成本（越少越好），再按综合评分
    // 停留时长上限（0/不传 = 不限）：避免"停留最久"排序把两个月的行程顶到第一
    const maxStayMinutes = dto.maxStayDays && dto.maxStayDays > 0 ? dto.maxStayDays * 24 * 60 : 0;
    const withinStayLimit = (r: RoundTripResultDto) => !maxStayMinutes || r.stayDuration <= maxStayMinutes;

    // 排序：默认请假最少优先；用户想看长行程时可按停留时长/出发日/总耗时排
    const sortBy = dto.sortBy || 'leave';
    const limit = dto.limit ?? 10;
    const limitedRoutes = roundTripRoutes.filter(withinStayLimit);
    limitedRoutes.sort((a, b) => {
      switch (sortBy) {
        case 'stay':
          return b.stayDuration - a.stayDuration || a.leaveDays - b.leaveDays;
        case 'departure':
          return a.departDate.localeCompare(b.departDate) || a.leaveDays - b.leaveDays;
        case 'duration':
          return a.totalDuration - b.totalDuration || a.leaveDays - b.leaveDays;
        default:
          return sortByLeaveThenScore(a, b);
      }
    });

    this.logger.log(`✅ 找到 ${limitedRoutes.length} 个往返方案（排序: ${sortBy}）`);

    return {
      routes: limitedRoutes.slice(0, limit),
      searchParams: {
        origin: dto.origin,
        destination: dto.destination,
        departureDate: dto.departureDate,
        returnDate: dto.returnDate,
        maxTransfers: dto.maxTransfers || 0,
        autoDiscover: false,
      },
    };
  }

  /**
   * 自动发现所有往返方案
   */
  private async planAutoDiscoverRoundTrip(
    dto: PlanRoundTripDto,
  ): Promise<RoundTripPlanResponseDto> {
    this.logger.log(
      `自动发现往返: ${dto.origin}，${dto.departureDate} 去，${dto.returnDate} 回`,
    );

    // 1. 查询去程所有航班
    //    先把城市名展开成机场名（北京 → 北京首都/北京大兴），否则按城市名精确匹配
    //    永远查不到航班——库里存的是机场名。
    const originAirports = await this.flightService.expandCityToAirports(dto.origin);
    const outboundFlights = await this.flightService.queryFlights({
      origin: originAirports[0],
      origins: originAirports,
      startDate: dto.departureDate,
      endDate: dto.departureDateEnd || dto.departureDate,
    });

    // 2. 提取所有可达目的地（排除本城市的其他机场，如 北京首都 → 北京大兴）
    const originAirportSet = new Set(originAirports);
    const destinations = new Set<string>();
    outboundFlights.forEach((flight) => {
      if (flight.destination && !originAirportSet.has(flight.destination)) {
        destinations.add(flight.destination);
      }
    });

    this.logger.log(`发现 ${destinations.size} 个可达目的地`);

    // 3. 并行规划所有目的地的往返方案（pLimit 限制并发，避免数据库连接耗尽）
    const destList = Array.from(destinations);
    const results = await pLimit(
      destList.map(destination => () =>
        this.planSpecificRoundTrip({ ...dto, destination }).catch((error) => {
          this.logger.warn(`${dto.origin} ⇄ ${destination} 规划失败`, error);
          return null;
        }),
      ), 10);

    // 4. 汇总所有往返方案
    const allRoundTripRoutes: RoundTripResultDto[] = [];
    results.forEach((result) => {
      if (result && result.routes) {
        allRoundTripRoutes.push(...result.routes);
      }
    });

    // 5. 排序：先请假成本、再评分，返回 Top 20
    allRoundTripRoutes.sort(sortByLeaveThenScore);

    this.logger.log(
      `✅ 自动发现完成，共 ${allRoundTripRoutes.length} 个方案，返回 Top 20`,
    );

    return {
      routes: allRoundTripRoutes.slice(0, 20),
      searchParams: {
        origin: dto.origin,
        destination: dto.destination,
        departureDate: dto.departureDate,
        returnDate: dto.returnDate,
        maxTransfers: dto.maxTransfers || 0,
        autoDiscover: true,
      },
    };
  }

  /** YYYY-MM-DD 加一天（UTC 口径，不受进程时区影响） */
  private addOneDay(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  /** 某个时刻的日期（UTC 口径）是否落在 [start, end] 内 */
  private withinWindow(value: Date | string | undefined, start: string, end: string): boolean {
    if (!value) return false;
    const day = new Date(value).toISOString().slice(0, 10);
    return day >= start && day <= end;
  }

  /**
   * 为一个目的地挑出「请假最少、其次评分最高」的去返组合。
   * 探索模式下每个目的地只展示一组代表行程，这组必须是时间上成立、且最省假的。
   */
  private pickBestLeavePair(
    outboundRoutes: RouteResultDto[],
    returnRoutes: RouteResultDto[],
  ): {
    outbound: RouteResultDto;
    return: RouteResultDto;
    score: number;
    leaveDays: number;
    departDate: string;
    returnDate: string;
    nights: number;
    weekendScore: number;
    label: string;
  } | null {
    const outCandidates = pickCandidatesPerDate(outboundRoutes, CANDIDATES_PER_DATE, outboundBucket);
    const retCandidates = pickCandidatesPerDate(returnRoutes, CANDIDATES_PER_DATE, returnBucket);

    let best: {
      outbound: RouteResultDto;
      return: RouteResultDto;
      score: number;
      leaveDays: number;
      departDate: string;
      returnDate: string;
      nights: number;
      weekendScore: number;
      label: string;
    } | null = null;

    for (const outbound of outCandidates) {
      const lastOutbound = outbound.segments[outbound.segments.length - 1];
      const outboundArrival = new Date(lastOutbound.arrivalTime).getTime();

      for (const returnRoute of retCandidates) {
        const returnDeparture = new Date(returnRoute.segments[0].departureTime).getTime();
        if (returnDeparture - outboundArrival < MIN_STAY_MS) continue;

        const firstDeparture = new Date(outbound.segments[0].departureTime);
        const finalArrival = new Date(returnRoute.segments[returnRoute.segments.length - 1].arrivalTime);
        const leave = calcLeaveDays(firstDeparture, finalArrival);
        // 已经找到更省假的组合，这个就不必再算了
        if (best && leave.leaveDays > best.leaveDays) continue;

        const pattern = evaluateTripPattern(
          firstDeparture,
          new Date(returnRoute.segments[0].departureTime),
          finalArrival,
        );
        const score = this.calculateRoundTripScore(
          outbound.totalDuration + returnRoute.totalDuration,
          outbound.transferCount + returnRoute.transferCount,
        );

        // 与 planSpecificRoundTrip 的排序口径保持一致：
        // 请假天数 → 当天往返垫底 → 周末契合度 → 综合评分
        const better =
          !best ||
          leave.leaveDays < best.leaveDays ||
          (leave.leaveDays === best.leaveDays &&
            (pattern.nights > 0) !== (best.nights > 0) &&
            pattern.nights > 0) ||
          (leave.leaveDays === best.leaveDays &&
            (pattern.nights > 0) === (best.nights > 0) &&
            (pattern.weekendScore > best.weekendScore ||
              (pattern.weekendScore === best.weekendScore && score > best.score)));

        if (better) {
          best = {
            outbound,
            return: returnRoute,
            score,
            leaveDays: leave.leaveDays,
            departDate: leave.departDate,
            returnDate: leave.returnDate,
            nights: pattern.nights,
            weekendScore: pattern.weekendScore,
            label: pattern.label,
          };
        }
      }
    }

    return best;
  }

  /**
   * 组合去程和返程，生成往返方案
   */
  private combineRoutes(
    outbound: RouteResultDto,
    returnRoute: RouteResultDto,
  ): RoundTripResultDto {
    const totalDuration = outbound.totalDuration + returnRoute.totalDuration;
    const totalTransferCount = outbound.transferCount + returnRoute.transferCount;

    // 计算综合评分
    const score = this.calculateRoundTripScore(
      totalDuration,
      totalTransferCount,
    );

    // 在目的地停留时长 = 返程起飞 - 去程落地
    const lastOutboundSegment = outbound.segments[outbound.segments.length - 1];
    const firstReturnSegment = returnRoute.segments[0];
    const stayDuration = Math.max(
      0,
      Math.round(
        (new Date(firstReturnSegment.departureTime).getTime()
          - new Date(lastOutboundSegment.arrivalTime).getTime()) / 60000,
      ),
    );

    // 请假成本：首段起飞 → 末段落地
    const firstDeparture = new Date(outbound.segments[0].departureTime);
    const finalArrival = new Date(returnRoute.segments[returnRoute.segments.length - 1].arrivalTime);
    const leave = calcLeaveDays(firstDeparture, finalArrival);

    // 行程形态：过几晚、是不是"下班走周末回"——单纯按请假天数排会选出当天往返
    const pattern = evaluateTripPattern(
      firstDeparture,
      new Date(firstReturnSegment.departureTime),
      finalArrival,
    );

    return {
      outbound: {
        segments: outbound.segments,
        totalDuration: outbound.totalDuration,
        transferCount: outbound.transferCount,
        layovers: outbound.layovers,
      },
      return: {
        segments: returnRoute.segments,
        totalDuration: returnRoute.totalDuration,
        transferCount: returnRoute.transferCount,
        layovers: returnRoute.layovers,
      },
      totalDuration,
      totalTransferCount,
      score,
      stayDuration,
      leaveDays: leave.leaveDays,
      departDate: leave.departDate,
      returnDate: leave.returnDate,
      noLeaveNeeded: leave.noLeaveNeeded,
      nights: pattern.nights,
      weekendScore: pattern.weekendScore,
      patternLabel: pattern.label,
    };
  }

  /**
   * 计算往返行程评分
   * 评分机制：时长权重 70%，中转权重 30%
   */
  private calculateRoundTripScore(
    totalDuration: number,
    totalTransferCount: number,
  ): number {
    // 时长评分（越短越好）- 假设最长 24 小时
    const durationScore =
      Math.max(0, (24 * 60 - totalDuration) / (24 * 60)) * 70;

    // 中转评分（越少越好）- 最多 3 次中转
    const transferScore = Math.max(0, (3 - totalTransferCount) / 3) * 30;

    return durationScore + transferScore;
  }

  /**
   * 探索模式：发现所有能往返的目的地
   * 返回按目的地分组的结果，每个目的地包含最优去程和最优返程
   */
  async exploreDestinations(dto: ExploreRouteDto): Promise<ExplorePlanResponseDto> {
    this.logger.log(
      `探索往返目的地: ${dto.origin}，${dto.departureDate} 去，${dto.returnDate} 回`,
    );

    const maxTransfers = dto.maxTransfers ?? 0;

    // 去程/返程的日期范围（不填结束日期则等于开始日期）
    const departureDateEnd = dto.departureDateEnd || dto.departureDate;
    const returnDateEnd = dto.returnDateEnd || dto.returnDate;

    // 检查 DB 缓存
    // v2：结果里新增了请假成本字段，旧缓存（无这些字段）不能复用
    const cacheKey = `explore-v2|${dto.origin}|${dto.departureDate}|${departureDateEnd}|${dto.returnDate}|${returnDateEnd}|${maxTransfers}|${dto.flightType || 'all'}`;
    const cached = await readCache<ExplorePlanResponseDto>(this.queryCacheRepository, cacheKey);
    if (cached) {
      this.logger.log(`探索查询命中缓存: ${cacheKey}`);
      return cached;
    }

    // 1. 全量加载去程/返程日期范围内所有航班（1次SQL替代N+1）
    const originAirports = await this.flightService.expandCityToAirports(dto.origin);
    const originSet = new Set(originAirports);

    // 多载一天：最后一天晚班起飞、次日转机的跨天中转需要次日的航班。
    // 这些次日的航班只作为"中转腿"使用，最终结果会按首段起飞日期过滤回用户区间。
    const [outboundAllFlights, returnAllFlights] = await Promise.all([
      this.flightService.queryAllFlightsInRange(dto.departureDate, this.addOneDay(departureDateEnd), dto.flightType),
      this.flightService.queryAllFlightsInRange(dto.returnDate, this.addOneDay(returnDateEnd), dto.flightType),
    ]);

    // 2. 内存建去程图（出发机场 + 按 maxTransfers 层数展开可达城市）
    const outboundReachableOrigins = this.routeService.expandReachableOriginsPublic(outboundAllFlights, originAirports, maxTransfers);
    const outboundFiltered = outboundAllFlights.filter(f => outboundReachableOrigins.has(f.origin));
    const outboundGraph = this.routeService.buildGraphPublic(outboundFiltered);

    // 3. 一次DFS得到所有目的地的去程路径
    const outboundByDest = this.routeService.findAllRoutesGroupedByDestPublic(
      outboundGraph, originAirports, originSet, maxTransfers, 2, 24,
    );

    // 多载的次日航班只用于中转腿，出发日期必须落在用户区间内
    const filterOutboundWindow = (routes: RouteResultDto[] | undefined) =>
      (routes ?? []).filter(r => this.withinWindow(r.segments[0]?.departureTime, dto.departureDate, departureDateEnd));
    for (const [dest, routes] of outboundByDest) {
      outboundByDest.set(dest, filterOutboundWindow(routes));
    }

    const candidateCities = Array.from(outboundByDest.keys()).filter(city => (outboundByDest.get(city) ?? []).length > 0);
    this.logger.log(`发现 ${candidateCities.length} 个可达目的地，开始返程搜索`);

    // 4. 内存建返程图（候选目的地 + 按 maxTransfers 层数展开可达城市，出发机场只当返程终点）
    const returnReachableOrigins = this.routeService.expandReachableOriginsPublic(returnAllFlights, candidateCities, maxTransfers, originSet);
    const returnFiltered = returnAllFlights.filter(f => returnReachableOrigins.has(f.origin));
    const returnGraph = this.routeService.buildGraphPublic(returnFiltered);

    // 5. 一次DFS得到所有能回到出发城市的返程路径，按出发城市分组
    const returnByDest = this.routeService.findAllRoutesGroupedByDestPublic(
      returnGraph, candidateCities, new Set(candidateCities), maxTransfers, 2, 24,
    );
    const returnBySrc = new Map<string, RouteResultDto[]>();
    for (const [dest, routes] of returnByDest) {
      if (originAirports.includes(dest)) {
        for (const route of routes) {
          // 返程同样只保留用户区间内出发的
          if (!this.withinWindow(route.segments[0]?.departureTime, dto.returnDate, returnDateEnd)) continue;
          const src = route.segments[0].origin;
          if (!returnBySrc.has(src)) returnBySrc.set(src, []);
          returnBySrc.get(src)!.push(route);
        }
      }
    }

    // 6. 按目的地汇总，计算评分
    const destinations_result: ExploreDestinationDto[] = [];
    for (const city of candidateCities) {
      const outboundRoutes = outboundByDest.get(city) ?? [];
      const returnRoutes = returnBySrc.get(city) ?? [];
      if (outboundRoutes.length === 0 || returnRoutes.length === 0) continue;

      const scoredOut = outboundRoutes.map(r => this.routeService.calculateScorePublic(r)).sort((a, b) => b.score - a.score);
      const scoredRet = returnRoutes.map(r => this.routeService.calculateScorePublic(r)).sort((a, b) => b.score - a.score);

      // 去程/返程不能各挑各的最优：那样时间线可能倒置（返程早于去程落地），
      // 也算不出真实的请假成本。这里按日期组合挑出「请假最少、其次评分最高」的一对。
      const bestPair = this.pickBestLeavePair(scoredOut, scoredRet);
      if (!bestPair) continue;

      destinations_result.push({
        city,
        bestOutbound: bestPair.outbound,
        bestReturn: bestPair.return,
        outboundCount: scoredOut.length,
        returnCount: scoredRet.length,
        score: bestPair.score,
        leaveDays: bestPair.leaveDays,
        departDate: bestPair.departDate,
        returnDate: bestPair.returnDate,
        noLeaveNeeded: bestPair.leaveDays === 0,
        nights: bestPair.nights,
        weekendScore: bestPair.weekendScore,
        patternLabel: bestPair.label,
      });
    }

    // 同城多机场（上海浦东/上海虹桥）合并成一条，展示城市名；
    // 否则列表里会出现"重庆江北"和"重庆"混排，且回填目的地时可能不在下拉选项里
    const airportCityMap = await this.flightService.getAirportCityMap();
    const byCity = new Map<string, ExploreDestinationDto>();
    for (const item of destinations_result) {
      const displayCity = airportCityMap.get(item.city) ?? item.city;
      const existing = byCity.get(displayCity);
      if (!existing) {
        byCity.set(displayCity, { ...item, city: displayCity });
        continue;
      }
      // 方案数累加；代表行程取评分更高的那组
      existing.outboundCount += item.outboundCount;
      existing.returnCount += item.returnCount;
      if (item.score > existing.score) {
        existing.bestOutbound = item.bestOutbound;
        existing.bestReturn = item.bestReturn;
        existing.score = item.score;
        existing.leaveDays = item.leaveDays;
        existing.departDate = item.departDate;
        existing.returnDate = item.returnDate;
        existing.noLeaveNeeded = item.noLeaveNeeded;
      }
    }
    const mergedDestinations = Array.from(byCity.values());

    // 先看请假成本，再按评分——"周末能去哪"应该排在最前面
    mergedDestinations.sort((a, b) => {
      if (a.leaveDays !== b.leaveDays) return a.leaveDays - b.leaveDays;
      return b.score - a.score;
    });
    const top30 = mergedDestinations.slice(0, 30);

    this.logger.log(`✅ 探索完成，找到 ${top30.length} 个可往返目的地`);

    const result: ExplorePlanResponseDto = {
      destinations: top30,
      searchParams: {
        origin: dto.origin,
        departureDate: dto.departureDate,
        returnDate: dto.returnDate,
        maxTransfers,
      },
    };

    // 写入 DB 缓存（失败只丢日志，不影响返回）
    await writeCache(this.queryCacheRepository, cacheKey, result, EXPLORE_CACHE_TTL_MS);
    this.logger.log(`探索结果已缓存，TTL 6h: ${cacheKey}`);

    return result;
  }
}
