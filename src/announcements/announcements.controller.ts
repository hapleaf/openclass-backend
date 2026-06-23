import { Controller, Get, Post, Delete, Body, Param, Query, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { JwtGuard } from '../auth/jwt.guard';

@Controller('announcements')
@UseGuards(JwtGuard)
export class AnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Post()
  create(@Req() req: any, @Body() body: { content: string; title?: string }) {
    return this.svc.create(req.user.sub, body.content, body.title);
  }

  @Get('my')
  my(@Req() req: any) {
    return this.svc.myAnnouncements(req.user.sub);
  }

  @Get('feed')
  feed(@Req() req: any, @Query('cursor') cursor?: string) {
    return this.svc.feed(req.user.sub, cursor ? parseInt(cursor, 10) : undefined);
  }

  @Get('unread-count')
  unreadCount(@Req() req: any) {
    return this.svc.unreadCount(req.user.sub);
  }

  @Post('read-all')
  markAllRead(@Req() req: any) {
    return this.svc.markAllRead(req.user.sub);
  }

  @Post(':id/read')
  markOneRead(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.svc.markOneRead(req.user.sub, id);
  }

  @Delete(':id')
  delete(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteAnnouncement(req.user.sub, id);
  }
}
