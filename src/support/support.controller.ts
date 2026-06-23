import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req, ParseIntPipe } from '@nestjs/common';
import { SupportService } from './support.service';
import { JwtGuard } from '../auth/jwt.guard';
import { AdminGuard } from '../admin/admin.guard';
import { Request } from 'express';

interface AuthRequest extends Request {
  user: { sub: number; email: string; role?: string };
}

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // ─── User routes (JWT required) ──────────────────────────────────────────

  @UseGuards(JwtGuard)
  @Post()
  createTicket(
    @Req() req: AuthRequest,
    @Body() body: { subject: string; category?: string; message: string },
  ) {
    return this.support.createTicket(req.user.sub, body);
  }

  @UseGuards(JwtGuard)
  @Get('my')
  listMyTickets(@Req() req: AuthRequest) {
    return this.support.listUserTickets(req.user.sub);
  }

  @UseGuards(JwtGuard)
  @Get('my/:id')
  getMyTicket(@Req() req: AuthRequest, @Param('id', ParseIntPipe) id: number) {
    return this.support.getTicket(req.user.sub, id);
  }

  @UseGuards(JwtGuard)
  @Post('my/:id/reply')
  userReply(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { message: string },
  ) {
    return this.support.userReply(req.user.sub, id, body.message);
  }

  // ─── Admin routes ────────────────────────────────────────────────────────

  @UseGuards(AdminGuard)
  @Get('admin/tickets')
  adminList(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.support.adminListTickets({
      status: status || undefined,
      priority: priority || undefined,
      page: parseInt(page, 10) || 1,
      limit: Math.min(parseInt(limit, 10) || 20, 100),
    });
  }

  @UseGuards(AdminGuard)
  @Get('admin/tickets/:id')
  adminGet(@Param('id', ParseIntPipe) id: number) {
    return this.support.adminGetTicket(id);
  }

  @UseGuards(AdminGuard)
  @Post('admin/tickets/:id/reply')
  adminReply(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { message: string },
  ) {
    return this.support.adminReply(req.user.sub, id, body.message);
  }

  @UseGuards(AdminGuard)
  @Patch('admin/tickets/:id/status')
  adminUpdateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status?: string; priority?: string },
  ) {
    return this.support.adminUpdateStatus(id, body);
  }
}
