import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ContentType } from '../entities/report.entity';

export class CreateReportDto {
  @IsEnum(ContentType)
  @IsNotEmpty()
  contentType: ContentType;

  @IsString()
  @IsNotEmpty()
  contentId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsOptional()
  description?: string;
}