import { Module, NestModule, MiddlewareConsumer, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { HttpLoggerMiddleware } from './http-logger.middleware';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { FlightModule } from './modules/flight/flight.module';
import { CrawlerModule } from './modules/crawler/crawler.module';
import { RouteModule } from './modules/route/route.module';
import { winstonConfig } from './config/logger.config';

@Module({
  controllers: [AppController],
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Winston 日志模块
    WinstonModule.forRoot(winstonConfig),

    // 数据库模块
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.DB_DATABASE || './data/flight-crawler.db',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true, // 生产环境应设为 false
      logging: process.env.NODE_ENV === 'development',
    }),

    // 定时任务模块
    ScheduleModule.forRoot(),

    // 业务模块
    FlightModule,
    CrawlerModule,
    RouteModule,
  ],
})
export class AppModule implements NestModule, OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  // 默认的 rollback journal 模式每次写事务都要走"建日志→写数据→fsync→删日志"多次 fsync，
  // 在 Render 免费套餐这种慢磁盘环境下会显著拖慢 query_cache 的写入（缓存未命中时的查询因此变慢）。
  // 切到 WAL + synchronous=NORMAL 后写事务只需一次 fsync，读写也不互相阻塞。
  async onModuleInit() {
    await this.dataSource.query('PRAGMA journal_mode = WAL;');
    await this.dataSource.query('PRAGMA synchronous = NORMAL;');
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
  }
}
