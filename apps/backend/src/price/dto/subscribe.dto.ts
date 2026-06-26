import { IsString } from 'class-validator';

export class SubscribeDto {
  @IsString()
  pair: string;
}
