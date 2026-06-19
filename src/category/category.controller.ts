import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('categories')
export class CategoryController {
  constructor(private prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  }
}
