import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

function parseUA(ua: string | null | undefined) {
  if (!ua) return { browser: 'Unknown', os: 'Unknown' };
  let browser = 'Other';
  if (/Edg\//i.test(ua))        browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  let os = 'Other';
  if (/Windows/i.test(ua))      os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Linux/i.test(ua))   os = 'Linux';

  return { browser, os };
}

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

  /* ── Overview ──────────────────────────────────────────── */
  async getOverview() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week  = new Date(today.getTime() - 6 * 86400_000);
    const month = new Date(today.getTime() - 29 * 86400_000);

    const [
      totalUsers, newUsersToday, newUsersWeek, newUsersMonth,
      totalSessions, pendingSessions, activeSessions, completedSessions,
      totalRegistrations, totalReviews, avgRatingRaw,
      loginsToday, loginsWeek,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: today } } }),
      this.prisma.user.count({ where: { createdAt: { gte: week } } }),
      this.prisma.user.count({ where: { createdAt: { gte: month } } }),
      this.prisma.session.count(),
      this.prisma.session.count({ where: { status: 'published', approved: false } }),
      this.prisma.session.count({ where: { status: 'published', approved: true, scheduledAt: { gte: now } } }),
      this.prisma.session.count({ where: { sessionStatus: 'COMPLETED' } }),
      this.prisma.registration.count(),
      this.prisma.review.count(),
      this.prisma.review.aggregate({ where: { rating: { gt: 0 } }, _avg: { rating: true } }),
      this.prisma.loginLog.count({ where: { createdAt: { gte: today } } }),
      this.prisma.loginLog.count({ where: { createdAt: { gte: week } } }),
    ]);

    return {
      users: { total: totalUsers, today: newUsersToday, week: newUsersWeek, month: newUsersMonth },
      sessions: { total: totalSessions, pending: pendingSessions, active: activeSessions, completed: completedSessions },
      registrations: totalRegistrations,
      reviews: { total: totalReviews, avgRating: avgRatingRaw._avg.rating ? Math.round(avgRatingRaw._avg.rating * 10) / 10 : null },
      logins: { today: loginsToday, week: loginsWeek },
    };
  }

  /* ── Full session detail (admin) ──────────────────────── */
  async getSessionDetail(id: number) {
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, name: true, email: true,
            avatarUrl: true, title: true, bio: true, primaryCategory: true,
            verified: true, createdAt: true,
          },
        },
        registrations: {
          include: { session: false },
          orderBy: { createdAt: 'desc' },
        },
        attendances: { orderBy: { joinedAt: 'desc' } },
        _count: { select: { registrations: true } },
      },
    });

    // Enrich registrations with user info
    const regUserIds = session.registrations.map((r: { userId: number }) => r.userId);
    const regUsers = regUserIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: regUserIds } },
          select: { id: true, firstName: true, lastName: true, name: true, email: true, avatarUrl: true, createdAt: true },
        })
      : [];
    const regUserMap = new Map(regUsers.map(u => [u.id, u]));

    // Audit log
    const auditLog = await this.prisma.sessionAuditLog.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'desc' },
    });
    const adminIds = [...new Set(auditLog.map((l: { adminId: number }) => l.adminId))];
    const admins = adminIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, firstName: true, lastName: true, name: true, email: true },
        })
      : [];
    const adminMap = new Map(admins.map(a => [a.id, a]));

    // Teacher stats
    const [tSessions, tRating] = await Promise.all([
      this.prisma.session.count({ where: { userId: session.userId, status: 'published', approved: true } }),
      this.prisma.review.aggregate({ where: { teacherId: session.userId, rating: { gt: 0 } }, _avg: { rating: true }, _count: { _all: true } }),
    ]);

    return {
      ...session,
      user: {
        ...session.user,
        sessionCount: tSessions,
        reviewCount:  tRating._count._all,
        avgRating:    tRating._avg.rating ? Math.round(tRating._avg.rating * 10) / 10 : null,
      },
      registrations: session.registrations.map((r: { id: number; userId: number; sessionId: number; createdAt: Date }) => ({
        ...r,
        user: regUserMap.get(r.userId) ?? null,
      })),
      auditLog: auditLog.map((l: { id: number; sessionId: number; adminId: number; field: string; oldValue: string | null; newValue: string | null; note: string | null; createdAt: Date }) => ({
        ...l,
        admin: adminMap.get(l.adminId) ?? null,
      })),
    };
  }

  /* ── Session approval ──────────────────────────────────── */
  async getPendingSessions() {
    const sessions = await this.prisma.session.findMany({
      where: { status: 'published', approved: false },
      include: { user: { select: { id: true, firstName: true, lastName: true, name: true, email: true, avatarUrl: true } }, _count: { select: { registrations: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return sessions;
  }

  async approveSession(id: number) {
    const session = await this.prisma.session.update({
      where: { id },
      data: { approved: true },
      include: { user: { select: { email: true, name: true } } },
    });
    this.mail.sendSessionApproved(session.user.email, session.user.name, session.title, id).catch(() => {});
    return session;
  }

  async rejectSession(id: number, reason?: string) {
    const session = await this.prisma.session.update({
      where: { id },
      data: { approved: false, status: 'draft', qualityFlag: reason || 'REJECTED' },
      include: { user: { select: { email: true, name: true } } },
    });
    this.mail.sendSessionRejected(session.user.email, session.user.name, session.title, reason).catch(() => {});
    return session;
  }

  /* ── Session search (exhaustive) ──────────────────────── */
  async searchSessions(opts: {
    q?: string; type?: string; status?: string;
    approved?: string; from?: string; to?: string; take?: number;
  }) {
    const term = opts.q?.trim() ?? '';
    const where: Record<string, unknown> = {};

    if (term) {
      where['OR'] = [
        { title:    { contains: term } },
        { category: { contains: term } },
        { description: { contains: term } },
        { tags:     { contains: term } },
        { type:     { contains: term } },
        { user: { firstName: { contains: term } } },
        { user: { lastName:  { contains: term } } },
        { user: { name:      { contains: term } } },
        { user: { email:     { contains: term } } },
      ];
    }
    if (opts.type   && opts.type   !== 'all') where['type']   = opts.type;
    if (opts.status && opts.status !== 'all') where['status'] = opts.status;
    if (opts.approved === 'true')  where['approved'] = true;
    if (opts.approved === 'false') where['approved'] = false;
    if (opts.from || opts.to) {
      where['scheduledAt'] = {
        ...(opts.from ? { gte: new Date(opts.from) } : {}),
        ...(opts.to   ? { lte: new Date(opts.to)   } : {}),
      };
    }

    return this.prisma.session.findMany({
      where,
      take: Math.min(opts.take ?? 100, 200),
      orderBy: { scheduledAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, name: true, email: true } },
        _count: { select: { registrations: true } },
      },
    });
  }

  /* ── Update session schedule ───────────────────────────── */
  async updateSchedule(sessionId: number, adminId: number, scheduledAt: string, note?: string) {
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    const oldValue = session.scheduledAt.toISOString();
    const newDate  = new Date(scheduledAt);

    await this.prisma.session.update({ where: { id: sessionId }, data: { scheduledAt: newDate } });
    await this.prisma.sessionAuditLog.create({
      data: { sessionId, adminId, field: 'scheduledAt', oldValue, newValue: newDate.toISOString(), note: note ?? null },
    });
    return { ok: true };
  }

  /* ── Session audit log ─────────────────────────────────── */
  async getAuditLog(sessionId: number) {
    const logs = await this.prisma.sessionAuditLog.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
    // Enrich with admin name
    const adminIds = [...new Set(logs.map(l => l.adminId))];
    const admins = await this.prisma.user.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, firstName: true, lastName: true, name: true, email: true },
    });
    const adminMap = new Map(admins.map(a => [a.id, a]));
    return logs.map(l => ({ ...l, admin: adminMap.get(l.adminId) ?? null }));
  }

  /* ── Session stats ─────────────────────────────────────── */
  async getSessionStats() {
    const [byStatus, byType, byCategory, recentSessions, trend] = await Promise.all([
      // counts by sessionStatus
      this.prisma.session.groupBy({ by: ['sessionStatus'], _count: { _all: true } }),
      // counts by type
      this.prisma.session.groupBy({ by: ['type'], _count: { _all: true } }),
      // counts by category
      this.prisma.session.groupBy({ by: ['category'], _count: { _all: true }, orderBy: { _count: { category: 'desc' } }, take: 10 }),
      // recent 20 sessions with teacher + registration count
      this.prisma.session.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, name: true, email: true } },
          _count: { select: { registrations: true } },
        },
      }),
      // daily session creation for last 90 days (UTC date strings)
      this.prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE_FORMAT(CONVERT_TZ(createdAt, @@session.time_zone, '+00:00'), '%Y-%m-%d') as day, COUNT(*) as count
        FROM Session
        WHERE createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY)
        GROUP BY day ORDER BY day ASC
      `,
    ]);

    return {
      byStatus: byStatus.map(r => ({ status: r.sessionStatus ?? 'Active', count: r._count._all })),
      byType: byType.map(r => ({ type: r.type, count: r._count._all })),
      byCategory: byCategory.map(r => ({ category: r.category ?? 'Uncategorized', count: r._count._all })),
      recent: recentSessions,
      trend: trend.map(r => ({ day: String(r.day), count: Number(r.count) })),
    };
  }

  /* ── User management ──────────────────────────────────── */
  async searchUsers(q?: string, take = 50) {
    const term = q?.trim() ?? '';
    const where = term ? {
      OR: [
        { firstName: { contains: term } },
        { lastName:  { contains: term } },
        { name:      { contains: term } },
        { email:     { contains: term } },
      ],
    } : {};
    return this.prisma.user.findMany({
      where,
      take: Math.min(take, 200),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, firstName: true, lastName: true, name: true, email: true,
        role: true, disabled: true, verified: true, createdAt: true, lastLoginAt: true,
        avatarUrl: true, title: true, primaryCategory: true,
        _count: { select: { sessions: true } },
      },
    });
  }

  async getUser(id: number) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true, firstName: true, lastName: true, name: true, email: true,
        role: true, disabled: true, verified: true, createdAt: true, lastLoginAt: true,
        avatarUrl: true, title: true, bio: true, primaryCategory: true,
        country: true, city: true, phone: true,
        _count: { select: { sessions: true } },
      },
    });
    const [regCount, reviewCount] = await Promise.all([
      this.prisma.registration.count({ where: { userId: id } }),
      this.prisma.review.count({ where: { authorId: id } }),
    ]);
    return { ...user, registrationCount: regCount, reviewCount };
  }

  async updateUser(id: number, data: {
    disabled?: boolean; role?: string;
    firstName?: string; lastName?: string; email?: string;
  }) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true, firstName: true, lastName: true, email: true,
        role: true, disabled: true, verified: true,
      },
    });
  }

  /* ── Insights ─────────────────────────────────────────── */

  async getLoginEngagement(period: string) {
    const periodDays: Record<string, number> = { today: 0, '7d': 7, '30d': 30, '90d': 90 };
    const days = periodDays[period] ?? 7;

    let fromDate: Date;
    if (period === 'today') {
      fromDate = new Date();
      fromDate.setHours(0, 0, 0, 0);
    } else {
      fromDate = new Date(Date.now() - days * 86_400_000);
    }

    const rows = await this.prisma.$queryRaw<{ userId: number; loginCount: bigint }[]>`
      SELECT userId, COUNT(*) as loginCount
      FROM LoginLog
      WHERE createdAt >= ${fromDate}
      GROUP BY userId
      ORDER BY loginCount DESC
      LIMIT 20
    `;

    if (!rows.length) return [];
    const userIds = rows.map(r => r.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, name: true, email: true, avatarUrl: true, role: true, lastLoginAt: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    return rows.map(r => ({
      userId: r.userId,
      loginCount: Number(r.loginCount),
      user: userMap.get(r.userId) ?? null,
    }));
  }

  async getTopTeachers() {
    // By rating
    const byRating = await this.prisma.$queryRaw<{ teacherId: number; avgRating: number; reviewCount: bigint }[]>`
      SELECT teacherId, ROUND(AVG(rating), 2) as avgRating, COUNT(*) as reviewCount
      FROM Review
      WHERE rating > 0
      GROUP BY teacherId
      HAVING reviewCount >= 1
      ORDER BY avgRating DESC, reviewCount DESC
      LIMIT 10
    `;

    // By session count (webinar + live)
    const bySessions = await this.prisma.$queryRaw<{ userId: number; sessionCount: bigint; webinarCount: bigint; liveCount: bigint }[]>`
      SELECT userId,
        COUNT(*) as sessionCount,
        SUM(CASE WHEN type = 'webinar' THEN 1 ELSE 0 END) as webinarCount,
        SUM(CASE WHEN type = 'live'    THEN 1 ELSE 0 END) as liveCount
      FROM Session
      WHERE status = 'published' AND approved = true
      GROUP BY userId
      ORDER BY sessionCount DESC
      LIMIT 10
    `;

    // Enrich both with user info
    const allIds = [...new Set([...byRating.map(r => r.teacherId), ...bySessions.map(r => r.userId)])];
    const users = allIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: allIds } },
          select: { id: true, firstName: true, lastName: true, name: true, email: true, avatarUrl: true, title: true },
        })
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));

    return {
      byRating: byRating.map(r => ({
        teacherId: r.teacherId,
        avgRating: Number(r.avgRating),
        reviewCount: Number(r.reviewCount),
        user: userMap.get(r.teacherId) ?? null,
      })),
      bySessions: bySessions.map(r => ({
        userId: r.userId,
        sessionCount: Number(r.sessionCount),
        webinarCount: Number(r.webinarCount),
        liveCount:    Number(r.liveCount),
        user: userMap.get(r.userId) ?? null,
      })),
    };
  }

  async getTopStudents(page: number, take: number) {
    const safeTake = Math.min(take, 50);
    const offset   = (page - 1) * safeTake;

    const rows = await this.prisma.$queryRaw<{ userId: number; regCount: bigint }[]>`
      SELECT userId, COUNT(*) as regCount
      FROM Registration
      GROUP BY userId
      ORDER BY regCount DESC
      LIMIT ${safeTake} OFFSET ${offset}
    `;

    const total = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(DISTINCT userId) as total FROM Registration
    `;

    if (!rows.length) return { data: [], total: 0, page, take: safeTake };

    const userIds = rows.map(r => r.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, name: true, email: true, avatarUrl: true, createdAt: true, lastLoginAt: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    return {
      data: rows.map((r, i) => ({
        rank: offset + i + 1,
        userId: r.userId,
        regCount: Number(r.regCount),
        user: userMap.get(r.userId) ?? null,
      })),
      total: Number(total[0]?.total ?? 0),
      page,
      take: safeTake,
    };
  }

  async getSubscriberInsights() {
    const top = await this.prisma.$queryRaw<{ teacherId: number; total: bigint }[]>`
      SELECT teacherId, COUNT(*) as total
      FROM Subscription
      GROUP BY teacherId
      ORDER BY total DESC
      LIMIT 10
    `;
    if (!top.length) return { topTeachers: [] };

    const teacherIds = top.map(t => t.teacherId);
    const now = new Date();
    const d7  = new Date(now.getTime() -  7 * 86_400_000);
    const d30 = new Date(now.getTime() - 30 * 86_400_000);
    const d90 = new Date(now.getTime() - 90 * 86_400_000);

    const [growth7, growth30, growth90, trendRaw, users] = await Promise.all([
      this.prisma.$queryRaw<{ teacherId: number; count: bigint }[]>`
        SELECT teacherId, COUNT(*) as count FROM Subscription
        WHERE teacherId IN (${Prisma.join(teacherIds)}) AND createdAt >= ${d7}
        GROUP BY teacherId
      `,
      this.prisma.$queryRaw<{ teacherId: number; count: bigint }[]>`
        SELECT teacherId, COUNT(*) as count FROM Subscription
        WHERE teacherId IN (${Prisma.join(teacherIds)}) AND createdAt >= ${d30}
        GROUP BY teacherId
      `,
      this.prisma.$queryRaw<{ teacherId: number; count: bigint }[]>`
        SELECT teacherId, COUNT(*) as count FROM Subscription
        WHERE teacherId IN (${Prisma.join(teacherIds)}) AND createdAt >= ${d90}
        GROUP BY teacherId
      `,
      this.prisma.$queryRaw<{ teacherId: number; day: string; count: bigint }[]>`
        SELECT teacherId,
          DATE_FORMAT(CONVERT_TZ(createdAt, @@session.time_zone, '+00:00'), '%Y-%m-%d') as day,
          COUNT(*) as count
        FROM Subscription
        WHERE teacherId IN (${Prisma.join(teacherIds)}) AND createdAt >= ${d30}
        GROUP BY teacherId, day
        ORDER BY day ASC
      `,
      this.prisma.user.findMany({
        where: { id: { in: teacherIds } },
        select: { id: true, firstName: true, lastName: true, name: true, email: true, avatarUrl: true, title: true },
      }),
    ]);

    const userMap = new Map(users.map(u => [u.id, u]));
    const g7Map  = new Map((growth7  as { teacherId: number; count: bigint }[]).map(g => [g.teacherId, Number(g.count)]));
    const g30Map = new Map((growth30 as { teacherId: number; count: bigint }[]).map(g => [g.teacherId, Number(g.count)]));
    const g90Map = new Map((growth90 as { teacherId: number; count: bigint }[]).map(g => [g.teacherId, Number(g.count)]));

    const trendMap = new Map<number, Map<string, number>>();
    for (const row of trendRaw as { teacherId: number; day: string; count: bigint }[]) {
      if (!trendMap.has(row.teacherId)) trendMap.set(row.teacherId, new Map());
      trendMap.get(row.teacherId)!.set(String(row.day), Number(row.count));
    }

    const days30: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      days30.push(d.toISOString().slice(0, 10));
    }

    return {
      topTeachers: top.map(t => ({
        teacherId: t.teacherId,
        totalSubscribers: Number(t.total),
        new7d:  g7Map.get(t.teacherId)  ?? 0,
        new30d: g30Map.get(t.teacherId) ?? 0,
        new90d: g90Map.get(t.teacherId) ?? 0,
        user: userMap.get(t.teacherId) ?? null,
        trend: days30.map(day => ({ day, count: trendMap.get(t.teacherId)?.get(day) ?? 0 })),
      })),
    };
  }

  /* ── User stats ────────────────────────────────────────── */
  async getUserStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [recentUsers, loginLogs, signupDaily, signupMonthly, loginDaily, loginMonthly, browserStats] = await Promise.all([
      // recent 50 users
      this.prisma.user.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: { id: true, firstName: true, lastName: true, name: true, email: true, role: true, verified: true, createdAt: true, lastLoginAt: true, avatarUrl: true },
      }),
      // recent 100 login logs with user info
      this.prisma.loginLog.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, firstName: true, lastName: true, name: true, email: true } } },
      }),
      // signup trend — 90 days daily
      this.prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE_FORMAT(CONVERT_TZ(createdAt, @@session.time_zone, '+00:00'), '%Y-%m-%d') as day, COUNT(*) as count
        FROM User
        WHERE createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY)
        GROUP BY day ORDER BY day ASC
      `,
      // signup trend — 12 months monthly
      this.prisma.$queryRaw<{ month: string; count: bigint }[]>`
        SELECT DATE_FORMAT(CONVERT_TZ(createdAt, @@session.time_zone, '+00:00'), '%Y-%m') as month, COUNT(*) as count
        FROM User
        WHERE createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 12 MONTH)
        GROUP BY month ORDER BY month ASC
      `,
      // login trend — 90 days daily
      this.prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE_FORMAT(CONVERT_TZ(createdAt, @@session.time_zone, '+00:00'), '%Y-%m-%d') as day, COUNT(*) as count
        FROM LoginLog
        WHERE createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY)
        GROUP BY day ORDER BY day ASC
      `,
      // login trend — 12 months monthly
      this.prisma.$queryRaw<{ month: string; count: bigint }[]>`
        SELECT DATE_FORMAT(CONVERT_TZ(createdAt, @@session.time_zone, '+00:00'), '%Y-%m') as month, COUNT(*) as count
        FROM LoginLog
        WHERE createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 12 MONTH)
        GROUP BY month ORDER BY month ASC
      `,
      // browser + OS breakdown (single query)
      this.prisma.loginLog.findMany({ select: { userAgent: true }, take: 1000, orderBy: { createdAt: 'desc' } }),
    ]);

    // Compute browser / OS buckets from raw logs
    const browserMap: Record<string, number> = {};
    const osMap: Record<string, number> = {};
    for (const log of browserStats) {
      const { browser, os } = parseUA(log.userAgent);
      browserMap[browser] = (browserMap[browser] || 0) + 1;
      osMap[os] = (osMap[os] || 0) + 1;
    }

    const enrichedLogs = (loginLogs as unknown as Array<{ id: number; userId: number; ip: string | null; userAgent: string | null; createdAt: Date; user: { id: number; firstName: string | null; lastName: string | null; name: string | null; email: string } }>).map(l => ({
      ...l,
      ...parseUA(l.userAgent),
    }));

    return {
      recentUsers,
      loginLogs: enrichedLogs,
      signupDaily:   (signupDaily   as { day:   string; count: bigint }[]).map(r => ({ day:   String(r.day),   count: Number(r.count) })),
      signupMonthly: (signupMonthly as { month: string; count: bigint }[]).map(r => ({ month: String(r.month), count: Number(r.count) })),
      loginDaily:    (loginDaily    as { day:   string; count: bigint }[]).map(r => ({ day:   String(r.day),   count: Number(r.count) })),
      loginMonthly:  (loginMonthly  as { month: string; count: bigint }[]).map(r => ({ month: String(r.month), count: Number(r.count) })),
      browsers: Object.entries(browserMap).map(([name, count]) => ({ name, count })),
      os: Object.entries(osMap).map(([name, count]) => ({ name, count })),
    };
  }

  /* ── Contact messages ──────────────────────────────────────── */
  getContactMessages(unreadOnly = false, email?: string) {
    return this.prisma.contactMessage.findMany({
      where: {
        ...(unreadOnly ? { isRead: false } : {}),
        ...(email ? { email: { contains: email } } : {}),
      },
      include: { replies: { orderBy: { sentAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  getContactThread(email: string) {
    return this.prisma.contactMessage.findMany({
      where: { email },
      include: { replies: { orderBy: { sentAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async replyToContact(id: number, body: string) {
    const msg = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!msg) throw new NotFoundException('Message not found');

    const reply = await this.prisma.contactReply.create({
      data: { contactMessageId: id, body },
    });

    await this.prisma.contactMessage.update({ where: { id }, data: { isRead: true } });

    await this.mail.sendContactReply(msg.email, msg.name, msg.subject, body);

    return reply;
  }

  markContactRead(id: number) {
    return this.prisma.contactMessage.update({ where: { id }, data: { isRead: true } });
  }

  deleteContactMessage(id: number) {
    return this.prisma.contactMessage.delete({ where: { id } });
  }
}
