import { ConflictException, Controller, Delete, Get, Header, HttpCode, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { FlightMcpQuota } from './flight-mcp-quota';
import { SiteAuthService } from './site-auth.service';

@Controller('account')
export class SiteAccountController {
  constructor(private readonly auth: SiteAuthService, private readonly access: FlightMcpQuota) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status() { return this.auth.status(); }

  @Get()
  @Header('Cache-Control', 'no-store')
  async me(@Req() req: Request) {
    const { name, email, hasToken } = await this.auth.user(req);
    return { name, email, hasToken, mcpEnabled: process.env.FLIGHT_MCP_ENABLED === 'true' };
  }

  @Post('mcp/token')
  @Header('Cache-Control', 'no-store')
  async issue(@Req() req: Request) {
    const { id } = await this.auth.user(req, true);
    if (process.env.FLIGHT_MCP_ENABLED !== 'true') throw new ServiceUnavailableException('MCP 尚未开放');
    const result = await this.access.issue(id);
    if (!result) throw new ConflictException('账号不可发放 Token');
    return result;
  }

  @Delete('mcp/token')
  @HttpCode(204)
  async revoke(@Req() req: Request) {
    const { id } = await this.auth.user(req, true);
    await this.access.revoke(id);
  }
}
