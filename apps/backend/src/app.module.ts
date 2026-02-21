import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TestExceptionController } from './test-exception.controller';
import { SentimentModule } from './sentiment/sentiment.module';
import { NewsModule } from './news/news.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EmailModule } from './email/email.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import databaseConfig from './database/database.config';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { TestController } from './test/test.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
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
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    SentimentModule,
    NewsModule,
    AuthModule,
    UsersModule,
    EmailModule,
    PortfolioModule,
  ],
  controllers: [AppController, TestController, TestExceptionController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
