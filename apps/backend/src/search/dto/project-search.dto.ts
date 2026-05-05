import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { VerificationStatus } from '../../verification/dto/verification.dto';

export class ProjectSearchQueryDto {
  @ApiProperty({
    description: 'Search query (matches project name or numeric id)',
    required: false,
    example: 'Lumen',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({
    description: 'Filter by verification status',
    required: false,
    enum: VerificationStatus,
    example: VerificationStatus.Pending,
  })
  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @ApiProperty({
    description: 'Filter by owner Stellar public key',
    required: false,
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsOptional()
  @IsString()
  ownerPublicKey?: string;

  @ApiProperty({
    description: 'Pagination limit',
    required: false,
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({
    description: 'Pagination offset',
    required: false,
    default: 0,
    minimum: 0,
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ProjectSearchItemDto {
  @ApiProperty({ example: 1 })
  projectId: number;

  @ApiProperty({ example: 'LumenPulse' })
  name: string;

  @ApiProperty({
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  ownerPublicKey: string;

  @ApiProperty({ enum: VerificationStatus, example: VerificationStatus.Pending })
  status: VerificationStatus;

  @ApiProperty({ example: 0 })
  votesFor: number;

  @ApiProperty({ example: 0 })
  votesAgainst: number;

  @ApiProperty({ example: 1712345678 })
  registeredAt: number;

  @ApiProperty({ example: 0 })
  resolvedAt: number;

  @ApiProperty({
    description: 'Percentage of quorum reached (0–100)',
    example: 0,
  })
  quorumProgress: number;

  @ApiProperty({
    description: 'Relevance score used for ordering',
    example: 100,
  })
  score: number;
}

export class ProjectSearchResponseDto {
  @ApiProperty({ type: [ProjectSearchItemDto] })
  items: ProjectSearchItemDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 0 })
  offset: number;
}

