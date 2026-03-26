import { ApiProperty } from '@nestjs/swagger';

export class StellarAccountResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  publicKey: string;

  @ApiProperty({ required: false, nullable: true }) // Add nullable: true
  label?: string | null; // Allow both undefined and null

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
