import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ReportStatus } from '../entities/content-report.entity';

export enum ModerationDecision {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ESCALATED = 'escalated',
}

export class ModerationDecisionDto {
  @ApiProperty({ enum: ModerationDecision, enumName: 'ModerationDecision' })
  @IsEnum(ModerationDecision)
  decision: ModerationDecision;

  @ApiProperty({
    description: 'Required rationale for the moderation decision',
    example: 'Content violates the community guidelines.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  rationale: string;

  @ApiProperty({
    description: 'Optional notes added to the report',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNotes?: string;
}

export class QueueReportsDto {
  @ApiProperty({ description: 'Page number', required: false, default: 1 })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiProperty({
    description: 'Number of reports per page',
    required: false,
    default: 20,
  })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiProperty({
    description: 'Filter by report status',
    enum: ReportStatus,
    enumName: 'ReportStatus',
    required: false,
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}

export class AssignReviewerDto {
  @ApiProperty({
    description: 'Reviewer user ID to assign to the report',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  reviewerId?: string;
}
