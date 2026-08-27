import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { EntityAliasService } from './entity-alias.service';
import {
  AliasListQueryDto,
  AliasResponseDto,
  BatchCreateAliasDto,
  CreateAliasDto,
  NormalizeResultDto,
} from './dto/entity-alias.dto';
import { EntityKind } from '../database/entities/entity-alias.entity';

@ApiTags('entity-aliases')
@Controller('entity-aliases')
export class EntityAliasController {
  constructor(private readonly service: EntityAliasService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List entity aliases',
    description:
      'List all aliases, optionally filtered by entity kind or canonical value.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of entity aliases',
    type: [AliasResponseDto],
  })
  list(@Query() query: AliasListQueryDto) {
    return this.service.list(query);
  }

  @Get('normalize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Normalize a value using the alias registry',
    description:
      'Given a raw value (and optionally an entity kind), return the canonical value or the lowercased original if no mapping exists.',
  })
  @ApiQuery({
    name: 'value',
    required: true,
    description: 'Raw value to normalize',
    example: 'solarfarm',
  })
  @ApiQuery({
    name: 'entityKind',
    required: false,
    enum: ['project', 'asset', 'tag', 'category'],
    description: 'Optional scope to a specific entity kind',
  })
  @ApiResponse({
    status: 200,
    description: 'Normalization result',
    type: NormalizeResultDto,
  })
  normalize(
    @Query('value') value: string,
    @Query('entityKind') entityKind?: EntityKind,
  ): NormalizeResultDto {
    return this.service.normalize(value, entityKind);
  }

  @Post('normalize-batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Normalize multiple values in one call',
    description:
      'Bulk normalization using the alias registry. Useful during ingestion or analytics pipelines.',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-value normalization results',
    type: [NormalizeResultDto],
  })
  normalizeBatch(
    @Body() body: { values: string[]; entityKind?: EntityKind },
  ): NormalizeResultDto[] {
    return this.service.normalizeMany(body.values, body.entityKind);
  }

  @Get('expand/:canonicalValue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Expand a canonical value to all known variants',
    description:
      'Returns the canonical value plus every alias that maps to it. Useful for OR-style queries across datasets.',
  })
  @ApiQuery({
    name: 'entityKind',
    required: false,
    enum: ['project', 'asset', 'tag', 'category'],
  })
  @ApiResponse({
    status: 200,
    description: 'Canonical value and all its synonyms',
    schema: { type: 'array', items: { type: 'string' } },
  })
  expand(
    @Param('canonicalValue') canonicalValue: string,
    @Query('entityKind') entityKind?: EntityKind,
  ): string[] {
    return this.service.expand(canonicalValue, entityKind);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get an alias by ID' })
  @ApiResponse({ status: 200, type: AliasResponseDto })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a single alias mapping',
    description:
      'Register a new alias -> canonical mapping. Contributors can call this without touching core pipeline code.',
  })
  @ApiResponse({ status: 201, type: AliasResponseDto })
  @ApiResponse({ status: 409, description: 'Alias already exists' })
  create(@Body() dto: CreateAliasDto) {
    return this.service.create(dto);
  }

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch-create multiple aliases for one canonical value',
    description:
      'Register several synonyms at once. Conflicts are reported individually in the `skipped` list.',
  })
  @ApiResponse({
    status: 200,
    description: 'Per-item results of the batch operation',
  })
  batchCreate(@Body() dto: BatchCreateAliasDto) {
    return this.service.batchCreate(dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an alias by ID' })
  @ApiResponse({ status: 204, description: 'Alias removed' })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Delete('by-alias/:alias')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an alias by its alias text' })
  @ApiResponse({ status: 204, description: 'Alias removed' })
  @ApiResponse({ status: 404, description: 'Alias not found' })
  removeByAlias(@Param('alias') alias: string) {
    return this.service.removeByAlias(alias);
  }
}
