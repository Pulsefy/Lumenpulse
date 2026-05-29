/**
 * Integration guide — how to wire SorobanRpcModule into the Lumenpulse backend.
 *
 * Copy the relevant snippets into the existing files; do not replace them wholesale.
 */


// 1.  app.module.ts  — import SorobanRpcModule once, globally


/*
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SorobanRpcModule } from './soroban-rpc';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),  // already present in this project
    SorobanRpcModule.forRootAsync(),           // ← add this line
    // ... your existing modules (stellar, portfolio, news, etc.)
  ],
})
export class AppModule {}
*/


// 2.  main.ts  — register the exception filter globally


/*
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RpcExceptionFilter } from './soroban-rpc';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new RpcExceptionFilter());   // ← add this line
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
*/


// 3.  metrics module  — expose GET /metrics/rpc
//     If the project already has a MetricsModule, add RpcMetricsController
//     to its controllers array.  Otherwise create a lightweight module:


/*
import { Module } from '@nestjs/common';
import { RpcMetricsController } from './soroban-rpc';

@Module({
  controllers: [RpcMetricsController],
})
export class MetricsModule {}
// Then add MetricsModule to AppModule imports.
*/


// 4.  .env / .env.example  — add these variables

/*
# Soroban RPC Client
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_TIMEOUT_MS=10000        # optional — default 10000
SOROBAN_MAX_ATTEMPTS=3          # optional — default 3
SOROBAN_BASE_DELAY_MS=300       # optional — default 300
SOROBAN_MAX_DELAY_MS=5000       # optional — default 5000
*/


// 5.  Migrating existing callers
//     Replace every direct SorobanRpc.Server instantiation like this:


/*
// BEFORE (scattered in stellar/, portfolio/, etc.):
import { SorobanRpc } from '@stellar/stellar-sdk';
const server = new SorobanRpc.Server(process.env.SOROBAN_RPC_URL!);
const ledger = await server.getLatestLedger(); // no timeout, no retry, no logs

// AFTER:
import { Injectable } from '@nestjs/common';
import { SorobanRpcService } from '../soroban-rpc';

@Injectable()
export class StellarService {
  constructor(private readonly soroban: SorobanRpcService) {}

  async getLatestLedger() {
    // Timeout + retry + structured logging + metrics — all handled automatically.
    // RpcError propagates up; the global RpcExceptionFilter converts it to JSON.
    return this.soroban.getLatestLedger();
  }
}
*/

export {}; 