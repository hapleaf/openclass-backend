import { Controller, Get, Post, Body, Param, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtGuard } from '../auth/jwt.guard';
import { Request } from 'express';

interface AuthRequest extends Request {
  user: { sub: number; email: string };
}

@Controller('messages')
@UseGuards(JwtGuard)
export class MessagesController {
  constructor(private readonly svc: MessagesService) {}

  /** Check if logged-in user is subscribed to a speaker */
  @Get('can-message/:recipientId')
  canMessage(@Req() req: AuthRequest, @Param('recipientId', ParseIntPipe) recipientId: number) {
    return this.svc.checkSubscription(req.user.sub, recipientId);
  }

  /** Get total unread count for the current user */
  @Get('unread-count')
  unreadCount(@Req() req: AuthRequest) {
    return this.svc.unreadCount(req.user.sub);
  }

  /** List all conversations */
  @Get()
  list(@Req() req: AuthRequest) {
    return this.svc.listConversations(req.user.sub);
  }

  /** Start a new conversation with a speaker (subscriber only) */
  @Post()
  send(
    @Req() req: AuthRequest,
    @Body() body: { recipientId: number; content: string },
  ) {
    return this.svc.sendMessage(req.user.sub, body.recipientId, body.content);
  }

  /** Get full conversation thread */
  @Get(':id')
  getOne(@Req() req: AuthRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.getConversation(req.user.sub, id);
  }

  /** Reply in an existing conversation */
  @Post(':id/reply')
  reply(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { content: string },
  ) {
    return this.svc.reply(req.user.sub, id, body.content);
  }

  /** Mark all messages in a conversation as read */
  @Post(':id/read')
  markRead(@Req() req: AuthRequest, @Param('id', ParseIntPipe) id: number) {
    return this.svc.markRead(req.user.sub, id);
  }
}
