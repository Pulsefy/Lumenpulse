import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import {
  CursorPaginationQueryDto,
  SortOrder,
} from '../../common/dto/cursor-pagination.dto';
import { TransactionStatus, TransactionType } from './transaction.dto';

export enum TransactionSortBy {
  DATE = 'date',
}

export class TransactionHistoryQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ enum: TransactionSortBy, default: TransactionSortBy.DATE })
  @IsOptional()
  @IsEnum(TransactionSortBy)
  sortBy?: TransactionSortBy = TransactionSortBy.DATE;
}

export interface TransactionFeedResponseDto<T> {
  items: T[];
  total: number;
  limit: number;
  sortOrder: SortOrder;
  nextCursor?: string;
}
