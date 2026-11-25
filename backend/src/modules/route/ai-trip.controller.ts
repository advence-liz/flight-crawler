import { Body, Controller, Get, HttpCode, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
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
  ) {}

  @UseGuards(AdminGuard)
  @Post('chat')
  @HttpCode(200)
  chat(@Body() input: unknown) {
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
