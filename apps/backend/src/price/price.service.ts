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
}
