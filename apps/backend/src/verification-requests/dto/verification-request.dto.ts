import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  VerificationRequestStatus,
  VerificationRequestTargetType,
} from '../entities/verification-request.entity';

export class CreateVerificationRequestDto {
  @ApiProperty({ enum: VerificationRequestTargetType })
  @IsEnum(VerificationRequestTargetType)
  targetType: VerificationRequestTargetType;

  @ApiProperty({ example: 'project-123' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  targetId: string;

  @ApiProperty({
    description: 'Links or other evidence supporting the request',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  evidence: string;

  @ApiPropertyOptional({ description: 'Optional context for reviewers' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  requesterNote?: string;
}

export class UpdateVerificationRequestStatusDto {
  @ApiProperty({ enum: VerificationRequestStatus })
  @IsEnum(VerificationRequestStatus)
  status: VerificationRequestStatus;

  @ApiPropertyOptional({
    description: 'Reviewer decision or requested changes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reviewNote?: string;
}

export class VerificationRequestQueryDto {
  @ApiPropertyOptional({ enum: VerificationRequestStatus })
  @IsOptional()
  @IsEnum(VerificationRequestStatus)
  status?: VerificationRequestStatus;

  @ApiPropertyOptional({ enum: VerificationRequestTargetType })
  @IsOptional()
  @IsEnum(VerificationRequestTargetType)
  targetType?: VerificationRequestTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetId?: string;
}

export class VerificationRequestResponseDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty({ enum: VerificationRequestTargetType })
  targetType: VerificationRequestTargetType;

  @ApiProperty()
  targetId: string;

  @ApiProperty()
  requesterId: string;

  @ApiProperty({ enum: VerificationRequestStatus })
  status: VerificationRequestStatus;

  @ApiProperty()
  evidence: string;

  @ApiPropertyOptional()
  requesterNote?: string | null;

  @ApiPropertyOptional()
  reviewerId?: string | null;

  @ApiPropertyOptional()
  reviewNote?: string | null;

  @ApiPropertyOptional()
  reviewedAt?: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
