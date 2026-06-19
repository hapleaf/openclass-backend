import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength, Min } from 'class-validator';

export class CreateSessionDto {
  @IsIn(['webinar', 'liveclass'])
  type: string;

  @IsString() @MaxLength(60)
  title: string;

  @IsString() @MinLength(250) @MaxLength(5000)
  description: string;

  @IsOptional() @IsString()
  bannerColor?: string;

  @IsOptional() @IsString()
  bannerUrl?: string;

  @IsOptional() @IsString()
  introVideoUrl?: string;

  @IsString()
  category: string;

  @IsString()
  skillLevel: string;

  @IsOptional() @IsString()
  tags?: string;

  @IsDateString()
  scheduledAt: string;

  @IsInt() @Min(15)
  duration: number;

  @IsOptional() @IsInt() @Min(1)
  audienceLimit?: number;

  @IsOptional() @IsIn(['public', 'private'])
  visibility?: string;

  @IsOptional() @IsString() @MaxLength(16)
  passcode?: string;

  @IsOptional() @IsBoolean()
  sendReminder?: boolean;

  @IsOptional() @IsIn(['draft', 'published'])
  status?: string;
}
