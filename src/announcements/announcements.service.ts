import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(speakerId: number, content: string, title?: string) {
    return this.prisma.announcement.create({
      data: { speakerId, content, title },
    });
  }

  async myAnnouncements(speakerId: number) {
    const rows = await this.prisma.announcement.findMany({
      where: { speakerId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { reads: true } } },
    });

    const subCount = await this.prisma.subscription.count({ where: { teacherId: speakerId } });

    return rows.map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      createdAt: r.createdAt,
      readCount: r._count.reads,
      subscriberCount: subCount,
    }));
  }

  async feed(userId: number, cursor?: number) {
    const subs = await this.prisma.subscription.findMany({
      where: { subscriberId: userId },
      select: { teacherId: true },
    });
    const speakerIds = subs.map(s => s.teacherId);
    if (speakerIds.length === 0) return [];

    return this.prisma.announcement.findMany({
      where: {
        speakerId: { in: speakerIds },
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        speaker: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, title: true } },
        reads: { where: { userId }, select: { readAt: true } },
      },
    });
  }

  async unreadCount(userId: number) {
    const subs = await this.prisma.subscription.findMany({
      where: { subscriberId: userId },
      select: { teacherId: true },
    });
    const speakerIds = subs.map(s => s.teacherId);
    if (speakerIds.length === 0) return { count: 0 };

    const count = await this.prisma.announcement.count({
      where: {
        speakerId: { in: speakerIds },
        reads: { none: { userId } },
      },
    });
    return { count };
  }

  async markAllRead(userId: number) {
    const subs = await this.prisma.subscription.findMany({
      where: { subscriberId: userId },
      select: { teacherId: true },
    });
    const speakerIds = subs.map(s => s.teacherId);
    if (speakerIds.length === 0) return { ok: true };

    const unread = await this.prisma.announcement.findMany({
      where: {
        speakerId: { in: speakerIds },
        reads: { none: { userId } },
      },
      select: { id: true },
    });

    if (unread.length > 0) {
      await this.prisma.announcementRead.createMany({
        data: unread.map(a => ({ userId, announcementId: a.id })),
        skipDuplicates: true,
      });
    }

    return { ok: true };
  }

  async markOneRead(userId: number, announcementId: number) {
    const ann = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!ann) throw new NotFoundException('Announcement not found');

    await this.prisma.announcementRead.upsert({
      where: { userId_announcementId: { userId, announcementId } },
      create: { userId, announcementId },
      update: {},
    });
    return { ok: true };
  }

  async deleteAnnouncement(speakerId: number, announcementId: number) {
    const ann = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!ann) throw new NotFoundException('Announcement not found');
    if (ann.speakerId !== speakerId) throw new ForbiddenException('Not your announcement');
    await this.prisma.announcement.delete({ where: { id: announcementId } });
    return { ok: true };
  }
}
