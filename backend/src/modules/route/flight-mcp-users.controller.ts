import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, Header, HttpCode,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin.guard';
import { z } from 'zod/v4';
import { FlightMcpQuota } from './flight-mcp-quota';

const createUser = z.strictObject({
  name: z.string().trim().min(1).max(60).regex(/^[^\p{Cc}]+$/u),
  email: z.string().trim().toLowerCase().max(254).email().optional(),
});
const setActive = z.strictObject({ active: z.boolean() });

@Controller('admin/mcp-users')
@UseGuards(AdminGuard)
export class FlightMcpUsersController {
  constructor(private readonly users: FlightMcpQuota) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query('page') page: unknown = '1') {
    if (typeof page !== 'string' || !/^[1-9]\d{0,3}$/.test(page)) throw new BadRequestException('页码无效');
    return this.users.list(Number(page));
  }

  @Post()
  async create(@Body() input: unknown) {
    const parsed = createUser.safeParse(input);
    if (!parsed.success) throw new BadRequestException('请输入有效的名称及邮箱（邮箱可留空）');
    const user = await this.users.create(parsed.data.name, parsed.data.email);
    if (!user) throw new ConflictException('该邮箱已经在用户名单中');
    return user;
  }

  @Patch(':id')
  @HttpCode(204)
  async setActive(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: unknown) {
    const parsed = setActive.safeParse(input);
    if (!parsed.success) throw new BadRequestException('用户状态无效');
    if (!await this.users.setActive(id, parsed.data.active)) throw new NotFoundException('用户不存在');
  }

  @Post(':id/token')
  @Header('Cache-Control', 'no-store')
  async issue(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const credential = await this.users.issue(id);
    if (!credential) throw new ConflictException('只可向启用中的用户发放 Token');
    return credential;
  }

  @Delete(':id/token')
  @HttpCode(204)
  async revoke(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    if (!await this.users.revoke(id)) throw new NotFoundException('用户不存在');
  }
}
