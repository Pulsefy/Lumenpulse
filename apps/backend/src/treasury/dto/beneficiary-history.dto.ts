import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryBeneficiaryHistoryDto {
  @ApiPropertyOptional({
    description: 'Filter history by beneficiary or account address',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsOptional()
  @IsString()
  beneficiary?: string;

  @ApiPropertyOptional({
    description: 'Filter history by account address (alias for beneficiary)',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsOptional()
  @IsString()
  account?: string;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class BeneficiaryHistoryItemDto {
  @ApiProperty({ example: 'b6f9a0c2-3e41-4c12-8f92-91ad5e8e8201' })
  id: string;

  @ApiProperty({
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  beneficiary: string;

  @ApiPropertyOptional({
    example: 'GB7BTVUKWVTVTK2CCW37267SRL7Z2X6R5KNDGKG42Z2F2G4V354JTK5V',
    nullable: true,
  })
  previousBeneficiary: string | null;

  @ApiProperty({
    example: 'ROTATED',
    description: 'Action type (ALLOCATED, ROTATED, etc.)',
  })
  action: string;

  @ApiPropertyOptional({ example: '1000000000', nullable: true })
  amount: string | null;

  @ApiPropertyOptional({ example: 'a1b2c3d4...', nullable: true })
  txHash: string | null;

  @ApiPropertyOptional({ example: 'user-uuid-123', nullable: true })
  actorId: string | null;

  @ApiPropertyOptional({ example: 'admin@lumenpulse.io', nullable: true })
  actorEmail: string | null;

  @ApiProperty({ example: '2026-07-26T05:00:00.000Z' })
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  metadata: Record<string, unknown> | null;
}

export class BeneficiaryHistoryResponseDto {
  @ApiPropertyOptional({
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  beneficiary?: string;

  @ApiProperty({ type: [BeneficiaryHistoryItemDto] })
  history: BeneficiaryHistoryItemDto[];

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
