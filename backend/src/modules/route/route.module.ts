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

@Module({
  imports: [FlightModule, TypeOrmModule.forFeature([QueryCache])],
  controllers: [RouteController, AiTripController],
  providers: [RouteService, RoundTripService, AiTripService, DeepSeekTripModel],
  exports: [RouteService],
})
export class RouteModule {}
