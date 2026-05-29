import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { SOROBAN_RPC_CONFIG, SorobanRpcConfig } from './rpc.config';
import { RpcObservabilityService } from './rpc.observability.service';
import { SorobanRpcService } from './soroban-rpc.service';


@Module({})
export class SorobanRpcModule {
  static forRootAsync(): DynamicModule {
    return {
      module: SorobanRpcModule,
      imports: [ConfigModule],
      global: true,
      providers: [
        {
          provide: SOROBAN_RPC_CONFIG,
          useFactory: (config: ConfigService): SorobanRpcConfig => {
            const rpcUrl = config.get<string>('SOROBAN_RPC_URL');
            if (!rpcUrl) {
              throw new Error(
                'SOROBAN_RPC_URL is not set. ' +
                  'Add it to your .env file before starting the application.',
              );
            }
            return {
              rpcUrl,
              timeoutMs: config.get<number>('SOROBAN_TIMEOUT_MS', 10_000),
              maxAttempts: config.get<number>('SOROBAN_MAX_ATTEMPTS', 3),
              baseDelayMs: config.get<number>('SOROBAN_BASE_DELAY_MS', 300),
              maxDelayMs: config.get<number>('SOROBAN_MAX_DELAY_MS', 5_000),
            };
          },
          inject: [ConfigService],
        },
        RpcObservabilityService,
        SorobanRpcService,
      ],
      exports: [SorobanRpcService, RpcObservabilityService],
    };
  }

  
  static forRoot(config: SorobanRpcConfig): DynamicModule {
    return {
      module: SorobanRpcModule,
      global: true,
      providers: [
        { provide: SOROBAN_RPC_CONFIG, useValue: config },
        RpcObservabilityService,
        SorobanRpcService,
      ],
      exports: [SorobanRpcService, RpcObservabilityService],
    };
  }
}