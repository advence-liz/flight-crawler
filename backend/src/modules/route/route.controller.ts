import { Controller, Post, Get, Body, Query, HttpCode, HttpStatus, BadRequestException, UseGuards } from '@nestjs/common';
import { RouteService } from './route.service';
import { RoundTripService } from './round-trip.service';
import { PlanRouteDto } from './dto/plan-route.dto';
import { PlanRoundTripDto } from './dto/plan-round-trip.dto';
import { ExploreRouteDto } from './dto/explore-route.dto';
import { RouteDateWindowDto } from './dto/route-date-window.dto';
import { AdminGuard } from '../../admin.guard';

@Controller('routes')
export class RouteController {
  constructor(
    private readonly routeService: RouteService,
    private readonly roundTripService: RoundTripService,
  ) {}

  /**
   * 规划单程路线
   * POST /api/routes/plan
   */
  @Post('plan')
  @HttpCode(HttpStatus.OK)
  async planRoute(@Body() dto: PlanRouteDto) {
    if (dto.destination && dto.origin === dto.destination) {
      throw new BadRequestException('出发地和目的地不能相同');
    }
    return this.routeService.planRoute(dto);
  }

  /**
   * 规划往返行程（指定目的地）
   * POST /api/routes/round-trip
   */
  @Post('round-trip')
  @HttpCode(HttpStatus.OK)
  async planRoundTrip(@Body() dto: PlanRoundTripDto) {
    return this.roundTripService.planRoundTrip(dto);
  }

  /**
   * 探索模式：发现所有能往返的目的地
   * POST /api/routes/explore
   */
  @Post('explore')
  @HttpCode(HttpStatus.OK)
  async explore(@Body() dto: ExploreRouteDto) {
    return this.roundTripService.exploreDestinations(dto);
  }

  /**
   * 查询某条航线（含中转）真实可飞的日期窗口
   * GET /api/routes/date-window?origin=北京&destination=伊犁伊宁&maxTransfers=1
   *
   * 规划页用它把去程/返程区间对齐到真实有航班的日期
   */
  @Get('date-window')
  async getDateWindow(@Query() dto: RouteDateWindowDto) {
    if (dto.origin === dto.destination) {
      throw new BadRequestException('出发地和目的地不能相同');
    }
    return this.routeService.getDateWindow(dto);
  }

  /**
   * 发现所有通过中转可达但直飞不可达的目的地
   * POST /api/routes/discover-transfer
   */
  @Post('discover-transfer')
  @HttpCode(HttpStatus.OK)
  async discoverTransfer(@Body() body: {
    origin: string;
    departureDate: string;
    endDate?: string;
    maxTransfers?: number;
  }) {
    if (!body.origin || !body.departureDate) {
      throw new BadRequestException('origin 和 departureDate 为必填项');
    }
    return this.routeService.discoverTransferDestinations(body);
  }

  /**
   * 手动触发中转缓存预热（异步，立即返回）
   * POST /api/routes/warmup-cache
   */
  @Post('warmup-cache')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async warmupCache() {
    this.routeService.warmupTransferCachePublic();
    return { message: '缓存预热已触发，正在后台执行' };
  }

  /**
   * 查询缓存预热状态
   * GET /api/routes/warmup-cache/status
   */
  @Get('warmup-cache/status')
  @UseGuards(AdminGuard)
  async warmupCacheStatus() {
    return this.routeService.getWarmupStatus();
  }
}
