import { Injectable } from '@nestjs/common';
// Import Horizon specifically from the modern SDK
import { Horizon } from 'stellar-sdk';

@Injectable()
export class StellarService {
  // Update the type to reflect the Horizon namespace
  private horizon: Horizon.Server;

  constructor() {
    // Initialize using Horizon.Server
    const horizonUrl = process.env.HORIZON_URL || 'https://horizon.stellar.org';
    this.horizon = new Horizon.Server(horizonUrl);
  }

  async findAssetsByCode(assetCode: string) {
    // Access assets through the horizon instance
    const res = await this.horizon.assets().forCode(assetCode).call();
    return res.records.map(record => this.normalizeAsset(record));
  }

  async findAssetsByIssuer(issuer: string) {
    const res = await this.horizon.assets().forIssuer(issuer).call();
    return res.records.map(record => this.normalizeAsset(record));
  }

  async searchAssets(query: string) {
    const res = await this.horizon.assets().call();
    return res.records
      .filter(a => 
        (a.asset_code && a.asset_code.includes(query)) || 
        (a.asset_issuer && a.asset_issuer.includes(query))
      )
      .map(record => this.normalizeAsset(record));
  }

  /**
   * Helper to format the Horizon record into a clean object.
   * Using 'any' here for simplicity, but in v13.3.0, 
   * this is technically Horizon.ServerApi.AssetRecord
   */
  private normalizeAsset(record: any) {
    return {
      code: record.asset_code,
      issuer: record.asset_issuer,
      num_accounts: record.num_accounts,
      metadata: {
        domain: record.home_domain || null,
      },
    };
  }
}