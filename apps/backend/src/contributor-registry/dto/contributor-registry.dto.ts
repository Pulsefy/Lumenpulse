import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterContributorDto {
  @ApiProperty({ example: 'GABC...', description: "Contributor's Stellar G-address" })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiProperty({ example: 'my-github-handle' })
  @IsString()
  @IsNotEmpty()
  githubHandle!: string;
}
