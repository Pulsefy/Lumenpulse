import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class RotateBeneficiaryDto {
  @ApiProperty({
    description: 'Current beneficiary address',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsString()
  @IsNotEmpty()
  oldBeneficiary: string;

  @ApiProperty({
    description: 'New beneficiary address',
    example: 'GD5JPQGBSNKQP2GM6RFF2Z7Q2F6A4W7GVP7K7YJZL6Q7Z7Z7Z7Z7Z7Z7',
  })
  @IsString()
  @IsNotEmpty()
  newBeneficiary: string;
}
