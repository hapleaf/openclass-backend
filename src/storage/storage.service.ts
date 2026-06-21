import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StorageService {
  private readonly s3: S3Client;

  constructor(private config: ConfigService, private prisma: PrismaService) {
    this.s3 = new S3Client({
      endpoint: config.get('IDRIVE_S3_ENDPOINT'),
      region: config.get('IDRIVE_S3_REGION') || 'us-east-1',
      credentials: {
        accessKeyId: config.get('IDRIVE_S3_ACCESS_KEY') || '',
        secretAccessKey: config.get('IDRIVE_S3_SECRET_KEY') || '',
      },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED' as any,
      responseChecksumValidation: 'WHEN_REQUIRED' as any,
    });
  }

  async uploadFile(bucket: string, key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentLength: buffer.length,
        ContentType: contentType,
      }),
    );
  }

  async streamFile(bucket: string, key: string): Promise<{ body: Readable; contentType: string; contentLength?: number }> {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return {
      body: result.Body as Readable,
      contentType: result.ContentType ?? 'application/octet-stream',
      contentLength: result.ContentLength,
    };
  }

  async migrateUrls(): Promise<{ banners: number; videos: number; avatars: number }> {
    const banners = await this.prisma.$executeRawUnsafe(
      "UPDATE `Session` SET bannerUrl = CONCAT('/media/banner/', SUBSTRING_INDEX(bannerUrl, '/', -1)) WHERE bannerUrl LIKE '/uploads/session-banners/%'",
    );
    const videos = await this.prisma.$executeRawUnsafe(
      "UPDATE `Session` SET introVideoUrl = CONCAT('/media/video/', SUBSTRING_INDEX(introVideoUrl, '/', -1)) WHERE introVideoUrl LIKE '/uploads/session-videos/%'",
    );
    const avatars = await this.prisma.$executeRawUnsafe(
      "UPDATE `User` SET avatarUrl = CONCAT('/media/avatar/', SUBSTRING_INDEX(avatarUrl, '/', -1)) WHERE avatarUrl LIKE '/uploads/avatars/%'",
    );
    return { banners, videos, avatars };
  }
}
