import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class IngestSorobanEventDto {
  @IsString()
  @IsNotEmpty()
  txHash: string;

  @IsInt()
  @Min(0)
  eventIndex: number;

  @IsString()
  @IsOptional()
  contractId?: string;

  @IsString()
  @IsOptional()
  eventType?: string;

  @IsObject()
  rawPayload: Record<string, unknown>;
}
