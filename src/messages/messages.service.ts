import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  private pair(a: number, b: number) {
    return { userAId: Math.min(a, b), userBId: Math.max(a, b) };
  }

  async isSubscribed(subscriberId: number, teacherId: number) {
    const sub = await this.prisma.subscription.findUnique({
      where: { subscriberId_teacherId: { subscriberId, teacherId } },
    });
    return !!sub;
  }

  async sendMessage(senderId: number, recipientId: number, content: string) {
    if (senderId === recipientId) throw new ForbiddenException('Cannot message yourself');

    const subscribed = await this.isSubscribed(senderId, recipientId);
    if (!subscribed) throw new ForbiddenException('You must be subscribed to message this speaker');

    const { userAId, userBId } = this.pair(senderId, recipientId);

    const conversation = await this.prisma.conversation.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: { userAId, userBId },
      update: { updatedAt: new Date() },
    });

    const message = await this.prisma.message.create({
      data: { conversationId: conversation.id, senderId, content },
    });

    return { conversationId: conversation.id, message };
  }

  async listConversations(userId: number) {
    const convs = await this.prisma.conversation.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { updatedAt: 'desc' },
      include: {
        userA: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, title: true } },
        userB: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, title: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, createdAt: true, senderId: true, readAt: true },
        },
      },
    });

    return convs.map(c => {
      const other = c.userAId === userId ? c.userB : c.userA;
      const last  = c.messages[0] ?? null;
      const unread = c.messages.filter(m => !m.readAt && m.senderId !== userId).length;
      return { id: c.id, other, lastMessage: last, unreadCount: unread, updatedAt: c.updatedAt };
    });
  }

  async getConversation(userId: number, conversationId: number) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        userA: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, title: true } },
        userB: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, title: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userAId !== userId && conv.userBId !== userId) throw new ForbiddenException('Access denied');

    const other = conv.userAId === userId ? conv.userB : conv.userA;
    return { id: conv.id, other, messages: conv.messages };
  }

  async markRead(userId: number, conversationId: number) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userAId !== userId && conv.userBId !== userId) throw new ForbiddenException('Access denied');

    await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });

    return { ok: true };
  }

  async reply(senderId: number, conversationId: number, content: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.userAId !== senderId && conv.userBId !== senderId) throw new ForbiddenException('Access denied');

    const [message] = await Promise.all([
      this.prisma.message.create({
        data: { conversationId, senderId, content },
      }),
      this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
    ]);

    return message;
  }

  async unreadCount(userId: number) {
    const count = await this.prisma.message.count({
      where: {
        readAt: null,
        senderId: { not: userId },
        conversation: { OR: [{ userAId: userId }, { userBId: userId }] },
      },
    });
    return { count };
  }

  async checkSubscription(senderId: number, recipientId: number) {
    const subscribed = await this.isSubscribed(senderId, recipientId);
    return { subscribed };
  }
}
