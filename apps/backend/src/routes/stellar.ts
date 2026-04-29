// src/routes/stellar.ts
import { 
  Controller, 
  Get, 
  Query, 
  BadRequestException, 
  ServiceUnavailableException,
  InternalServerErrorException 
} from '@nestjs/common';
import { StellarService } from '../services/StellarService';

@Controller('stellar')
export class StellarController {
  constructor(private readonly stellarService: StellarService) {}

  @Get('assets')
  async getAssets(
    @Query('asset_code') assetCode?: string,
    @Query('issuer') issuer?: string,
    @Query('q') q?: string,
    @Query('limit') limit: number = 20, // NestJS will handle the default
  ) {
    try {
      let assets = [];

      // Logic flow based on provided query parameters
      if (assetCode) {
        assets = await this.stellarService.findAssetsByCode(assetCode);
      } else if (issuer) {
        assets = await this.stellarService.findAssetsByIssuer(issuer);
      } else if (q) {
        assets = await this.stellarService.searchAssets(q);
      } else {
        throw new BadRequestException('Please provide asset_code, issuer, or a search query (q)');
      }

      // Return standardized response
      return {
        success: true,
        assets: assets.slice(0, Number(limit)),
        pagination: {
          total_returned: Math.min(assets.length, Number(limit)),
          limit: Number(limit),
          // Horizon uses cursors for real pagination; 
          // this is a simple slice for now.
        },
      };

    } catch (err) {
      // If it's already a NestJS error (like the BadRequest above), just rethrow it
      if (err instanceof BadRequestException) throw err;

      // Log the error internally for debugging
      console.error('Stellar Horizon Error:', err);

      // Handle cases where Horizon responds but with an error
      const message = err.response?.data?.title || err.message;
      throw new ServiceUnavailableException(`Horizon error: ${message}`);
    }
  }
}