import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TranslationService } from './translation.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 3,
    }),
  ],
  providers: [TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}
