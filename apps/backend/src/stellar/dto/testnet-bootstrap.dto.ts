import { ApiProperty } from '@nestjs/swagger';
import { IsStellarAddress } from '../../common/validators/stellar.validators';
import { IsNotEmpty } from 'class-validator';

/**
 * Request DTO for testnet account bootstrap via Friendbot.
 * Only valid on testnet-configured deployments.
 */
export class TestnetBootstrapRequestDto {
  @ApiProperty({
    description: 'Stellar testnet public key to fund (must start with G)',
    example: 'GBVEUUVRFP5SMZXSMJVFY42KTXFAPG4NFZR4MBBNGFQG6DGZX7NXQY2I',
  })
  @IsNotEmpty()
  @IsStellarAddress()
  publicKey: string;
}

/**
 * Response DTO for successful Friendbot funding.
 */
export class TestnetBootstrapResponseDto {
  @ApiProperty({
    description: 'Success indicator',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Funding confirmation message',
    example: 'Account successfully funded',
  })
  message: string;

  @ApiProperty({
    description: 'Friendbot transaction hash (if available)',
    example: 'baaffabaffabaffabaffabaffabaffabaffabaffabaffabaffabaffaba0',
    required: false,
  })
  transactionHash?: string;

  @ApiProperty({
    description: 'Public key that was funded',
    example: 'GBVEUUVRFP5SMZXSMJVFY42KTXFAPG4NFZR4MBBNGFQG6DGZX7NXQY2I',
  })
  publicKey: string;

  @ApiProperty({
    description: 'Funding amount in lumens',
    example: '100.0000000',
    required: false,
  })
  fundingAmount?: string;
}
