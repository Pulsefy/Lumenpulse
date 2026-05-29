import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApproveProjectDto {
  @ApiProperty({
    description: 'Unique project identifier on-chain',
    example: 1,
  })
  @IsInt()
  @Min(0)
  projectId: number;
}
