import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateSavedSearchDto } from './create-saved-search.dto';

export class UpdateSavedSearchDto extends PartialType(CreateSavedSearchDto) {
  @ApiPropertyOptional({
    description: 'Toggle subscription on or off.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isSubscribed?: boolean;
}
