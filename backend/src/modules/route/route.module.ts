import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RouteService } from './route.service';
import { RoundTripService } from './round-trip.service';
import { RouteController } from './route.controller';
import { FlightModule } from '../flight/flight.module';
import { QueryCache } from './entities/query-cache.entity';
import { AiTripController } from './ai-trip.controller';
import { AiTripService } from './ai-trip.service';
import { DeepSeekTripModel } from './deepseek-trip-model';
import { TripAgentService } from './trip-agent.service';
import { TripAiBudget } from './trip-ai-budget';
import { TripAiLedger } from './trip-ai-ledger';
import { FlightMcpController, FlightMcpTools } from './flight-mcp.controller';
import { FlightMcpUsersController } from './flight-mcp-users.controller';
import { FlightSitePriority } from './flight-site-priority';
import { SiteAccountController } from './site-account.controller';

@Module({
  imports: [FlightModule, TypeOrmModule.forFeature([QueryCache])],
  controllers: [RouteController, AiTripController, FlightMcpController, FlightMcpUsersController, SiteAccountController],
  providers: [RouteService, RoundTripService, AiTripService, DeepSeekTripModel, TripAgentService, TripAiBudget, TripAiLedger, FlightMcpTools, FlightSitePriority],
  exports: [RouteService, FlightSitePriority],
})
export class RouteModule {}
