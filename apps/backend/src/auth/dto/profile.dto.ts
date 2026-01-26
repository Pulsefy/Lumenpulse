import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class ProfileDto {
  @Expose()
  id: number;

  @Expose()
  email: string;

  constructor(partial: Partial<ProfileDto>) {
    Object.assign(this, partial);
  }
}
