import { Module } from '@nestjs/common';
import { CategoryController } from './category.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [CategoryController],
  providers: [PrismaService],
})
export class CategoryModule {}
