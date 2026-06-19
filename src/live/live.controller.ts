import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { LiveService } from './live.service';

@Controller('live')
export class LiveController {
  constructor(private readonly liveService: LiveService) {}

  @Get(':id/token')
  @UseGuards(JwtGuard)
  getToken(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
    @Query('passcode') passcode?: string,
  ) {
    return this.liveService.getToken(id, req.user.sub, passcode);
  }

  @Post(':id/join')
  @UseGuards(JwtGuard)
  recordJoin(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.liveService.recordJoin(id, req.user.sub);
  }

  @Post(':id/start-recording')
  @UseGuards(JwtGuard)
  startRecording(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.liveService.startRecordingManual(id, req.user.sub);
  }

  @Post(':id/leave')
  @UseGuards(JwtGuard)
  recordLeave(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.liveService.recordLeave(id, req.user.sub);
  }

  @Get(':id/status')
  getStatus(@Param('id', ParseIntPipe) id: number) {
    return this.liveService.getStatus(id);
  }

  @Post(':id/end')
  @UseGuards(JwtGuard)
  endSession(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.liveService.endSession(id, req.user.sub);
  }

  @Post(':id/cancel')
  @UseGuards(JwtGuard)
  cancelSession(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.liveService.cancelSession(id, req.user.sub);
  }

  @Get(':id/attendance')
  @UseGuards(JwtGuard)
  getAttendance(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.liveService.getAttendance(id, req.user.sub);
  }

  @Get('captcha')
  getCaptcha() {
    return this.liveService.generateCaptcha();
  }

  /** Called by the frontend to check / retrieve the recording URL after a session ends */
  @Get(':id/recording')
  getRecording(@Param('id', ParseIntPipe) id: number) {
    return this.liveService.getRecording(id);
  }

  /** LiveKit egress webhook — no JWT, verified by signature inside the service */
  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') auth: string,
  ) {
    const body = req.rawBody?.toString() ?? '';
    await this.liveService.handleWebhook(body, auth);
    return { ok: true };
  }

  @Post(':id/rate')
  @UseGuards(JwtGuard)
  rateSession(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { rating: number; comment: string; captchaToken: string; captchaAnswer: number },
  ) {
    return this.liveService.rateSession(
      id, req.user.sub, body.rating, body.comment, body.captchaToken, body.captchaAnswer,
    );
  }

  @Post(':id/organizer-comment')
  @UseGuards(JwtGuard)
  organizerComment(
    @Req() req: { user: { sub: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { comment: string },
  ) {
    return this.liveService.organizerComment(id, req.user.sub, body.comment);
  }
}
