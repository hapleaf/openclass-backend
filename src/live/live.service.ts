import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccessToken,
  EgressClient, EgressStatus,
  EncodedFileOutput, EncodedFileType,
  S3Upload,
  WebhookReceiver,
} from 'livekit-server-sdk';

@Injectable()
export class LiveService implements OnModuleInit {
  private readonly captchaStore = new Map<string, { answer: number; expiresAt: number }>();
  private readonly logger = new Logger(LiveService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    if (!this.isEgressConfigured()) return;
    const active = await this.prisma.session.findMany({
      where: { egressActive: true },
      select: { id: true, duration: true, actualStartAt: true },
    });
    if (!active.length) return;
    const maxMinutes = Number(this.config.get<string>('MAX_EGRESS_DURATION_MINUTES') || 120);
    for (const s of active) {
      const startedAt = s.actualStartAt ?? new Date();
      const elapsedMin = (Date.now() - startedAt.getTime()) / 60_000;
      const capMinutes = Math.min(s.duration + 10, maxMinutes);
      const remainingMs = (capMinutes - elapsedMin) * 60_000;
      if (remainingMs <= 0) {
        this.logger.warn(`Session ${s.id} egress overdue on startup — stopping now`);
        this._stopEgressForSession(s.id);
      } else {
        this.logger.log(`Session ${s.id} egress re-armed: stops in ${Math.round(remainingMs / 60_000)} min`);
        setTimeout(() => this._stopEgressForSession(s.id), remainingMs);
      }
    }
  }

  private async _stopEgressForSession(sessionId: number) {
    try {
      const egresses = await this.egressClient().listEgress({ roomName: `session-${sessionId}`, active: true });
      if (egresses.length) {
        await Promise.all(egresses.map(e => this.egressClient().stopEgress(e.egressId)));
        this.logger.log(`Auto-stopped egress for session ${sessionId}`);
      }
      await this.prisma.session.update({ where: { id: sessionId }, data: { egressActive: false, egressId: null } });
    } catch (err) {
      this.logger.warn(`Could not auto-stop egress for session ${sessionId}: ${(err as Error).message}`);
    }
  }

  private egressClient(): EgressClient {
    const apiKey    = this.config.get<string>('LIVEKIT_API_KEY')    ?? 'devkey';
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET') ?? 'secret';
    const lkUrl     = this.config.get<string>('LIVEKIT_SERVER_URL_FOR_EGRESS')        ?? 'ws://localhost:7880';
    // EgressClient uses HTTP, convert ws(s):// → http(s)://
    const httpUrl = lkUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
    return new EgressClient(httpUrl, apiKey, apiSecret);
  }

  private buildFileOutput(sessionId: number): EncodedFileOutput {
    const bucket    = this.config.get<string>('AWS_S3_BUCKET');
    const accessKey = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secret    = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
    const region    = this.config.get<string>('AWS_S3_REGION') ?? 'us-east-1';

    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: `recordings/session-${sessionId}-{time}`,
      ...(bucket && accessKey && secret
        ? { s3: new S3Upload({ accessKey, secret, bucket, region }) }
        : {}),
    });
    return output;
  }

  private isEgressConfigured(): boolean {
    // Egress requires either an explicit opt-in flag OR S3 credentials
    const enabled   = this.config.get<string>('LIVEKIT_EGRESS_ENABLED');
    const bucket    = this.config.get<string>('AWS_S3_BUCKET');
    const accessKey = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secret    = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
    return enabled === 'true' || !!(bucket && accessKey && secret);
  }

  private async startRecording(sessionId: number, duration: number): Promise<void> {
    if (!this.isEgressConfigured()) {
      this.logger.debug(`Egress not configured — skipping auto-recording for session ${sessionId}`);
      return;
    }
    try {
      const output = this.buildFileOutput(sessionId);
      const egress = await this.egressClient().startRoomCompositeEgress(
        `session-${sessionId}`,
        { file: output },
        { layout: 'single-speaker-dark' },
      );
      this.logger.log(`Egress started for session ${sessionId} | egressId=${egress.egressId}`);

      // Persist so the UI can restore isRecording state on organizer rejoin
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { egressId: egress.egressId, egressActive: true },
      });

      // Hard cap: never record beyond MAX_EGRESS_DURATION_MINUTES (default 120).
      // endSession() will stop it sooner if pressed.
      const maxMinutes = Number(this.config.get<string>('MAX_EGRESS_DURATION_MINUTES') || 120);
      const stopAfterMinutes = Math.min(duration + 10, maxMinutes);
      setTimeout(() => this._stopEgressForSession(sessionId), stopAfterMinutes * 60_000);
    } catch (err) {
      const e = err as Error & { code?: unknown; details?: unknown; metadata?: unknown };
      this.logger.error(
        `Could not start egress for session ${sessionId}` +
        ` | message: ${e.message}` +
        ` | code: ${JSON.stringify(e.code)}` +
        ` | details: ${JSON.stringify(e.details)}` +
        ` | metadata: ${JSON.stringify(e.metadata)}` +
        ` | full: ${JSON.stringify(err)}`,
      );
      throw err;
    }
  }

  // ── Token generation ───────────────────────────────────────────────────────
  async getToken(sessionId: number, userId: number, passcode?: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');

    const isOrganizer = session.userId === userId;

    if (!isOrganizer) {
      // Enforce passcode if set
      if (session.passcode && session.passcode !== passcode) {
        throw new ForbiddenException('Invalid passcode');
      }
      // Enforce registration
      const registration = await this.prisma.registration.findUnique({
        where: { userId_sessionId: { userId, sessionId } },
      });
      if (!registration) {
        throw new ForbiddenException('You must register for this session before joining');
      }
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const displayName = user?.name || `user-${userId}`;

    const apiKey = this.config.get<string>('LIVEKIT_API_KEY') ?? 'devkey';
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET') ?? 'secret';
    const lkUrl = this.config.get<string>('LIVEKIT_URL') ?? 'ws://localhost:7880';

    const roomName = `session-${sessionId}`;
    const at = new AccessToken(apiKey, apiSecret, {
      identity: `user-${userId}`,
      name: displayName,
      ttl: '4h',
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: isOrganizer,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: isOrganizer,
    });

    const token = await at.toJwt();

    const [registeredCount, onlineCount] = await Promise.all([
      this.prisma.registration.count({ where: { sessionId } }),
      this.prisma.sessionAttendance.count({ where: { sessionId, leftAt: null } }),
    ]);

    return {
      token,
      lkUrl,
      roomName,
      isOrganizer,
      isRecording: session.egressActive,
      sessionInfo: {
        id: session.id,
        title: session.title,
        category: session.category,
        type: session.type,
        duration: session.duration,
        scheduledAt: session.scheduledAt,
        userId: session.userId,
      },
      registeredCount,
      onlineCount,
    };
  }

  // ── Attendance tracking ────────────────────────────────────────────────────
  async recordJoin(sessionId: number, userId: number) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException();

    const role = session.userId === userId ? 'organizer' : 'audience';

    // Close any open attendance records to avoid duplicates
    await this.prisma.sessionAttendance.updateMany({
      where: { sessionId, userId, leftAt: null },
      data: { leftAt: new Date() },
    });

    const record = await this.prisma.sessionAttendance.create({
      data: { sessionId, userId, role },
    });

    // Record actual start time on first organizer join
    if (role === 'organizer' && !session.actualStartAt) {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { actualStartAt: new Date() },
      });
    }

    return record;
  }

  async startRecordingManual(sessionId: number, userId: number) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException();
    if (session.userId !== userId) throw new ForbiddenException('Only the organizer can start recording');
    if (!this.isEgressConfigured()) throw new ForbiddenException('Recording is not configured on this server');
    if (session.egressActive) throw new BadRequestException('Recording is already in progress for this session');
    await this.startRecording(sessionId, session.duration);
    return { ok: true };
  }

  async recordLeave(sessionId: number, userId: number) {
    await this.prisma.sessionAttendance.updateMany({
      where: { sessionId, userId, leftAt: null },
      data: { leftAt: new Date() },
    });
    return { ok: true };
  }

  // ── End session (COMPLETED) ────────────────────────────────────────────────
  async endSession(sessionId: number, userId: number) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException();
    if (session.userId !== userId) throw new ForbiddenException();

    // Close all open attendance records
    const now = new Date();
    await this.prisma.sessionAttendance.updateMany({
      where: { sessionId, leftAt: null },
      data: { leftAt: now },
    });

    // Compute actual duration from organizer attendance
    const organizerRecords = await this.prisma.sessionAttendance.findMany({
      where: { sessionId, role: 'organizer' },
    });
    const actualDurationMs = organizerRecords.reduce((sum, r) => {
      const end = r.leftAt ?? now;
      return sum + Math.max(0, end.getTime() - r.joinedAt.getTime());
    }, 0);
    const actualDuration = Math.round(actualDurationMs / 60_000);

    // Compute quality flag
    const qualityFlag = await this.computeQualityFlag(session, actualDuration, sessionId);

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { sessionStatus: 'COMPLETED', actualDuration, qualityFlag, egressActive: false, egressId: null },
    });

    // Stop any active egress so the MP4 is finalised and the webhook fires
    if (this.isEgressConfigured()) {
      try {
        const egresses = await this.egressClient().listEgress({
          roomName: `session-${sessionId}`,
          active: true,
        });
        await Promise.all(egresses.map((e) => this.egressClient().stopEgress(e.egressId)));
        this.logger.log(`Stopped ${egresses.length} egress(es) for session ${sessionId}`);
      } catch (err) {
        this.logger.warn(`Could not stop egress for session ${sessionId}: ${(err as Error).message}`);
      }
    }

    return { sessionStatus: 'COMPLETED', qualityFlag, actualDuration };
  }

  // ── Cancel session (CANCELLED) ─────────────────────────────────────────────
  async cancelSession(sessionId: number, userId: number) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException();
    if (session.userId !== userId) throw new ForbiddenException();

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { sessionStatus: 'CANCELLED' },
    });

    return { sessionStatus: 'CANCELLED' };
  }

  // ── Recording — poll egress status, save filename when done ──────────────
  async getRecording(sessionId: number): Promise<{ recordings: string[]; processing: boolean }> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { recordings: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) throw new NotFoundException();

    // Already have recordings saved
    if (session.recordings.length > 0) {
      return { recordings: session.recordings.map((r: { filename: string }) => r.filename), processing: false };
    }

    // Not an auto-recording session, or no status yet
    if (!session.autoRecording || !session.sessionStatus) {
      return { recordings: [], processing: false };
    }

    try {
      const egresses = await this.egressClient().listEgress({ roomName: `session-${sessionId}` });
      const done = egresses.find(e => e.status === EgressStatus.EGRESS_COMPLETE);
      if (!done) {
        const running = egresses.some(e =>
          e.status === EgressStatus.EGRESS_ACTIVE ||
          e.status === EgressStatus.EGRESS_STARTING ||
          e.status === EgressStatus.EGRESS_ENDING,
        );
        return { recordings: [], processing: running };
      }

      const fileResult = done.fileResults?.[0];
      if (fileResult?.location) {
        const filename = fileResult.location.split('/').pop()!;
        await this.prisma.sessionRecording.create({ data: { sessionId, filename } });
        return { recordings: [filename], processing: false };
      }

      return { recordings: [], processing: false };
    } catch (err) {
      this.logger.warn(`Could not fetch egress list for session ${sessionId}: ${(err as Error).message}`);
      return { recordings: [], processing: false };
    }
  }

  // ── LiveKit webhook — saves recording URL on egress_ended ──────────────────
  async handleWebhook(rawBody: string, authorization: string | undefined): Promise<void> {
    const apiKey    = this.config.get<string>('LIVEKIT_API_KEY')    ?? 'devkey';
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET') ?? 'secret';
    const receiver  = new WebhookReceiver(apiKey, apiSecret);
    let event: Awaited<ReturnType<typeof receiver.receive>>;
    try {
      event = await receiver.receive(rawBody, authorization);
    } catch {
      this.logger.warn('Webhook signature verification failed');
      return;
    }

    if (event.event !== 'egress_ended') return;
    const info = event.egressInfo;
    if (!info || info.status !== EgressStatus.EGRESS_COMPLETE) return;

    // Resolve sessionId from room name "session-{id}"
    const match = info.roomName?.match(/^session-(\d+)$/);
    if (!match) return;
    const sessionId = parseInt(match[1], 10);

    const fileResult = info.fileResults?.[0];
    if (!fileResult?.location) return;

    const filename = fileResult.location.split('/').pop();
    if (!filename) return;

    await this.prisma.sessionRecording.create({ data: { sessionId, filename } });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { egressActive: false, egressId: null },
    });
    this.logger.log(`Recording saved for session ${sessionId}: ${filename}`);
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  async getStatus(sessionId: number) {
    const [session, registeredCount, onlineCount] = await Promise.all([
      this.prisma.session.findUnique({ where: { id: sessionId }, select: { egressActive: true } }),
      this.prisma.registration.count({ where: { sessionId } }),
      this.prisma.sessionAttendance.count({ where: { sessionId, leftAt: null } }),
    ]);
    return { registeredCount, onlineCount, isRecording: session?.egressActive ?? false };
  }

  // ── Attendance report ──────────────────────────────────────────────────────
  async getAttendance(sessionId: number, requesterId: number) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException();
    if (session.userId !== requesterId) throw new ForbiddenException();

    const records = await this.prisma.sessionAttendance.findMany({ where: { sessionId } });
    const durationMs = session.duration * 60 * 1000;

    return records.map((r) => {
      const end = r.leftAt ?? new Date();
      const attendedMs = Math.max(0, end.getTime() - r.joinedAt.getTime());
      const pct = durationMs > 0 ? Math.min(100, Math.round((attendedMs / durationMs) * 100)) : 0;
      return {
        userId: r.userId,
        role: r.role,
        joinedAt: r.joinedAt,
        leftAt: r.leftAt,
        attendedMinutes: Math.round(attendedMs / 60_000),
        attendedPct: pct,
      };
    });
  }

  // ── Captcha ────────────────────────────────────────────────────────────────
  generateCaptcha() {
    // Purge expired entries to prevent unbounded growth
    const now = Date.now();
    for (const [k, v] of this.captchaStore) {
      if (v.expiresAt < now) this.captchaStore.delete(k);
    }

    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    const ops = ['+', '-', '×'] as const;
    const op = ops[Math.floor(Math.random() * ops.length)];
    const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;

    const token = randomUUID();
    this.captchaStore.set(token, { answer, expiresAt: now + 5 * 60_000 });

    return { token, challenge: `${a} ${op} ${b}` };
  }

  private verifyCaptcha(token: string, answer: number): boolean {
    const stored = this.captchaStore.get(token);
    if (!stored || stored.expiresAt < Date.now()) {
      this.captchaStore.delete(token);
      return false;
    }
    const valid = stored.answer === answer;
    this.captchaStore.delete(token); // one-time use
    return valid;
  }

  // ── Rate session ───────────────────────────────────────────────────────────
  async rateSession(
    sessionId: number,
    userId: number,
    rating: number,
    comment: string,
    captchaToken: string,
    captchaAnswer: number,
  ) {
    if (!this.verifyCaptcha(captchaToken, captchaAnswer)) {
      throw new BadRequestException('Invalid or expired captcha');
    }

    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId === userId) throw new ForbiddenException('You cannot rate your own session');

    // Comments only allowed after session scheduled start
    if (new Date() < session.scheduledAt) {
      throw new BadRequestException('Ratings open only after the session starts');
    }

    const existing = await this.prisma.review.findFirst({ where: { authorId: userId, sessionId } });
    if (existing) throw new BadRequestException('You have already rated this session');

    const author = await this.prisma.user.findUnique({ where: { id: userId } });
    const authorName = author?.name || 'User';

    return this.prisma.review.create({
      data: { authorId: userId, authorName, teacherId: session.userId, sessionId, rating, comment },
    });
  }

  async organizerComment(sessionId: number, userId: number, comment: string) {
    if (!comment?.trim()) throw new BadRequestException('Comment cannot be empty');
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId) throw new ForbiddenException('Only the session organizer can post here');
    const author = await this.prisma.user.findUnique({ where: { id: userId } });
    const authorName = author?.name || 'Organizer';
    return this.prisma.review.create({
      data: { authorId: userId, authorName, teacherId: userId, sessionId, rating: 0, comment: comment.trim() },
    });
  }

  // ── Lazy status sync — called when fetching sessions ──────────────────────
  async syncSessionStatuses(userId: number) {
    const now = new Date();

    // Sessions past their window with no status set
    const windowEnd = (s: { scheduledAt: Date; duration: number }) =>
      new Date(s.scheduledAt.getTime() + (s.duration + 30) * 60_000);

    const unsettled = await this.prisma.session.findMany({
      where: {
        userId,
        sessionStatus: null,
        status: 'published',
        scheduledAt: { lte: now },
      },
    });

    for (const session of unsettled) {
      if (windowEnd(session) > now) continue; // still within window

      const organizer = await this.prisma.sessionAttendance.findFirst({
        where: { sessionId: session.id, role: 'organizer' },
        orderBy: { joinedAt: 'asc' },
      });

      if (!organizer) {
        // Never joined → NO_SHOW
        await this.prisma.session.update({
          where: { id: session.id },
          data: { sessionStatus: 'NO_SHOW' },
        });
        continue;
      }

      // Check for ABANDONED: last organizer record has leftAt, and 10+ mins passed without rejoining
      const lastOrganizer = await this.prisma.sessionAttendance.findFirst({
        where: { sessionId: session.id, role: 'organizer' },
        orderBy: { joinedAt: 'desc' },
      });

      if (lastOrganizer?.leftAt) {
        const tenMinsAfterLeave = new Date(lastOrganizer.leftAt.getTime() + 10 * 60_000);
        if (now >= tenMinsAfterLeave) {
          // Compute actual duration and quality flag before marking ABANDONED
          const allOrgRecords = await this.prisma.sessionAttendance.findMany({
            where: { sessionId: session.id, role: 'organizer' },
          });
          const actualDurationMs = allOrgRecords.reduce((sum, r) => {
            const end = r.leftAt ?? now;
            return sum + Math.max(0, end.getTime() - r.joinedAt.getTime());
          }, 0);
          const actualDuration = Math.round(actualDurationMs / 60_000);
          const qualityFlag = await this.computeQualityFlag(session, actualDuration, session.id);

          await this.prisma.session.update({
            where: { id: session.id },
            data: { sessionStatus: 'ABANDONED', actualDuration, qualityFlag },
          });
        }
      }
    }

    // Also handle auto-COMPLETED: session window closed, organizer joined, no status set
    const autoComplete = await this.prisma.session.findMany({
      where: {
        userId,
        sessionStatus: null,
        status: 'published',
        scheduledAt: { lte: now },
      },
    });

    for (const session of autoComplete) {
      if (windowEnd(session) > now) continue;

      const organizer = await this.prisma.sessionAttendance.findFirst({
        where: { sessionId: session.id, role: 'organizer' },
      });

      if (organizer) {
        const allOrgRecords = await this.prisma.sessionAttendance.findMany({
          where: { sessionId: session.id, role: 'organizer' },
        });
        const actualDurationMs = allOrgRecords.reduce((sum, r) => {
          const end = r.leftAt ?? now;
          return sum + Math.max(0, end.getTime() - r.joinedAt.getTime());
        }, 0);
        const actualDuration = Math.round(actualDurationMs / 60_000);
        const qualityFlag = await this.computeQualityFlag(session, actualDuration, session.id);

        await this.prisma.session.update({
          where: { id: session.id },
          data: { sessionStatus: 'COMPLETED', actualDuration, qualityFlag },
        });
      }
    }
  }

  // ── Quality flag computation ───────────────────────────────────────────────
  private async computeQualityFlag(
    session: { duration: number; scheduledAt: Date; actualStartAt?: Date | null },
    actualDuration: number,
    sessionId: number,
  ): Promise<string> {
    if (actualDuration < 10) return 'VERY_SHORT_SESSION';
    if (actualDuration < session.duration * 0.5) return 'EARLY_COMPLETION';

    // Late start: organizer joined > 10 mins after scheduled start
    if (session.actualStartAt) {
      const lateMinutes = (session.actualStartAt.getTime() - session.scheduledAt.getTime()) / 60_000;
      if (lateMinutes > 10) return 'LATE_START';
    }

    // Low attendance: < 20% of registered attended
    const [registered, attended] = await Promise.all([
      this.prisma.registration.count({ where: { sessionId } }),
      this.prisma.sessionAttendance.count({ where: { sessionId, role: 'audience' } }),
    ]);
    if (registered > 0 && attended / registered < 0.2) return 'LOW_ATTENDANCE';

    return 'NORMAL';
  }
}
