import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { IsStellarAddress } from '../../common/validators/stellar.validators';

/**
 * Request DTO for testnet account bootstrap via Friendbot.
 * Only valid on testnet-configured deployments.
 */
export class TestnetBootstrapRequestDto {
  @ApiProperty({
    description: 'Stellar testnet public key to fund (must start with G)',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsNotEmpty()
  @IsStellarAddress()
  publicKey!: string;
}

/**
 * Response DTO for successful Friendbot funding.
 */
export class TestnetBootstrapResponseDto {
  @ApiProperty({
    description: 'Success indicator',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Funding confirmation message',
    example: 'Account successfully funded via Friendbot',
  })
  message!: string;

  @ApiProperty({
    description: 'Public key that was funded',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  publicKey!: string;

  @ApiProperty({
    description: 'Friendbot transaction hash (if available)',
    example: 'baaffabaffabaffabaffabaffabaffabaffabaffabaffabaffabaffaba0',
    required: false,
  })
  transactionHash?: string;

  @ApiProperty({
    description: 'Funding amount in lumens',
    example: '10000',
    required: false,
  })
  fundingAmount?: string;
}
