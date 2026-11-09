import { Module, NestModule, MiddlewareConsumer, OnModuleInit, Logger } from '@nestjs/common';
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
    await this.warnIfDataStale();
  }

  /**
   * 启动时检查航班数据是否过期。
   *
   * 本地开发库只到"上次本地爬取"的时间点，而页面默认查"今天 ~ +30 天"，
   * 库太旧就会处处查不到数据，看起来像功能坏了。这里提前说清楚。
   * 线上（Render）数据由每日爬虫更新，且没有 pull 脚本，不做这个提示。
   */
  private async warnIfDataStale(): Promise<void> {
    if (process.env.RENDER) return; // 线上跳过
    const logger = new Logger('DataFreshness');
    try {
      const rows = await this.dataSource.query(
        'SELECT MAX(DATE(departureTime)) AS maxDate, COUNT(*) AS total FROM flights',
      );
      const maxDate: string | null = rows?.[0]?.maxDate ?? null;
      const total = Number(rows?.[0]?.total ?? 0);
      const today = new Date().toISOString().slice(0, 10);

      if (!maxDate) {
        logger.warn('⚠️ 本地库里没有任何航班数据，页面会查不到结果');
        logger.warn('   可执行 ./pull-prod-db.sh 拉取线上数据（先停后端）');
        return;
      }
      if (maxDate < today) {
        logger.warn(
          `⚠️ 本地航班数据只到 ${maxDate}（今天 ${today}，共 ${total} 条），` +
          '页面默认查"今天~+30天"会查不到结果',
        );
        logger.warn('   可执行 ./pull-prod-db.sh 拉取线上最新数据（先停后端）');
      }
    } catch {
      // 空库 / 首次启动表还没建好时忽略
    }
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
  }
}
