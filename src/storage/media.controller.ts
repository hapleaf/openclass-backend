import { Controller, Get, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { StorageService } from './storage.service';

@Controller('media')
export class MediaController {
  constructor(private storage: StorageService, private config: ConfigService) {}

  @Get('banner/:key')
  async banner(@Param('key') key: string, @Res() res: Response) {
    return this.proxy(this.config.get('IDRIVE_S3_BUCKET_BANNERS') || 'test-session-banners', key, res);
  }

  @Get('avatar/:key')
  async avatar(@Param('key') key: string, @Res() res: Response) {
    return this.proxy(this.config.get('IDRIVE_S3_BUCKET_AVATARS') || 'test-avatars', key, res);
  }

  @Get('video/:key')
  async video(@Param('key') key: string, @Res() res: Response) {
    return this.proxy(this.config.get('IDRIVE_S3_BUCKET_VIDEOS') || 'test-session-videos', key, res);
  }

  private async proxy(bucket: string, key: string, res: Response) {
    try {
      const { body, contentType, contentLength } = await this.storage.streamFile(bucket, key);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      if (contentLength) res.setHeader('Content-Length', String(contentLength));
      body.pipe(res);
    } catch {
      res.status(404).json({ message: 'File not found' });
    }
  }
}
