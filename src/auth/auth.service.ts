import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SignupDto } from './dto/signup.dto';
import * as bcrypt from 'bcrypt';
import { generateCode } from '../utils/code.util';
import * as jwt from 'jsonwebtoken';

const CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function codeExpiry() {
  return new Date(Date.now() + CODE_TTL_MS);
}

function isExpired(expiresAt: Date | null): boolean {
  return !expiresAt || expiresAt < new Date();
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new BadRequestException('Email already registered');

    const hashed = await bcrypt.hash(dto.password, 10);
    const code = generateCode();

    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, password: hashed, verificationCode: code, codeExpiresAt: codeExpiry() },
    });

    try {
      await this.mail.sendVerification(user.email, user.name, code);
    } catch (err) {
      console.warn('Mail send failed (check SMTP config):', err);
    }

    return { ok: true, userId: user.id };
  }

  async login(body: { email: string; password: string; ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(body.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (!user.verified) throw new UnauthorizedException('Please verify your email before signing in');
    if (user.disabled)  throw new UnauthorizedException('Your account has been disabled. Please contact support.');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.prisma.loginLog.create({ data: { userId: user.id, ip: body.ip ?? null, userAgent: body.userAgent ?? null } });

    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'dev', { expiresIn: '7d' });
    return { accessToken: token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }

  async verifyOtp(email: string, otp: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    if (user.verified) throw new BadRequestException('Account already verified');
    if (isExpired(user.codeExpiresAt)) throw new BadRequestException('Verification code has expired. Please request a new one');
    if (user.verificationCode !== otp) throw new BadRequestException('Invalid verification code');

    await this.prisma.user.update({
      where: { email },
      data: { verified: true, verificationCode: null, codeExpiresAt: null },
    });

    const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET || 'dev', { expiresIn: '7d' });
    return { accessToken: token, user: { id: user.id, name: user.name, email: user.email } };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('No account found with this email');
    if (!user.verified) throw new BadRequestException('Please verify your email before resetting your password');

    const code = generateCode();
    await this.prisma.user.update({ where: { email }, data: { verificationCode: code, codeExpiresAt: codeExpiry() } });
    await this.mail.sendPasswordReset(email, user.name, code);
    return { ok: true };
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    if (isExpired(user.codeExpiresAt)) throw new BadRequestException('Reset code has expired. Please request a new one');
    if (user.verificationCode !== code) throw new BadRequestException('Invalid reset code');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { email },
      data: { password: hashed, verificationCode: null, codeExpiresAt: null },
    });
    return { ok: true };
  }

  async sendCode(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('No user found');
    const code = generateCode();
    await this.prisma.user.update({ where: { email }, data: { verificationCode: code, codeExpiresAt: codeExpiry() } });
    await this.mail.sendVerification(email, user.name, code);
    return { ok: true };
  }
}
