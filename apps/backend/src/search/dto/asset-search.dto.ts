import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { AssetDiscoveryQueryDto } from '../../stellar/dto/asset-discovery.dto';

export class AssetSearchQueryDto extends AssetDiscoveryQueryDto {
  @ApiProperty({
    description: 'Filter by minimum number of accounts holding the asset',
    required: false,
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minAccounts?: number;

  @ApiProperty({
    description: 'Filter by maximum number of accounts holding the asset',
    required: false,
    example: 100000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxAccounts?: number;

  @ApiProperty({
    description: 'Filter assets requiring authorization (auth_required flag)',
    required: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  authRequired?: boolean;

  @ApiProperty({
    description: 'Sort results by relevance or by number of accounts',
    required: false,
    enum: ['relevance', 'accounts'],
    default: 'relevance',
    example: 'relevance',
  })
  @IsOptional()
  @IsIn(['relevance', 'accounts'])
  sort?: 'relevance' | 'accounts';
}
