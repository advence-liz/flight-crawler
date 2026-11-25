import { Body, Controller, Get, HttpCode, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../admin.guard';
import { AiTripService } from './ai-trip.service';
import { DeepSeekTripModel } from './deepseek-trip-model';

@Controller('routes/ai-trip')
export class AiTripController {
  constructor(private readonly service: AiTripService, private readonly model: DeepSeekTripModel) {}

  @Get('status')
  status() {
    return { enabled: this.model.enabled() };
  }

  @UseGuards(AdminGuard)
  @Post('interpret')
  @HttpCode(200)
  interpret(@Body() input: unknown) {
    return this.service.interpret(input);
  }

  @UseGuards(AdminGuard)
  @Post('search')
  @HttpCode(200)
  search(@Body() input: unknown) {
    if (!this.model.enabled()) throw new ServiceUnavailableException('AI 行程规划未启用');
    return this.service.search(input);
  }
}
