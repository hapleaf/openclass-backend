import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { Request } from 'express';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  getOverview() { return this.admin.getOverview(); }

  @Get('sessions/pending')
  getPending() { return this.admin.getPendingSessions(); }

  @Get('sessions/search')
  searchSessions(
    @Query('q')        q?: string,
    @Query('type')     type?: string,
    @Query('status')   status?: string,
    @Query('approved') approved?: string,
    @Query('from')     from?: string,
    @Query('to')       to?: string,
    @Query('take')     take?: string,
  ) {
    return this.admin.searchSessions({ q, type, status, approved, from, to, take: take ? Number(take) : undefined });
  }

  @Get('sessions/stats')
  sessionStats() { return this.admin.getSessionStats(); }

  @Get('sessions/:id/detail')
  sessionDetail(@Param('id', ParseIntPipe) id: number) { return this.admin.getSessionDetail(id); }

  @Get('sessions/:id/audit-log')
  auditLog(@Param('id', ParseIntPipe) id: number) { return this.admin.getAuditLog(id); }

  @Post('sessions/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number) { return this.admin.approveSession(id); }

  @Post('sessions/:id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() body: { reason?: string }) {
    return this.admin.rejectSession(id, body.reason);
  }

  @Patch('sessions/:id/schedule')
  updateSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { scheduledAt: string; note?: string },
    @Req() req: Request & { user: { sub: number } },
  ) {
    return this.admin.updateSchedule(id, req.user.sub, body.scheduledAt, body.note);
  }

  @Get('insights/engagement')
  loginEngagement(@Query('period') period?: string) {
    return this.admin.getLoginEngagement(period ?? '7d');
  }

  @Get('insights/teachers')
  topTeachers() { return this.admin.getTopTeachers(); }

  @Get('insights/subscribers')
  subscriberInsights() { return this.admin.getSubscriberInsights(); }

  @Get('insights/students')
  topStudents(@Query('page') page?: string, @Query('take') take?: string) {
    return this.admin.getTopStudents(Number(page ?? 1), Number(take ?? 50));
  }

  @Get('users/search')
  searchUsers(@Query('q') q?: string, @Query('take') take?: string) {
    return this.admin.searchUsers(q, take ? Number(take) : 50);
  }

  @Get('users/stats')
  userStats() { return this.admin.getUserStats(); }

  @Get('users/:id')
  getUser(@Param('id', ParseIntPipe) id: number) { return this.admin.getUser(id); }

  @Patch('users/:id')
  updateUser(@Param('id', ParseIntPipe) id: number, @Body() body: { disabled?: boolean; role?: string; firstName?: string; lastName?: string; email?: string }) {
    return this.admin.updateUser(id, body);
  }

  /* ── Contact messages ─────────────────────────────────────── */
  @Get('contact')
  getContactMessages(@Query('unread') unread?: string, @Query('email') email?: string) {
    return this.admin.getContactMessages(unread === 'true', email);
  }

  @Get('contact/thread')
  getContactThread(@Query('email') email: string) {
    return this.admin.getContactThread(email);
  }

  @Post('contact/:id/reply')
  replyToContact(@Param('id', ParseIntPipe) id: number, @Body() body: { body: string }) {
    return this.admin.replyToContact(id, body.body);
  }

  @Patch('contact/:id/read')
  markContactRead(@Param('id', ParseIntPipe) id: number) {
    return this.admin.markContactRead(id);
  }

  @Delete('contact/:id')
  deleteContactMessage(@Param('id', ParseIntPipe) id: number) {
    return this.admin.deleteContactMessage(id);
  }
}
