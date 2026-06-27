import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { CronJob } from 'cron';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as net from 'net';
import * as os from 'os';
import { RoomServiceClient } from 'livekit-server-sdk';

const execAsync = promisify(exec);

interface LogEntry {
  ts: string;
  msg: string;
  level: 'info' | 'warn' | 'error';
}

@Injectable()
export class RecordingService implements OnModuleInit {
  private readonly logger = new Logger(RecordingService.name);
  private s3: S3Client;
  private logs: LogEntry[] = [];
  private isRunning = false;

  private readonly recordingsDir = path.join(process.cwd(), 'uploads', 'recordings');
  private readonly tmpDir = path.join(process.cwd(), 'uploads', 'tmp');

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private scheduler: SchedulerRegistry,
  ) {
    this.s3 = new S3Client({
      endpoint: this.config.get<string>('IDRIVE_S3_ENDPOINT') || 'https://s3.eu-central-1.idrivee2.com',
      region: this.config.get<string>('IDRIVE_S3_REGION') || 'eu-central-1',
      credentials: {
        accessKeyId: this.config.get<string>('IDRIVE_S3_ACCESS_KEY') || '',
        secretAccessKey: this.config.get<string>('IDRIVE_S3_SECRET_KEY') || '',
      },
      forcePathStyle: true,
      // iDrive E2 requires SigV4 with path-style — disable checksum since E2 doesn't support it
      requestChecksumCalculation: 'WHEN_REQUIRED' as any,
      responseChecksumValidation: 'WHEN_REQUIRED' as any,
    });
  }

  onModuleInit() {
    fs.mkdirSync(this.tmpDir, { recursive: true });
    const cronExp = this.config.get<string>('RECORDING_UPLOAD_CRON') || '*/1 * * * *';
    const job = new CronJob(cronExp, () => this.processRecordings());
    this.scheduler.addCronJob('recording-upload', job);
    job.start();
    this.log('info', `Recording cron started — expression: ${cronExp}`);
  }

  /* ── Logging ─────────────────────────────────────────────────── */

  private log(level: 'info' | 'warn' | 'error', msg: string) {
    const entry: LogEntry = { ts: new Date().toISOString(), msg, level };
    this.logs.unshift(entry);
    if (this.logs.length > 300) this.logs.pop();
    if (level === 'error') this.logger.error(msg);
    else if (level === 'warn') this.logger.warn(msg);
    else this.logger.log(msg);
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  /* ── Main cron entry ─────────────────────────────────────────── */

  async processRecordings() {
    if (this.isRunning) {
      this.log('warn', '⏭ Previous run still in progress, skipping tick');
      return;
    }
    this.isRunning = true;
    try {
      await this._processAll();
    } finally {
      this.isRunning = false;
    }
  }

  async runManually(): Promise<{ ok: boolean; message: string }> {
    if (this.isRunning) {
      return { ok: false, message: 'Processing already in progress' };
    }
    // fire-and-forget
    this._processAll()
      .catch((e: Error) => this.log('error', `Manual run error: ${e.message}`))
      .finally(() => { this.isRunning = false; });
    this.isRunning = true;
    return { ok: true, message: 'Processing started' };
  }

  /* ── Core processing ─────────────────────────────────────────── */

  private async _processAll() {
    const pending = await this.prisma.sessionRecording.findMany({
      where: { uploadedToS3: false },
      orderBy: { createdAt: 'asc' },
    });

    if (pending.length === 0) {
      this.log('info', '⏭ No pending recordings');
      return;
    }

    this.log('info', `Found ${pending.length} pending recording(s)`);

    for (const rec of pending) {
      try {
        await this._processRecording(rec);
      } catch (e: unknown) {
        this.log('error', `❌ rec-${rec.id} session-${rec.sessionId}: ${(e as Error).message}`);
      }
    }
  }

  private async _processRecording(rec: { id: number; sessionId: number; filename: string }) {
    const mp4Path = path.join(this.recordingsDir, rec.filename);

    if (!fs.existsSync(mp4Path)) {
      this.log('warn', `⚠️  rec-${rec.id}: ${rec.filename} not found on disk — skipping`);
      return;
    }

    this.log('info', `🎬 rec-${rec.id} session-${rec.sessionId}: converting ${rec.filename}…`);

    const tmpDir = path.join(this.tmpDir, `session-${rec.sessionId}`, `hls-${rec.id}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Convert this single MP4 to HLS
    await this._convertToHLS(mp4Path, tmpDir);

    // Upload HLS to S3: session-{id}/hls-{recId}/index.m3u8
    const s3Prefix = `session-${rec.sessionId}/hls-${rec.id}`;
    await this._uploadDir(tmpDir, s3Prefix);
    const s3Key = `${s3Prefix}/index.m3u8`;

    // Update SessionRecording with s3Key and mark uploaded
    await this.prisma.sessionRecording.update({
      where: { id: rec.id },
      data: { uploadedToS3: true, s3Key },
    });

    // Move original MP4 to tmp
    const dest = path.join(this.tmpDir, `session-${rec.sessionId}`, rec.filename);
    try { fs.renameSync(mp4Path, dest); } catch { /* non-fatal */ }

    // Clean up HLS temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });

    this.log('info', `✅ rec-${rec.id}: uploaded → ${s3Key}`);
  }

  /* ── Scan disk for MP4s without DB rows ──────────────────────── */

  async scanDisk(): Promise<{ created: number; skipped: number; files: string[] }> {
    if (!fs.existsSync(this.recordingsDir)) {
      return { created: 0, skipped: 0, files: [] };
    }

    const files = fs.readdirSync(this.recordingsDir)
      .filter(f => f.endsWith('.mp4'));

    let created = 0;
    let skipped = 0;
    const createdFiles: string[] = [];

    for (const filename of files) {
      // Extract sessionId from pattern: session-{id}-{timestamp}.mp4
      const match = filename.match(/^session-(\d+)-/);
      if (!match) { skipped++; continue; }
      const sessionId = Number(match[1]);

      // Check if row already exists
      const existing = await this.prisma.sessionRecording.findFirst({
        where: { sessionId, filename },
      });
      if (existing) { skipped++; continue; }

      // Verify session exists in DB
      const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
      if (!session) { skipped++; continue; }

      await this.prisma.sessionRecording.create({
        data: { sessionId, filename, uploadedToS3: false },
      });
      created++;
      createdFiles.push(filename);
      this.log('info', `📥 Imported: ${filename} → session ${sessionId}`);
    }

    this.log('info', `Scan complete — ${created} imported, ${skipped} skipped`);
    return { created, skipped, files: createdFiles };
  }

  /* ── ffmpeg helpers ──────────────────────────────────────────── */

  private async _convertToHLS(inputPath: string, outputDir: string) {
    const out = path.join(outputDir, 'index.m3u8');
    const cmd = [
      'ffmpeg -y',
      `-i "${inputPath}"`,
      '-codec: copy',
      '-start_number 0',
      '-hls_time 10',
      '-hls_list_size 0',
      '-f hls',
      `"${out}"`,
    ].join(' ');
    await execAsync(cmd);
  }

  /* ── S3 upload ───────────────────────────────────────────────── */

  private async _uploadDir(localDir: string, s3Prefix: string) {
    const bucket = this.config.get<string>('IDRIVE_S3_BUCKET') || 'test-recordings';
    const files = fs.readdirSync(localDir);
    this.log('info', `  📤 Uploading ${files.length} HLS file(s) to S3…`);

    for (const file of files) {
      const filePath = path.join(localDir, file);
      const key = `${s3Prefix}/${file}`;
      const contentType = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';
      const body = fs.readFileSync(filePath);

      await this.s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: contentType,
      }));
    }
  }

  /* ── Bunny CDN signed URL ─────────────────────────────────────── */

  getSignedUrl(s3Key: string): string {
    const baseUrl = (this.config.get<string>('BUNNY_CDN_BASE_URL') || '').replace(/\/$/, '');
    return `${baseUrl}/${s3Key}`;
  }

  /* ── Health checks ───────────────────────────────────────────── */

  async testS3(): Promise<{ ok: boolean; message: string; detail?: string }> {
    const bucket = this.config.get<string>('IDRIVE_S3_BUCKET') || 'test-recordings';
    const key = 'health-check.txt';
    const bodyStr = `OpenClass health check ${new Date().toISOString()}`;
    const body = Buffer.from(bodyStr);

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: body, ContentLength: body.length, ContentType: 'text/plain',
      }));
      const res = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const text = await res.Body?.transformToString();
      await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

      if (text !== bodyStr) throw new Error('Read-back body mismatch');
      this.log('info', `✅ S3 health check passed — bucket: ${bucket}`);
      return {
        ok: true,
        message: `S3 connected — bucket "${bucket}" is writable`,
        detail: `Endpoint: ${this.config.get<string>('IDRIVE_S3_ENDPOINT')}`,
      };
    } catch (e: unknown) {
      this.log('error', `❌ S3 health check failed: ${(e as Error).message}`);
      return { ok: false, message: `S3 error: ${(e as Error).message}` };
    }
  }

  async testBunny(): Promise<{ ok: boolean; message: string; detail?: string }> {
    const baseUrl = this.config.get<string>('BUNNY_CDN_BASE_URL') || '';
    const token = this.config.get<string>('BUNNY_CDN_TOKEN') || '';
    const bucket = this.config.get<string>('IDRIVE_S3_BUCKET') || 'test-recordings';

    if (!baseUrl || !token) {
      return { ok: false, message: 'BUNNY_CDN_BASE_URL or BUNNY_CDN_TOKEN not set in .env' };
    }

    const s3Key = 'health-check.txt';
    const bodyBuf = Buffer.from(`OpenClass CDN health check ${new Date().toISOString()}`);

    try {
      // Write to S3 so CDN can pull it
      await this.s3.send(new PutObjectCommand({
        Bucket: bucket, Key: s3Key, Body: bodyBuf, ContentLength: bodyBuf.length, ContentType: 'text/plain',
      }));

      const signedUrl = this.getSignedUrl(s3Key);
      const cdnRes = await fetch(signedUrl);
      if (!cdnRes.ok) throw new Error(`CDN returned HTTP ${cdnRes.status}`);
      const text = await cdnRes.text();
      if (!text || !text.includes('OpenClass')) throw new Error('CDN response body mismatch');

      await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3Key }));
      this.log('info', '✅ Bunny CDN health check passed');
      return { ok: true, message: 'Bunny CDN is live — signed URL fetch succeeded', detail: baseUrl };
    } catch (e: unknown) {
      this.log('error', `❌ Bunny CDN health check failed: ${(e as Error).message}`);
      return { ok: false, message: `Bunny CDN error: ${(e as Error).message}` };
    }
  }

  async testFfmpeg(): Promise<{ ok: boolean; message: string; detail?: string }> {
    try {
      const { stdout } = await execAsync('ffmpeg -version');
      const version = stdout.split('\n')[0];
      this.log('info', `✅ ffmpeg OK — ${version}`);
      return { ok: true, message: 'ffmpeg is installed and in PATH', detail: version };
    } catch (e: unknown) {
      this.log('error', `❌ ffmpeg not found: ${(e as Error).message}`);
      return { ok: false, message: `ffmpeg not found: ${(e as Error).message}` };
    }
  }

  async testLiveKit(): Promise<{ ok: boolean; message: string; detail?: string }> {
    const apiKey    = this.config.get<string>('LIVEKIT_API_KEY')    || 'devkey';
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET') || 'secret';
    const wsUrl     = this.config.get<string>('LIVEKIT_URL')        || 'ws://localhost:7880';
    const httpUrl   = wsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
    try {
      const client = new RoomServiceClient(httpUrl, apiKey, apiSecret);
      await client.listRooms();
      this.log('info', `✅ LiveKit connected — ${httpUrl}`);
      return { ok: true, message: 'LiveKit server reachable', detail: httpUrl };
    } catch (e: unknown) {
      this.log('error', `❌ LiveKit check failed: ${(e as Error).message}`);
      return { ok: false, message: `LiveKit error: ${(e as Error).message}`, detail: httpUrl };
    }
  }

  async testRedis(): Promise<{ ok: boolean; message: string; detail?: string }> {
    const host = this.config.get<string>('REDIS_HOST') || 'localhost';
    const port = Number(this.config.get<string>('REDIS_PORT') || 6379);
    return new Promise(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(3000);
      socket.connect(port, host, () => {
        socket.destroy();
        this.log('info', `✅ Redis reachable at ${host}:${port}`);
        resolve({ ok: true, message: `Redis reachable`, detail: `${host}:${port}` });
      });
      socket.on('error', (e) => {
        socket.destroy();
        this.log('error', `❌ Redis error: ${e.message}`);
        resolve({ ok: false, message: `Redis error: ${e.message}`, detail: `${host}:${port}` });
      });
      socket.on('timeout', () => {
        socket.destroy();
        this.log('error', `❌ Redis timeout at ${host}:${port}`);
        resolve({ ok: false, message: `Redis timeout`, detail: `${host}:${port}` });
      });
    });
  }

  async getQueueStatus() {
    const [pending, uploaded, total] = await Promise.all([
      this.prisma.sessionRecording.findMany({ where: { uploadedToS3: false } }),
      this.prisma.sessionRecording.count({ where: { uploadedToS3: true } }),
      this.prisma.sessionRecording.count(),
    ]);

    const onDisk = pending.filter(r =>
      fs.existsSync(path.join(this.recordingsDir, r.filename)),
    );

    return {
      pendingTotal: pending.length,
      pendingOnDisk: onDisk.length,
      uploadedSessions: uploaded,
      totalRecordings: total,
      isRunning: this.isRunning,
      cronExpression: this.config.get<string>('RECORDING_UPLOAD_CRON') || '*/1 * * * *',
    };
  }

  async getUploadedSessions() {
    return this.prisma.sessionRecording.findMany({
      where: { uploadedToS3: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, sessionId: true, filename: true, s3Key: true, createdAt: true },
    });
  }

  /* ── System stats ───────────────────────────────────────────── */
  private _cpuUsagePercent(): Promise<number> {
    return new Promise(resolve => {
      const start = os.cpus();
      setTimeout(() => {
        const end = os.cpus();
        let totalIdle = 0, totalTick = 0;
        for (let i = 0; i < start.length; i++) {
          const st = start[i].times;
          const en = end[i].times;
          for (const type of Object.keys(st) as (keyof typeof st)[]) {
            totalTick += en[type] - st[type];
          }
          totalIdle += en.idle - st.idle;
        }
        resolve(totalTick === 0 ? 0 : Math.round(100 - (100 * totalIdle / totalTick)));
      }, 300);
    });
  }

  async getSystemStats() {
    const cpus       = os.cpus();
    const totalMem   = os.totalmem();
    const freeMem    = os.freemem();
    const usedMem    = totalMem - freeMem;
    const platform   = os.platform();

    // Top processes by CPU — Linux (--sort) and macOS (-r) both supported
    const psCmd = platform === 'linux'
      ? "ps aux --sort=-%cpu | head -11"
      : "ps aux -r | head -11";

    // Disk usage on root partition
    const dfCmd = "df -h /";

    const [psOut, dfOut, cpuPercent] = await Promise.all([
      execAsync(psCmd).then(r => r.stdout).catch(() => ''),
      execAsync(dfCmd).then(r => r.stdout).catch(() => ''),
      this._cpuUsagePercent(),
    ]);

    // Parse ps output into rows
    const psLines  = psOut.trim().split('\n');
    const psHeader = psLines[0] ?? '';
    const psRows   = psLines.slice(1).map(line => {
      const cols = line.trim().split(/\s+/);
      return {
        user:    cols[0]  ?? '',
        pid:     cols[1]  ?? '',
        cpu:     cols[2]  ?? '',
        mem:     cols[3]  ?? '',
        command: cols.slice(10).join(' ') || cols[10] || '',
      };
    });

    // Parse df output — second line has values
    const dfLines = dfOut.trim().split('\n');
    const dfCols  = (dfLines[1] ?? '').trim().split(/\s+/);
    const disk = {
      filesystem: dfCols[0] ?? '',
      size:       dfCols[1] ?? '',
      used:       dfCols[2] ?? '',
      avail:      dfCols[3] ?? '',
      usePercent: dfCols[4] ?? '',
      mount:      dfCols[5] ?? '',
    };

    return {
      platform,
      uptime:    os.uptime(),
      cpu: {
        model:      cpus[0]?.model ?? 'Unknown',
        cores:      cpus.length,
        usedPercent: cpuPercent,
        loadAvg:    os.loadavg(),
      },
      memory: {
        totalMB:     Math.round(totalMem / 1024 / 1024),
        usedMB:      Math.round(usedMem  / 1024 / 1024),
        freeMB:      Math.round(freeMem  / 1024 / 1024),
        usedPercent: Math.round((usedMem / totalMem) * 100),
      },
      disk,
      processes: { header: psHeader, rows: psRows },
    };
  }

  /* ── Sync DB from S3 ─────────────────────────────────────────── */
  async syncFromS3(): Promise<{ created: number; skipped: number; rows: { sessionId: number; s3Key: string }[] }> {
    const bucket = this.config.get<string>('IDRIVE_S3_BUCKET') || 'test-recordings';

    // List all objects, collect index.m3u8 keys
    const manifests: string[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'session-',
        ContinuationToken: continuationToken,
      }));
      for (const obj of res.Contents ?? []) {
        if (obj.Key?.endsWith('/index.m3u8')) manifests.push(obj.Key);
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    // Fetch existing s3Keys to avoid duplicates
    const existing = await this.prisma.sessionRecording.findMany({
      where: { uploadedToS3: true },
      select: { s3Key: true },
    });
    const existingKeys = new Set(existing.map(r => r.s3Key));

    let created = 0;
    let skipped = 0;
    const rows: { sessionId: number; s3Key: string }[] = [];

    for (const key of manifests) {
      if (existingKeys.has(key)) { skipped++; continue; }

      // Parse sessionId from key: "session-{id}/hls-.../index.m3u8"
      const match = key.match(/^session-(\d+)\//);
      if (!match) { skipped++; continue; }
      const sessionId = parseInt(match[1], 10);

      // Derive a placeholder filename from the folder name
      const folder = key.split('/').slice(0, 2).join('-'); // e.g. session-80-hls-4
      const filename = `${folder}.mp4`;

      await this.prisma.sessionRecording.create({
        data: { sessionId, filename, uploadedToS3: true, s3Key: key },
      });
      this.log('info', `🔄 sync-s3: created row for ${key}`);
      created++;
      rows.push({ sessionId, s3Key: key });
    }

    return { created, skipped, rows };
  }

  async getEgressLogs(statusFilter?: string): Promise<object[]> {
    const where = statusFilter && statusFilter !== 'all'
      ? { status: statusFilter }
      : {};

    const logs = await this.prisma.egressLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        session: {
          select: { id: true, title: true, scheduledAt: true },
        },
      },
    });

    return logs.map((l: typeof logs[number]) => ({
      ...l,
      fileSizeBytes: l.fileSizeBytes ? Number(l.fileSizeBytes) : null,
    }));
  }
}
