import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AssignReviewerDto {
  @ApiPropertyOptional({
    description: 'The ID of the reviewer to assign. Null to unassign.',
    example: 'uuid-1234',
  })
  @IsOptional()
  @IsString()
  reviewerId?: string;
}
