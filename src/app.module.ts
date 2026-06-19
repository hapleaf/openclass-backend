import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { ProfileModule } from './profile/profile.module';
import { SessionModule } from './session/session.module';
import { CategoryModule } from './category/category.module';
import { LiveModule } from './live/live.module';
import { AdminModule } from './admin/admin.module';
import { ContactModule } from './contact/contact.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, MailModule, AuthModule, ProfileModule, SessionModule, CategoryModule, LiveModule, AdminModule, ContactModule],
})
export class AppModule {}
