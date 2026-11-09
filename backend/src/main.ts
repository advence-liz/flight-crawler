import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 使用 Winston 作为全局日志记录器
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // 启用全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 启用 CORS：只放行自家前端和本地开发地址。
  // 仓库是公开的，接口清单人人可见，再放任 `*` 等于给所有网站发通行证
  // （写接口有 AdminGuard 兜底，但没必要把整张银行卡摊开）。
  // CORS_ORIGIN 支持逗号分隔多个来源；显式配置成 `*` 时仍按"全放行"处理，保持向后兼容。
  const DEFAULT_ORIGINS = [
    'https://flight-crawler-frontend.onrender.com',
    'http://localhost:5173',
    'http://localhost:8899',
    'http://localhost:8901',
  ];
  const configuredOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins.length ? configuredOrigins : DEFAULT_ORIGINS;
  const allowAll = allowedOrigins.includes('*');

  app.enableCors({
    // 不带 Origin 的请求（curl / 服务端调用 / 同源导航）不受 CORS 约束，直接放行
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowAll || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    // 用 Authorization 头传 token，不用 cookie，因此不需要 credentials
    credentials: false,
  });

  // 设置全局路由前缀
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 应用已启动: http://localhost:${port}`);
  console.log(`📚 API 文档: http://localhost:${port}/api`);
}

bootstrap();
