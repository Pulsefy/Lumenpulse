import { IsString, IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Supported gasless intent types. */
export type IntentType = 'register_contributor' | 'propose_project';

export class RelayIntentDto {
  @ApiProperty({
    description:
      'Type of off-chain intent to relay. Determines which contract and method are invoked.',
    enum: ['register_contributor', 'propose_project'],
    example: 'register_contributor',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['register_contributor', 'propose_project'])
  intentType!: IntentType;

  /**
   * XDR-encoded `SorobanAuthorizationEntry` (base64) produced by the user's
   * wallet (e.g. Freighter `signAuthEntry`).  The relayer attaches this to the
   * transaction so the contract host can verify the user's Ed25519 signature
   * without the user ever holding XLM.
   */
  @ApiProperty({
    description:
      'Base64-encoded XDR SorobanAuthorizationEntry signed by the user.',
    example: 'AAAAAQ...',
  })
  @IsString()
  @IsNotEmpty()
  signedAuthEntryXdr!: string;

  /**
   * Stellar public key (G-address) of the user whose intent is being relayed.
   * Used to look up the contract-layer nonce and to verify the auth entry.
   */
  @ApiProperty({
    description: "User's Stellar G-address.",
    example: 'GABC...',
  })
  @IsString()
  @IsNotEmpty()
  userPublicKey!: string;

  /**
   * For `register_contributor` intent: the GitHub handle to register.
   * For `propose_project` intent: JSON-serialised ProjectMetadata.
   */
  @ApiProperty({
    description:
      'Intent payload. For register_contributor: GitHub handle string. For propose_project: JSON ProjectMetadata.',
    example: 'my-github-handle',
  })
  @IsString()
  @IsNotEmpty()
  payload!: string;
}
