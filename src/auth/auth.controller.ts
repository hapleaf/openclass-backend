import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || undefined;
    const userAgent = req.headers['user-agent'] || undefined;
    return this.auth.login({ ...dto, ip, userAgent });
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return this.auth.forgotPassword(body.email);
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { email: string; code: string; password: string }) {
    return this.auth.resetPassword(body.email, body.code, body.password);
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: { email: string; otp: string }) {
    return this.auth.verifyOtp(body.email, body.otp);
  }

  @Post('send-code')
  async sendCode(@Body() body: { email: string }) {
    return this.auth.sendCode(body.email);
  }
}
