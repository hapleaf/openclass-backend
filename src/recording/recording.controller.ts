import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { RecordingService } from './recording.service';
import { StorageService } from '../storage/storage.service';
import { AdminGuard } from '../admin/admin.guard';

@Controller('admin/recordings')
@UseGuards(AdminGuard)
export class RecordingController {
  constructor(private readonly recording: RecordingService, private readonly storageService: StorageService) {}

  @Post('migrate-urls')
  migrateUrls() {
    return this.storageService.migrateUrls();
  }

  @Post('run')
  runManually() {
    return this.recording.runManually();
  }

  @Get('queue')
  getQueueStatus() {
    return this.recording.getQueueStatus();
  }

  @Get('uploaded')
  getUploaded() {
    return this.recording.getUploadedSessions();
  }

  @Get('logs')
  getLogs() {
    return this.recording.getLogs();
  }

  @Post('test/s3')
  testS3() {
    return this.recording.testS3();
  }

  @Post('test/bunny')
  testBunny() {
    return this.recording.testBunny();
  }

  @Post('test/ffmpeg')
  testFfmpeg() {
    return this.recording.testFfmpeg();
  }

  @Post('test/livekit')
  testLiveKit() {
    return this.recording.testLiveKit();
  }

  @Post('test/redis')
  testRedis() {
    return this.recording.testRedis();
  }

  @Post('scan-disk')
  scanDisk() {
    return this.recording.scanDisk();
  }

  @Post('sync-s3')
  syncFromS3() {
    return this.recording.syncFromS3();
  }

  @Get('system')
  getSystemStats() {
    return this.recording.getSystemStats();
  }

  @Get('egress-logs')
  getEgressLogs(@Query('status') status?: string) {
    return this.recording.getEgressLogs(status);
  }
}
