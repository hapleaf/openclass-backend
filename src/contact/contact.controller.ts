import { Controller, Get, Post, Body } from '@nestjs/common';
import { ContactService } from './contact.service';

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Get('captcha')
  getCaptcha() { return this.contact.getCaptcha(); }

  @Post()
  submit(@Body() body: { name: string; email: string; subject: string; message: string; captchaId: string; captchaAnswer: number }) {
    return this.contact.submit(body);
  }
}
