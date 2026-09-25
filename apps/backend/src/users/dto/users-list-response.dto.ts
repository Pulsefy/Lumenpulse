import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/pagination';
import { User } from '../entities/user.entity';

/**
 * Standard paginated response for the users list endpoint: the page of
 * items plus the uniform `meta` pagination object shared by every list
 * endpoint.
 */
export class UsersListResponseDto {
  @ApiProperty({ description: 'Page of users', type: [User] })
  users: User[];

  @ApiProperty({
    description: 'Standard pagination metadata',
    type: PaginationMetaDto,
  })
  meta: PaginationMetaDto;
}
