import { IsString, IsUrl, IsDateString, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateArticleDto {
  @IsString()
  title: string;

  @IsUrl()
  url: string;

  @IsString()
  source: string;

  @IsDateString()
  publishedAt: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sentimentScore?: number;
}
