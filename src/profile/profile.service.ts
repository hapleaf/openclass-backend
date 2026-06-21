import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

const PRIVATE_FIELDS = ['password', 'verificationCode', 'codeExpiresAt'];

function sanitize(user: Record<string, unknown>) {
  const out = { ...user };
  PRIVATE_FIELDS.forEach((f) => delete out[f]);
  return out;
}

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return sanitize(user as unknown as Record<string, unknown>);
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...dto,
        ...(dto.firstName || dto.lastName ? {
          name: [dto.firstName, dto.lastName].filter(Boolean).join(' ') || undefined,
        } : {}),
      },
    });
    return sanitize(updated as unknown as Record<string, unknown>);
  }

  async getPublicProfile(userId: number, viewerId?: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const sessions = await this.prisma.session.findMany({
      where: { userId, status: 'published', approved: true },
      include: { _count: { select: { registrations: true } } },
      orderBy: { scheduledAt: 'asc' },
    });

    const [subscriberCount, reviews] = await Promise.all([
      this.prisma.subscription.count({ where: { teacherId: userId } }),
      this.prisma.review.findMany({
        where: { teacherId: userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    let isSubscribed = false;
    let lastReviewAt: string | null = null;
    if (viewerId && viewerId !== userId) {
      const [sub, rev] = await Promise.all([
        this.prisma.subscription.findUnique({
          where: { subscriberId_teacherId: { subscriberId: viewerId, teacherId: userId } },
        }),
        this.prisma.review.findFirst({
          where: { authorId: viewerId, teacherId: userId },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      isSubscribed = !!sub;
      lastReviewAt = rev ? rev.createdAt.toISOString() : null;
    }

    const PUBLIC_FIELDS = [
      'id', 'firstName', 'lastName', 'name', 'title', 'subject',
      'primaryCategory', 'bio', 'avatarUrl', 'expertiseTags',
      'country', 'state', 'city',
      'linkedinUrl', 'twitterUrl', 'websiteUrl', 'youtubeUrl',
    ];
    const profile = Object.fromEntries(
      PUBLIC_FIELDS.map(k => [k, (user as Record<string, unknown>)[k] ?? null])
    );

    const enrichedReviews = await (async () => {
      const authorIds = [...new Set(reviews.map(r => r.authorId))];
      if (!authorIds.length) return reviews;
      const [authors, authorSessions, authorRatings] = await Promise.all([
        this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, avatarUrl: true, firstName: true, lastName: true } }),
        this.prisma.session.groupBy({ by: ['userId'], where: { userId: { in: authorIds }, status: 'published', approved: true }, _count: { _all: true } }),
        this.prisma.review.groupBy({ by: ['teacherId'], where: { teacherId: { in: authorIds }, rating: { gt: 0 } }, _avg: { rating: true }, _count: { _all: true } }),
      ]);
      const authorMap  = new Map(authors.map(a => [a.id, a]));
      const sessionMap = new Map(authorSessions.map(s => [s.userId, s._count._all]));
      const ratingMap  = new Map(authorRatings.map(r => [r.teacherId, { avg: r._avg.rating, count: r._count._all }]));
      return reviews.map(r => {
        const a   = authorMap.get(r.authorId);
        const rat = ratingMap.get(r.authorId);
        return {
          ...r,
          authorAvatarUrl:    a?.avatarUrl ?? null,
          authorFirstName:    a?.firstName ?? null,
          authorLastName:     a?.lastName  ?? null,
          authorSessionCount: sessionMap.get(r.authorId) ?? 0,
          authorReviewCount:  rat?.count ?? 0,
          authorAvgRating:    rat?.avg ? Math.round(rat.avg * 10) / 10 : null,
        };
      });
    })();

    return { profile, sessions, subscriberCount, isSubscribed, lastReviewAt, reviews: enrichedReviews };
  }

  async toggleSubscription(subscriberId: number, teacherId: number) {
    const existing = await this.prisma.subscription.findUnique({
      where: { subscriberId_teacherId: { subscriberId, teacherId } },
    });

    if (existing) {
      await this.prisma.subscription.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.subscription.create({ data: { subscriberId, teacherId } });
    }

    const count = await this.prisma.subscription.count({ where: { teacherId } });
    return { subscribed: !existing, count };
  }

  async getTeachers(category?: string, country?: string) {
    const where: Record<string, unknown> = {
      sessions: { some: { status: 'published', approved: true } },
    };
    if (country) where.country = country;
    if (category) where.primaryCategory = category;

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        name: true,
        title: true,
        primaryCategory: true,
        bio: true,
        avatarUrl: true,
        expertiseTags: true,
        country: true,
        city: true,
        createdAt: true,
        verified: true,
        sessions: {
          where: { status: 'published', approved: true },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (users.length === 0) return [];

    const teacherIds = users.map(u => u.id);
    const [subCounts, ratingAggs] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['teacherId'],
        where: { teacherId: { in: teacherIds } },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ['teacherId'],
        where: { teacherId: { in: teacherIds }, rating: { gt: 0 } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);
    const subMap    = new Map(subCounts.map(s => [s.teacherId, s._count._all]));
    const ratingMap = new Map(ratingAggs.map(r => [r.teacherId, { avg: r._avg.rating, count: r._count._all }]));

    return users.map(({ sessions, ...u }) => {
      const r = ratingMap.get(u.id);
      return {
        ...u,
        sessionCount:    sessions.length,
        subscriberCount: subMap.get(u.id) ?? 0,
        avgRating:       r?.avg ? Math.round(r.avg * 10) / 10 : null,
        reviewCount:     r?.count ?? 0,
      };
    });
  }

  async getDashboard(userId: number) {
    await this.syncStatuses(userId);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [user, sessions, subscriberCount, newSubscribers, reviews, avgRating, newReviews] =
      await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId } }),
        this.prisma.session.findMany({ where: { userId }, include: { _count: { select: { registrations: true } } }, orderBy: { scheduledAt: 'asc' } }),
        this.prisma.subscription.count({ where: { teacherId: userId } }),
        this.prisma.subscription.count({ where: { teacherId: userId, createdAt: { gte: monthStart } } }),
        this.prisma.review.findMany({ where: { teacherId: userId }, orderBy: { createdAt: 'desc' }, take: 5 }),
        this.prisma.review.aggregate({ where: { teacherId: userId, rating: { gt: 0 } }, _avg: { rating: true } }),
        this.prisma.review.count({ where: { teacherId: userId, createdAt: { gte: monthStart } } }),
      ]);

    if (!user) throw new NotFoundException('User not found');

    const completedThisMonth = sessions.filter(s => {
      const endMs = new Date(s.scheduledAt).getTime() + s.duration * 60_000;
      return s.status === 'published' && endMs < now.getTime() && new Date(s.scheduledAt) >= monthStart;
    });

    const recentSubs = await this.prisma.subscription.findMany({
      where: { teacherId: userId },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    const subUserIds = recentSubs.map(s => s.subscriberId);
    const subUsers = subUserIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: subUserIds } },
          select: { id: true, firstName: true, lastName: true, name: true },
        })
      : [];
    const subUserMap = new Map(subUsers.map(u => [u.id, u]));

    const activity = [
      ...recentSubs.map(s => {
        const u = subUserMap.get(s.subscriberId);
        const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.name || 'Someone';
        return { type: 'subscribe' as const, text: `${name} subscribed to your profile`, createdAt: s.createdAt };
      }),
      ...reviews.slice(0, 6).map(r => ({
        type: 'review' as const, text: `${r.authorName} left a ${r.rating}-star review`, createdAt: r.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);

    return {
      profile: sanitize(user as unknown as Record<string, unknown>),
      sessions,
      stats: {
        subscriberCount,
        avgRating: avgRating._avg.rating ? Math.round(avgRating._avg.rating * 10) / 10 : null,
        totalSessions: sessions.filter((s: { status: string; approved: boolean }) => s.status === 'published' && s.approved).length,
        totalReviews: reviews.length,
      },
      thisMonth: {
        sessionsHeld: completedThisMonth.length,
        newSubscribers,
        teachingMinutes: completedThisMonth.reduce((sum, s) => sum + s.duration, 0),
        newReviews,
      },
      recentReviews: await (async () => {
        const recent = reviews.slice(0, 3);
        const authorIds = [...new Set(recent.map(r => r.authorId))];
        if (!authorIds.length) return recent;
        const [authors, authorSessions, authorRatings] = await Promise.all([
          this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, avatarUrl: true, firstName: true, lastName: true, name: true } }),
          this.prisma.session.groupBy({ by: ['userId'], where: { userId: { in: authorIds }, status: 'published', approved: true }, _count: { _all: true } }),
          this.prisma.review.groupBy({ by: ['teacherId'], where: { teacherId: { in: authorIds }, rating: { gt: 0 } }, _avg: { rating: true }, _count: { _all: true } }),
        ]);
        const authorMap  = new Map(authors.map(a => [a.id, a]));
        const sessionMap = new Map(authorSessions.map(s => [s.userId, s._count._all]));
        const ratingMap  = new Map(authorRatings.map(r => [r.teacherId, { avg: r._avg.rating, count: r._count._all }]));
        return recent.map(r => {
          const a   = authorMap.get(r.authorId);
          const rat = ratingMap.get(r.authorId);
          return {
            ...r,
            authorAvatarUrl:    a?.avatarUrl ?? null,
            authorFirstName:    a?.firstName ?? null,
            authorLastName:     a?.lastName  ?? null,
            authorSessionCount: sessionMap.get(r.authorId) ?? 0,
            authorReviewCount:  rat?.count ?? 0,
            authorAvgRating:    rat?.avg ? Math.round(rat.avg * 10) / 10 : null,
          };
        });
      })(),
      recentActivity: activity,
    };
  }

  async getStudentDashboard(userId: number) {
    const now = new Date();

    const [user, subs] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.subscription.findMany({ where: { subscriberId: userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    if (!user) throw new NotFoundException('User not found');

    const teacherIds = subs.map(s => s.teacherId);

    // Registered sessions (always fetch regardless of following)
    const regIds = await this.prisma.registration.findMany({
      where: { userId },
      select: { sessionId: true },
      orderBy: { createdAt: 'desc' },
    });
    const rawRegistered = regIds.length
      ? await this.prisma.session.findMany({
          where: { id: { in: regIds.map(r => r.sessionId) }, status: 'published', approved: true },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, name: true, title: true, avatarUrl: true, verified: true } },
            _count: { select: { registrations: true } },
          },
          orderBy: { scheduledAt: 'asc' },
        })
      : [];

    // Enrich registered sessions with teacher stats (for badge + rating display)
    const registeredSessions = await (async () => {
      if (!rawRegistered.length) return rawRegistered;
      const tIds = [...new Set(rawRegistered.map(s => s.userId))];
      const [tSessions, tRatings] = await Promise.all([
        this.prisma.session.groupBy({ by: ['userId'], where: { userId: { in: tIds }, status: 'published', approved: true }, _count: { _all: true } }),
        this.prisma.review.groupBy({ by: ['teacherId'], where: { teacherId: { in: tIds }, rating: { gt: 0 } }, _avg: { rating: true }, _count: { _all: true } }),
      ]);
      const sessionMap = new Map(tSessions.map(s => [s.userId, s._count._all]));
      const ratingMap  = new Map(tRatings.map(r => [r.teacherId, { avg: r._avg.rating, count: r._count._all }]));
      return rawRegistered.map(s => {
        const rat = ratingMap.get(s.userId);
        return {
          ...s,
          user: {
            ...s.user,
            sessionCount: sessionMap.get(s.userId) ?? 0,
            avgRating:    rat?.avg ? Math.round(rat.avg * 10) / 10 : null,
            reviewCount:  rat?.count ?? 0,
          },
        };
      });
    })();

    if (teacherIds.length === 0) {
      return {
        profile: sanitize(user as unknown as Record<string, unknown>),
        stats: { following: 0 },
        followedTeachers: [],
        upcomingSessions: [],
        registeredSessions,
      };
    }

    const [teachers, upcomingSessions, subCounts, ratingAggs] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: teacherIds } },
        select: {
          id: true, firstName: true, lastName: true, name: true,
          title: true, primaryCategory: true, avatarUrl: true, verified: true,
          sessions: {
            where: { status: 'published', approved: true },
            select: { id: true, type: true },
          },
        },
      }),
      this.prisma.session.findMany({
        where: {
          userId: { in: teacherIds },
          status: 'published', approved: true, visibility: 'public',
          scheduledAt: { gte: now },
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, name: true, title: true, avatarUrl: true, verified: true },
          },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 10,
      }),
      this.prisma.subscription.groupBy({
        by: ['teacherId'],
        where: { teacherId: { in: teacherIds } },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ['teacherId'],
        where: { teacherId: { in: teacherIds }, rating: { gt: 0 } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    const subMap = new Map(subCounts.map(s => [s.teacherId, s._count._all]));
    const ratingMap = new Map(ratingAggs.map(r => [r.teacherId, { avg: r._avg.rating, count: r._count._all }]));

    const followedTeachers = teacherIds
      .map(tid => teachers.find(t => t.id === tid))
      .filter(Boolean)
      .map(t => {
        const r = ratingMap.get(t!.id);
        return {
          ...t,
          liveCount: t!.sessions.filter(s => s.type !== 'webinar').length,
          webinarCount: t!.sessions.filter(s => s.type === 'webinar').length,
          subscriberCount: subMap.get(t!.id) ?? 0,
          avgRating: r?.avg ? Math.round(r.avg * 10) / 10 : null,
          reviewCount: r?.count ?? 0,
        };
      });

    return {
      profile: sanitize(user as unknown as Record<string, unknown>),
      stats: { following: subs.length },
      followedTeachers,
      upcomingSessions,
      registeredSessions,
    };
  }

  async getSubscribers(userId: number) {
    const subs = await this.prisma.subscription.findMany({
      where: { teacherId: userId },
      orderBy: { createdAt: 'desc' },
    });

    if (subs.length === 0) return [];

    const subscriberIds = subs.map(s => s.subscriberId);

    const [users, followedBack] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: subscriberIds } },
        select: { id: true, firstName: true, lastName: true, name: true, avatarUrl: true },
      }),
      this.prisma.subscription.findMany({
        where: { subscriberId: userId, teacherId: { in: subscriberIds } },
        select: { teacherId: true },
      }),
    ]);

    const userMap = new Map(users.map(u => [u.id, u]));
    const followedBackSet = new Set(followedBack.map(f => f.teacherId));

    return subs.map(s => {
      const u = userMap.get(s.subscriberId);
      return {
        id: s.subscriberId,
        name: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.name || 'User',
        avatarUrl: u?.avatarUrl ?? null,
        subscribedAt: s.createdAt,
        isFollowedBack: followedBackSet.has(s.subscriberId),
      };
    });
  }

  async getMySubscriptions(userId: number): Promise<{ teacherIds: number[] }> {
    const subs = await this.prisma.subscription.findMany({
      where: { subscriberId: userId },
      select: { teacherId: true },
    });
    return { teacherIds: subs.map(s => s.teacherId) };
  }

  async createReview(authorId: number, teacherId: number, rating: number, comment: string) {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);

    const recentReview = await this.prisma.review.findFirst({
      where: { authorId, teacherId, createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: 'desc' },
    });

    if (recentReview) {
      const nextAllowed = new Date(recentReview.createdAt.getTime() + SEVEN_DAYS_MS);
      const formatted = nextAllowed.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
      throw new BadRequestException(`You can submit a new review after ${formatted}`);
    }

    const author = await this.prisma.user.findUnique({ where: { id: authorId }, select: { firstName: true, lastName: true, name: true } });
    const authorName =
      [author?.firstName, author?.lastName].filter(Boolean).join(' ') ||
      author?.name ||
      'User';

    return this.prisma.review.create({
      data: { authorId, authorName, teacherId, rating, comment },
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
      const org = await this.prisma.sessionAttendance.findFirst({
        where: { sessionId: s.id, role: 'organizer' },
      });
      if (!org) {
        await this.prisma.session.update({ where: { id: s.id }, data: { sessionStatus: 'NO_SHOW' } });
        continue;
      }
      const lastOrg = await this.prisma.sessionAttendance.findFirst({
        where: { sessionId: s.id, role: 'organizer' },
        orderBy: { joinedAt: 'desc' },
      });
      if (lastOrg?.leftAt && new Date(lastOrg.leftAt.getTime() + 10 * 60_000) <= now) {
        await this.prisma.session.update({ where: { id: s.id }, data: { sessionStatus: 'ABANDONED' } });
      } else {
        await this.prisma.session.update({ where: { id: s.id }, data: { sessionStatus: 'COMPLETED' } });
      }
    }
  }
}
