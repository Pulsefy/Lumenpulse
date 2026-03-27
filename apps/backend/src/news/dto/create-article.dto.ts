import {
  IsString,
  IsUrl,
  IsDateString,
  IsOptional,
  IsNumber,
  IsArray,
} from 'class-validator';
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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  category?: string;
}
