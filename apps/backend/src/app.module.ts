import { Module, NestModule, MiddlewareConsumer, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TestExceptionController } from './test-exception.controller';
import { SentimentModule } from './sentiment/sentiment.module';
import { NewsModule } from './news/news.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EmailModule } from './email/email.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { MetricsModule } from './metrics/metrics.module';
import databaseConfig from './database/database.config';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { TestController } from './test/test.controller';
import { SnapshotsModule } from './snapshot/snapshot.module';
import { ModelRetrainingModule } from './model-retraining/model-retraining.module';
import { DataSource, DataSourceOptions } from 'typeorm';
import stellarConfig from './stellar/config/stellar.config';

const appLogger = new Logger('TypeORM');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, stellarConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): DataSourceOptions => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        logging: true,
      }),
      dataSourceFactory: async (options) => {
        if (!options) {
          throw new Error('TypeORM options are not defined');
        }
        const dataSource = new DataSource(options);
        await dataSource.initialize();
        appLogger.log('TypeORM Connection established');
        return dataSource;
      },
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    MetricsModule,
    SentimentModule,
    NewsModule,
    AuthModule,
    UsersModule,
    EmailModule,
    PortfolioModule,
    SnapshotsModule,
    ModelRetrainingModule,
  ],
  controllers: [AppController, TestController, TestExceptionController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
