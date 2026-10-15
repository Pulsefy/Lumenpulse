import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsStellarAddress } from '../../common/validators/stellar.validators';

export class RotateBeneficiaryDto {
  @ApiProperty({
    description: 'Current beneficiary address to rotate from',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsString()
  @IsNotEmpty({ message: 'oldBeneficiary is required' })
  @IsStellarAddress({
    message: 'oldBeneficiary must be a valid Stellar address (G...)',
  })
  oldBeneficiary: string;

  @ApiProperty({
    description: 'New beneficiary address to rotate to',
    example:
      'GBRMN3GQHVBVJ5TCG5F4XJZKZJZ2GXWK7JX7Z2Z7J2VH7VJ3Q2Z7J2VH7VJ3Q2Z7J2VH7VJ3Q2Z7J2VH7VJ3Q2Z7J2VH7VJ3Q2Z7J2VH7VJ3Q2Z7J2VH7VJ3Q',
  })
  @IsString()
  @IsNotEmpty({ message: 'newBeneficiary is required' })
  @IsStellarAddress({
    message: 'newBeneficiary must be a valid Stellar address (G...)',
  })
  newBeneficiary: string;
}
