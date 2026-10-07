import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';

/**
 * Query parameters for the Stellar transaction history endpoint: the shared
 * pagination contract plus the required Stellar public key.
 */
export class StellarTransactionsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: 'Stellar account public key',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsString()
  @IsNotEmpty()
  publicKey: string;
}
