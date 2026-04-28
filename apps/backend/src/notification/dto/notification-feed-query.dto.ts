import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import {
  CursorPaginationQueryDto,
  SortOrder,
} from '../../common/dto/cursor-pagination.dto';
import { NotificationSeverity, NotificationType } from '../notification.entity';

export class NotificationFeedQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({ enum: NotificationType })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional({ enum: NotificationSeverity })
  @IsOptional()
  @IsEnum(NotificationSeverity)
  severity?: NotificationSeverity;
}

export interface NotificationFeedResponseDto<T> {
  items: T[];
  total: number;
  limit: number;
  sortOrder: SortOrder;
  nextCursor?: string;
}
