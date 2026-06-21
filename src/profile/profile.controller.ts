import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { JwtGuard } from '../auth/jwt.guard';
import { ProfileService } from './profile.service';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { verifyToken } from '../helpers/jwt.helper';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 2 * 1024 * 1024;

@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  // ── public ────────────────────────────────────────────────────────────────
  @Get('teachers')
  getTeachers(
    @Query('category') category?: string,
    @Query('country') country?: string,
  ) {
    return this.profileService.getTeachers(category, country);
  }

  @Get('public/:userId')
  getPublic(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: { headers: { authorization?: string } },
  ) {
    let viewerId: number | undefined;
    try {
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        const payload = verifyToken<{ sub: number }>(auth.slice(7));
        viewerId = payload.sub;
      }
    } catch { /* unauthenticated visitor */ }
    return this.profileService.getPublicProfile(userId, viewerId);
  }

  // ── authenticated ─────────────────────────────────────────────────────────
  @Get('me')
  @UseGuards(JwtGuard)
  getMe(@Req() req: { user: { sub: number } }) {
    return this.profileService.getProfile(req.user.sub);
  }

  @Get('dashboard')
  @UseGuards(JwtGuard)
  getDashboard(@Req() req: { user: { sub: number } }) {
    return this.profileService.getDashboard(req.user.sub);
  }

  @Get('subscribers')
  @UseGuards(JwtGuard)
  getSubscribers(@Req() req: { user: { sub: number } }) {
    return this.profileService.getSubscribers(req.user.sub);
  }

  @Get('my-subscriptions')
  @UseGuards(JwtGuard)
  getMySubscriptions(@Req() req: { user: { sub: number } }) {
    return this.profileService.getMySubscriptions(req.user.sub);
  }

  @Get('student-dashboard')
  @UseGuards(JwtGuard)
  getStudentDashboard(@Req() req: { user: { sub: number } }) {
    return this.profileService.getStudentDashboard(req.user.sub);
  }

  @Patch('me')
  @UseGuards(JwtGuard)
  updateMe(@Req() req: { user: { sub: number } }, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user.sub, dto);
  }

  @Post('subscribe/:teacherId')
  @UseGuards(JwtGuard)
  toggleSubscribe(
    @Req() req: { user: { sub: number } },
    @Param('teacherId', ParseIntPipe) teacherId: number,
  ) {
    return this.profileService.toggleSubscription(req.user.sub, teacherId);
  }

  @Post('review/:teacherId')
  @UseGuards(JwtGuard)
  createReview(
    @Req() req: { user: { sub: number } },
    @Param('teacherId', ParseIntPipe) teacherId: number,
    @Body() dto: CreateReviewDto,
  ) {
    return this.profileService.createReview(req.user.sub, teacherId, dto.rating, dto.comment);
  }

  @Post('avatar')
  @UseGuards(JwtGuard)
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_TYPES.includes(file.mimetype)) {
          return cb(new BadRequestException('Only JPG, PNG and WebP files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(
    @Req() req: { user: { sub: number } },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const key = `${Date.now()}-${Math.round(Math.random() * 1e6)}${extname(file.originalname)}`;
    const bucket = this.config.get<string>('IDRIVE_S3_BUCKET_AVATARS') || 'test-avatars';
    await this.storage.uploadFile(bucket, key, file.buffer, file.mimetype);
    const avatarUrl = `/media/avatar/${key}`;
    return this.profileService.updateProfile(req.user.sub, { avatarUrl });
  }
}
