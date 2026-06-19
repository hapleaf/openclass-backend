import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { JwtGuard } from '../auth/jwt.guard';
import { SessionService } from './session.service';
import { CreateSessionDto } from './dto/create-session.dto';

const BANNER_DIR = join(__dirname, '..', '..', 'uploads', 'session-banners');
if (!existsSync(BANNER_DIR)) mkdirSync(BANNER_DIR, { recursive: true });

const VIDEO_DIR = join(__dirname, '..', '..', 'uploads', 'session-videos');
if (!existsSync(VIDEO_DIR)) mkdirSync(VIDEO_DIR, { recursive: true });

@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  // ── public ────────────────────────────────────────────────────────────────
  @Get('browse')
  browsePublic() {
    return this.sessionService.browsePublic();
  }

  @Get('browse/:id')
  browsePublicOne(@Param('id', ParseIntPipe) id: number) {
    return this.sessionService.browsePublicOne(id);
  }

  // ── authenticated ─────────────────────────────────────────────────────────
  @Post()
  @UseGuards(JwtGuard)
  create(@Req() req: { user: { sub: number } }, @Body() dto: CreateSessionDto) {
    return this.sessionService.create(req.user.sub, dto);
  }

  @Get('my')
  @UseGuards(JwtGuard)
  findMy(@Req() req: { user: { sub: number } }) {
    return this.sessionService.findAllByUser(req.user.sub);
  }

  @Get('my-registrations')
  @UseGuards(JwtGuard)
  myRegistrations(@Req() req: { user: { sub: number } }) {
    return this.sessionService.getMyRegistrationIds(req.user.sub);
  }

  @Post(':id/register')
  @UseGuards(JwtGuard)
  register(@Req() req: { user: { sub: number } }, @Param('id', ParseIntPipe) id: number) {
    return this.sessionService.toggleRegistration(req.user.sub, id);
  }

  @Get(':id')
  @UseGuards(JwtGuard)
  findOne(@Req() req: { user: { sub: number } }, @Param('id', ParseIntPipe) id: number) {
    return this.sessionService.findOne(id, req.user.sub);
  }

  @Patch(':id')
  @UseGuards(JwtGuard)
  update(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateSessionDto>,
  ) {
    return this.sessionService.update(id, req.user.sub, dto);
  }

  @Post('upload-banner')
  @UseGuards(JwtGuard)
  @UseInterceptors(FileInterceptor('banner', {
    storage: diskStorage({
      destination: BANNER_DIR,
      filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${extname(file.originalname)}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
      else cb(new BadRequestException('Only JPG, PNG, WebP allowed'), false);
    },
  }))
  uploadBanner(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return { bannerUrl: `/uploads/session-banners/${file.filename}` };
  }

  @Post('upload-intro-video')
  @UseGuards(JwtGuard)
  @UseInterceptors(FileInterceptor('video', {
    storage: diskStorage({
      destination: VIDEO_DIR,
      filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.webm`),
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('video/')) cb(null, true);
      else cb(new BadRequestException('Only video files allowed'), false);
    },
  }))
  uploadIntroVideo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return { introVideoUrl: `/uploads/session-videos/${file.filename}` };
  }

  @Post(':id/recording')
  @UseGuards(JwtGuard)
  setRecording(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { recordingUrl: string },
  ) {
    return this.sessionService.setRecordingUrl(id, req.user.sub, body.recordingUrl);
  }

  @Delete(':id')
  @UseGuards(JwtGuard)
  remove(@Req() req: { user: { sub: number } }, @Param('id', ParseIntPipe) id: number) {
    return this.sessionService.remove(id, req.user.sub);
  }
}
