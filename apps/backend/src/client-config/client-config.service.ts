import { Injectable } from '@nestjs/common';
import { config } from '../lib/config';
import { StellarConfigDto } from './dto/stellar-config.dto';

/**
 * Assembles client-safe configuration objects from the validated server-side
 * config store.  Nothing secret is ever included in the returned DTOs.
 */
@Injectable()
export class ClientConfigService {
  getStellarConfig(): StellarConfigDto {
    const { stellar } = config;

    return {
      network: stellar.network,
      horizonUrl: stellar.horizonUrl,
      sorobanRpcUrl: stellar.sorobanRpcUrl,
      crowdfundContractId: stellar.crowdfundContractId,
      explorerUrl: stellar.explorerUrl,
    };
  }
}
