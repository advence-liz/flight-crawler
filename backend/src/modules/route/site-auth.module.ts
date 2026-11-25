import { Global, Module } from '@nestjs/common';
import { AdminGuard } from '../../admin.guard';
import { FlightMcpQuota } from './flight-mcp-quota';
import { SiteAuthService } from './site-auth.service';

@Global()
@Module({
  providers: [FlightMcpQuota, SiteAuthService, AdminGuard],
  exports: [FlightMcpQuota, SiteAuthService, AdminGuard],
})
export class SiteAuthModule {}
