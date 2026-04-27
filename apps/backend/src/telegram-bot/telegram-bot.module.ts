import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramSubscription } from './telegram-subscription.entity';
import { TelegramSilence } from './telegram-silence.entity';
import { PriceModule } from '../price/price.module';
import { SentimentModule } from '../sentiment/sentiment.module';
import { NewsModule } from '../news/news.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TelegramSubscription, TelegramSilence]),
    PriceModule,
    SentimentModule,
    NewsModule,
  ],
  providers: [TelegramBotService],
  controllers: [TelegramBotController],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}
