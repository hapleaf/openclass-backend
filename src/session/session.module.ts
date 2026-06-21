import { Module } from '@nestjs/common';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RecordingModule } from '../recording/recording.module';

@Module({
  imports: [PrismaModule, RecordingModule],
  controllers: [SessionController],
  providers: [SessionService],
})
export class SessionModule {}
