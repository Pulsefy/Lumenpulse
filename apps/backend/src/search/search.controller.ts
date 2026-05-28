import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import {
  ProjectSearchQueryDto,
  ProjectSearchResponseDto,
} from './dto/project-search.dto';
import { AssetSearchQueryDto } from './dto/asset-search.dto';
import { AssetDiscoveryResponseDto } from '../stellar/dto/asset-discovery.dto';
import {
  EcosystemSearchQueryDto,
  EcosystemSearchResponseDto,
} from './dto/ecosystem-search.dto';
import {
  EntityLinkingQueryDto,
  EntityLinkingResponseDto,
} from './dto/entity-linking.dto';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('projects')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search projects',
    description:
      'Search registered projects with basic relevance ranking and optional status/owner filters.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project search results',
    type: ProjectSearchResponseDto,
  })
  searchProjects(
    @Query() query: ProjectSearchQueryDto,
  ): ProjectSearchResponseDto {
    return this.searchService.searchProjects(query);
  }

  @Get('assets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search Stellar assets',
    description:
      'Wraps Stellar asset discovery with basic ranking and extra filters (accounts/auth flags).',
  })
  @ApiResponse({
    status: 200,
    description: 'Asset search results',
    type: AssetDiscoveryResponseDto,
  })
  async searchAssets(
    @Query() query: AssetSearchQueryDto,
  ): Promise<AssetDiscoveryResponseDto> {
    return this.searchService.searchAssets(query);
  }

  @Get('ecosystem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search ecosystem entities',
    description:
      'Search top tags or categories derived from stored news articles.',
  })
  @ApiResponse({
    status: 200,
    description: 'Ecosystem entity results',
    type: EcosystemSearchResponseDto,
  })
  async searchEcosystem(
    @Query() query: EcosystemSearchQueryDto,
  ): Promise<EcosystemSearchResponseDto> {
    return this.searchService.searchEcosystemEntities(query);
  }

  @Get('entity-links')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link extracted mentions to known entities',
    description:
      'Links mentions in free text to known projects, Stellar assets, and ecosystem entries.',
  })
  @ApiResponse({
    status: 200,
    description: 'Linked entities resolved from the input text',
    type: EntityLinkingResponseDto,
  })
  async linkEntities(
    @Query() query: EntityLinkingQueryDto,
  ): Promise<EntityLinkingResponseDto> {
    return this.searchService.linkEntities(query);
  }
}
