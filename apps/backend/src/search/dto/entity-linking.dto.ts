import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class EntityLinkingQueryDto {
  @ApiProperty({
    description:
      'Input text to resolve into known projects/assets/ecosystem entities',
    example: 'LumenPulse project tracks XLM and USDC in the Stellar ecosystem.',
  })
  @IsString()
  text: string;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 20,
    default: 5,
    description: 'Maximum number of matches returned for each entity type',
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limitPerType?: number;
}

export class LinkedProjectDto {
  @ApiProperty({ example: 42 })
  projectId: number;
  @ApiProperty({ example: 'LumenPulse Wallet' })
  name: string;
  @ApiProperty({ example: 'lumenpulse' })
  matchedMention: string;
}

export class LinkedAssetDto {
  @ApiProperty({ example: 'USDC' })
  assetCode: string;
  @ApiProperty({ example: 'GD....' })
  assetIssuer: string;
  @ApiProperty({ example: 'usdc' })
  matchedMention: string;
}

export class LinkedEcosystemEntityDto {
  @ApiProperty({ enum: ['tag', 'category'], example: 'tag' })
  kind: 'tag' | 'category';
  @ApiProperty({ example: 'stellar' })
  value: string;
  @ApiProperty({ example: 'stellar' })
  matchedMention: string;
}

export class EntityLinkingResponseDto {
  @ApiProperty({ type: [LinkedProjectDto] })
  projects: LinkedProjectDto[];
  @ApiProperty({ type: [LinkedAssetDto] })
  assets: LinkedAssetDto[];
  @ApiProperty({ type: [LinkedEcosystemEntityDto] })
  ecosystem: LinkedEcosystemEntityDto[];
}
