import {
  IsString,
  IsUrl,
  IsDateString,
  IsOptional,
  IsNumber,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateArticleDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsUrl()
  url?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sentimentScore?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  category?: string;
}
