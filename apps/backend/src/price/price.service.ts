import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { PriceGateway } from './price.gateway';
import { StellarService } from '../stellar/stellar.service';

@Injectable()
export class PriceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceService.name);
  private priceListenerInterval?: NodeJS.Timeout;

  constructor(
    @Inject(forwardRef(() => PriceGateway))
    private readonly gateway: PriceGateway,

    private readonly stellarService: StellarService,
  ) {}

  onModuleInit() {
    this.startPriceListener();
  }

  /**
   * Starts emitting mock real-time price updates
   * (Stable for demo + PR testing)
   */
  startPriceListener(): void {
    this.logger.log('Starting price update stream...');

    if (this.priceListenerInterval) {
      clearInterval(this.priceListenerInterval);
    }

    this.priceListenerInterval = setInterval(() => {
      try {
        const price = (Math.random() * 0.2 + 0.1).toFixed(4);

        const payload = {
          pair: 'XLM/USDC',
          price,
          timestamp: Date.now(),
        };

        this.gateway.sendPriceUpdate('XLM/USDC', payload);

        this.logger.debug(`Price update sent: ${JSON.stringify(payload)}`);
      } catch (err: unknown) {
        this.logger.error('Price update error', err);
      }
    }, 3000);
    this.priceListenerInterval.unref?.();
  }

  onModuleDestroy(): void {
    if (this.priceListenerInterval) {
      clearInterval(this.priceListenerInterval);
      this.priceListenerInterval = undefined;
    }
  }

  /**
   * Get the current USD price of an asset.
   * Currently using mock prices; to be replaced with a real price feed (e.g., CoinGecko).
   */
  getCurrentPrice(assetCode: string): Promise<number> {
    const mockPrices: Record<string, number> = {
      XLM: 0.12,
      USDC: 1.0,
      BTC: 45000.0,
      ETH: 2500.0,
    };

    return Promise.resolve(mockPrices[assetCode] || 0);
  }

  /**
   * Batch-fetch USD prices for multiple asset codes in a single call.
   *
   * Replaces the N+1 pattern of calling `getCurrentPrice()` once per asset
   * inside a `.map()`.  When a real price feed is introduced, this method
   * should issue a single batched request to that feed rather than N
   * individual requests.
   *
   * @param assetCodes Deduplicated list of asset code strings (e.g. ["XLM", "USDC"]).
   * @returns Map from assetCode → USD price.  Missing codes map to 0.
   */
  getPricesForAssets(assetCodes: string[]): Promise<Map<string, number>> {
    // Deduplicate so we only resolve each code once.
    const unique = [...new Set(assetCodes)];

    // When a real price-feed API is integrated, replace this with a single
    // batched HTTP call and populate the map from the response.
    const mockPrices: Record<string, number> = {
      XLM: 0.12,
      USDC: 1.0,
      BTC: 45000.0,
      ETH: 2500.0,
    };

    const result = new Map<string, number>();
    for (const code of unique) {
      result.set(code, mockPrices[code] ?? 0);
    }
    return Promise.resolve(result);
  }
}
