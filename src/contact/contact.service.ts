import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

interface CaptchaEntry { answer: number; expiresAt: number }

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly captchas = new Map<string, CaptchaEntry>();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes

  getCaptcha(): { id: string; question: string } {
    this.purgeExpired();
    const a = Math.floor(Math.random() * 12) + 1;
    const b = Math.floor(Math.random() * 12) + 1;
    const ops = [
      { q: `${a} + ${b}`, ans: a + b },
      { q: `${a + b} − ${b}`, ans: a },
    ];
    const { q, ans } = ops[Math.floor(Math.random() * ops.length)];
    const id = randomBytes(16).toString('hex');
    this.captchas.set(id, { answer: ans, expiresAt: Date.now() + this.TTL_MS });
    return { id, question: `What is ${q}?` };
  }

  verifyCaptcha(id: string, answer: number): void {
    const entry = this.captchas.get(id);
    if (!entry) throw new BadRequestException('Captcha expired or invalid. Please refresh and try again.');
    this.captchas.delete(id); // one-time use
    if (Date.now() > entry.expiresAt) throw new BadRequestException('Captcha expired. Please refresh and try again.');
    if (entry.answer !== answer) throw new BadRequestException('Incorrect captcha answer.');
  }

  async submit(dto: { name: string; email: string; subject: string; message: string; captchaId: string; captchaAnswer: number }) {
    this.verifyCaptcha(dto.captchaId, dto.captchaAnswer);
    return this.prisma.contactMessage.create({
      data: { name: dto.name, email: dto.email, subject: dto.subject, message: dto.message },
    });
  }

  private purgeExpired() {
    const now = Date.now();
    for (const [k, v] of this.captchas) {
      if (now > v.expiresAt) this.captchas.delete(k);
    }
  }
}
