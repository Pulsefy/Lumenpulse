import {
  Injectable,
  OnModuleInit,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { PriceGateway } from './price.gateway';
import { StellarService } from '../stellar/stellar.service';

@Injectable()
export class PriceService implements OnModuleInit {
  private readonly logger = new Logger(PriceService.name);

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

    setInterval(() => {
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
}
