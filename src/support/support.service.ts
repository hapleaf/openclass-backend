import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ─── User actions ────────────────────────────────────────────────────────

  async createTicket(userId: number, dto: { subject: string; category?: string; message: string }) {
    const ticket = await this.prisma.supportTicket.create({
      data: { userId, subject: dto.subject, category: dto.category, message: dto.message },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
    });

    if (process.env.ADMIN_SUPPORT_EMAIL_ENABLED === 'true' && process.env.ADMIN_SUPPORT_EMAIL) {
      const userName = [ticket.user.firstName, ticket.user.lastName].filter(Boolean).join(' ') || ticket.user.email;
      await this.mail.sendNewSupportTicket(
        process.env.ADMIN_SUPPORT_EMAIL,
        ticket.id,
        dto.subject,
        dto.message,
        userName,
        ticket.user.email,
      ).catch(() => {/* don't fail the request if email fails */});
    }

    return ticket;
  }

  async listUserTickets(userId: number) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, subject: true, category: true, status: true, priority: true,
        createdAt: true, updatedAt: true,
        _count: { select: { replies: true } },
      },
    });
  }

  async getTicket(userId: number, ticketId: number) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        replies: { orderBy: { createdAt: 'asc' } },
        user: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId !== userId) throw new ForbiddenException('Access denied');
    return ticket;
  }

  async userReply(userId: number, ticketId: number, message: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId !== userId) throw new ForbiddenException('Access denied');
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
      throw new ForbiddenException('This ticket is resolved. Please create a new ticket.');
    }

    const reply = await this.prisma.supportReply.create({
      data: { ticketId, authorId: userId, isAdmin: false, message },
    });

    // move back to OPEN if it was IN_PROGRESS
    if (ticket.status === 'IN_PROGRESS') {
      await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'OPEN' } });
    }

    return reply;
  }

  // ─── Admin actions ───────────────────────────────────────────────────────

  async adminListTickets(filters: { status?: string; priority?: string; page: number; limit: number }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
          _count: { select: { replies: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { tickets, total, page: filters.page, limit: filters.limit };
  }

  async adminGetTicket(ticketId: number) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        replies: { orderBy: { createdAt: 'asc' } },
        user: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async adminReply(adminId: number, ticketId: number, message: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const [reply] = await Promise.all([
      this.prisma.supportReply.create({
        data: { ticketId, authorId: adminId, isAdmin: true, message },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'IN_PROGRESS', updatedAt: new Date() },
      }),
    ]);

    const userName = [ticket.user.firstName, ticket.user.lastName].filter(Boolean).join(' ') || ticket.user.email;
    await this.mail.sendSupportReplyToUser(
      ticket.user.email,
      userName,
      ticket.id,
      ticket.subject,
      message,
    ).catch(() => {});

    return reply;
  }

  async adminUpdateStatus(ticketId: number, dto: { status?: string; priority?: string }) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { ...(dto.status && { status: dto.status }), ...(dto.priority && { priority: dto.priority }) },
    });
  }
}
