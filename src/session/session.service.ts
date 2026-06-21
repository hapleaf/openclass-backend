import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class SessionService {
  constructor(private prisma: PrismaService, private recording: RecordingService) {}

  async create(userId: number, dto: CreateSessionDto) {
    const inviteSlug =
      dto.visibility === 'private'
        ? randomBytes(4).toString('hex').toUpperCase()
        : null;

    return this.prisma.session.create({
      data: {
        userId,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        bannerColor: dto.bannerColor,
        bannerUrl: dto.bannerUrl ?? null,
        introVideoUrl: dto.introVideoUrl ?? null,
        category: dto.category,
        skillLevel: dto.skillLevel,
        tags: dto.tags,
        scheduledAt: new Date(dto.scheduledAt),
        duration: dto.duration,
        audienceLimit: dto.audienceLimit ?? null,
        visibility: dto.visibility ?? 'public',
        passcode: dto.passcode ?? null,
        inviteSlug,
        chatEnabled: dto.chatEnabled ?? true,
        autoRecording: dto.autoRecording ?? true,
        requireApproval: dto.requireApproval ?? false,
        sendReminder: dto.sendReminder ?? true,
        status: dto.status ?? 'draft',
      },
    });
  }

  async browsePublic() {
    const sessions = await this.prisma.session.findMany({
      where: { status: 'published', approved: true, visibility: 'public' },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, name: true,
            title: true, avatarUrl: true, verified: true,
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });
    return sessions;
  }

  async browsePublicOne(id: number) {
    const session = await this.prisma.session.findFirst({
      where: { id, status: 'published' },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, name: true,
            title: true, avatarUrl: true, verified: true,
          },
        },
        _count: { select: { registrations: true } },
      },
    });
    if (!session) throw new NotFoundException('Session not found');

    const [reviews, recordings] = await Promise.all([
      this.prisma.review.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, authorName: true, rating: true, comment: true, createdAt: true },
      }),
      this.prisma.sessionRecording.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, filename: true, s3Key: true, createdAt: true },
      }),
    ]);

    const recordingsWithHls = recordings.map(r => ({
      ...r,
      hlsUrl: r.s3Key ? this.recording.getSignedUrl(r.s3Key) : null,
    }));

    return { ...session, reviews, recordings: recordingsWithHls };
  }

  async toggleRegistration(userId: number, sessionId: number) {
    const existing = await this.prisma.registration.findUnique({
      where: { userId_sessionId: { userId, sessionId } },
    });
    if (existing) {
      await this.prisma.registration.delete({ where: { id: existing.id } });
      return { registered: false };
    }
    await this.prisma.registration.create({ data: { userId, sessionId } });
    return { registered: true };
  }

  async getMyRegistrationIds(userId: number): Promise<number[]> {
    const regs = await this.prisma.registration.findMany({
      where: { userId },
      select: { sessionId: true },
    });
    return regs.map(r => r.sessionId);
  }

  async findAllByUser(userId: number) {
    await this.syncStatuses(userId);
    return this.prisma.session.findMany({
      where: { userId },
      include: { _count: { select: { registrations: true } } },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  private async syncStatuses(_userId: number) {
    const now = new Date();
    const unsettled = await this.prisma.session.findMany({
      where: { sessionStatus: null, status: 'published', scheduledAt: { lte: now } },
    });
    for (const s of unsettled) {
      const windowEnd = new Date(s.scheduledAt.getTime() + (s.duration + 30) * 60_000);
      if (windowEnd > now) continue;
      const org = await this.prisma.sessionAttendance.findFirst({ where: { sessionId: s.id, role: 'organizer' } });
      if (!org) {
        await this.prisma.session.update({ where: { id: s.id }, data: { sessionStatus: 'NO_SHOW' } });
        continue;
      }
      const lastOrg = await this.prisma.sessionAttendance.findFirst({ where: { sessionId: s.id, role: 'organizer' }, orderBy: { joinedAt: 'desc' } });
      if (lastOrg?.leftAt && new Date(lastOrg.leftAt.getTime() + 10 * 60_000) <= now) {
        await this.prisma.session.update({ where: { id: s.id }, data: { sessionStatus: 'ABANDONED' } });
      } else {
        await this.prisma.session.update({ where: { id: s.id }, data: { sessionStatus: 'COMPLETED' } });
      }
    }
  }

  async findOne(id: number, userId: number) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId) throw new ForbiddenException();
    return session;
  }

  async update(id: number, userId: number, dto: Partial<CreateSessionDto>) {
    const session = await this.findOne(id, userId);
    return this.prisma.session.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.scheduledAt ? { scheduledAt: new Date(dto.scheduledAt) } : {}),
        // editing an approved session requires re-approval regardless of new status
        ...(session.approved ? { approved: false } : {}),
      },
    });
  }

  async remove(id: number, userId: number) {
    await this.findOne(id, userId);
    return this.prisma.session.delete({ where: { id } });
  }

  async setRecordingUrl(sessionId: number, userId: number, filename: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId) throw new ForbiddenException();
    return this.prisma.sessionRecording.create({ data: { sessionId, filename } });
  }
}
