import { Module } from '@nestjs/common';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LiveController],
  providers: [LiveService],
})
export class LiveModule {}
