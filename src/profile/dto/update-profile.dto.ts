import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() primaryCategory?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() bio?: string;
  @IsOptional() @IsString() avatarUrl?: string;
  @IsOptional() @IsString() expertiseTags?: string;

  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() timezone?: string;

  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() linkedinUrl?: string;
  @IsOptional() @IsString() twitterUrl?: string;
  @IsOptional() @IsString() websiteUrl?: string;
  @IsOptional() @IsString() youtubeUrl?: string;

  @IsOptional() @IsBoolean() notifySignups?: boolean;
  @IsOptional() @IsBoolean() notifyReviews?: boolean;
  @IsOptional() @IsBoolean() notifyReminders?: boolean;
  @IsOptional() @IsBoolean() notifyDigest?: boolean;
  @IsOptional() @IsBoolean() profilePublic?: boolean;
}
