import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { ProfileModule } from './profile/profile.module';
import { SessionModule } from './session/session.module';
import { CategoryModule } from './category/category.module';
import { LiveModule } from './live/live.module';
import { AdminModule } from './admin/admin.module';
import { ContactModule } from './contact/contact.module';
import { RecordingModule } from './recording/recording.module';
import { StorageModule } from './storage/storage.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot(), PrismaModule, MailModule, AuthModule, StorageModule, ProfileModule, SessionModule, CategoryModule, LiveModule, AdminModule, ContactModule, RecordingModule, SupportModule],
})
export class AppModule {}
