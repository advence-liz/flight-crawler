import { Body, Controller, Get, HttpCode, HttpException, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { FlightMcpQuota } from './flight-mcp-quota';
import { SiteAuthService } from './site-auth.service';
import { AdminGuard } from '../../admin.guard';
import { AiTripService } from './ai-trip.service';
import { DeepSeekTripModel } from './deepseek-trip-model';
import { TripAgentService } from './trip-agent.service';

@Controller('routes/ai-trip')
export class AiTripController {
  constructor(
    private readonly service: AiTripService,
    private readonly model: DeepSeekTripModel,
    private readonly agent: TripAgentService,
    private readonly auth: SiteAuthService,
    private readonly access: FlightMcpQuota,
  ) {}

  @Post('chat')
  @HttpCode(200)
  async chat(@Req() req: Request, @Body() input: unknown) {
    const { id, isAdmin } = await this.auth.user(req, true);
    if (!this.model.enabled()) throw new ServiceUnavailableException('行程助手未启用');
    if (!isAdmin) {
      if (!await this.access.reserveChat(id, 10)) throw new HttpException('今日行程助手额度已用完，北京时间零点重置。', 429);
    }
    return this.agent.chat(input);
  }

  @Get('status')
  status() {
    const enabled = this.model.enabled();
    return { enabled, chatEnabled: enabled };
  }

  @UseGuards(AdminGuard)
  @Post('interpret')
  @HttpCode(200)
  interpret(@Body() input: unknown) {
    return this.service.interpret(input);
  }

  @UseGuards(AdminGuard)
  @Get('usage')
  usage() {
    return this.model.usage();
  }

  @UseGuards(AdminGuard)
  @Post('search')
  @HttpCode(200)
  search(@Body() input: unknown) {
    if (!this.model.searchEnabled()) throw new ServiceUnavailableException('AI 行程规划未启用');
    return this.service.search(input);
  }
}
