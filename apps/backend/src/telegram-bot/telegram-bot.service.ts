/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as TelegramBot from 'node-telegram-bot-api';
type Message = TelegramBot.Message;
import {
  TelegramSubscription,
  TelegramAlertType,
} from './telegram-subscription.entity';
import { TelegramSilence } from './telegram-silence.entity';
import { PriceService } from '../price/price.service';
import { SentimentService } from '../sentiment/sentiment.service';
import { NewsService } from '../news/news.service';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: any = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(TelegramSubscription)
    private readonly subscriptionRepository: Repository<TelegramSubscription>,
    @InjectRepository(TelegramSilence)
    private readonly silenceRepository: Repository<TelegramSilence>,
    private readonly priceService: PriceService,
    private readonly sentimentService: SentimentService,
    private readonly newsService: NewsService,
  ) {}

  onModuleInit() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN not set. Telegram bot will not be started.',
      );
      return;
    }

    this.bot = new (TelegramBot as any)(token, { polling: true });
    this.registerHandlers();
    this.logger.log('Telegram bot started with polling');
  }

  onModuleDestroy() {
    if (this.bot) {
      void this.bot.stopPolling();
      this.logger.log('Telegram bot stopped');
    }
  }

  private registerHandlers() {
    if (!this.bot) return;

    this.bot.onText(/\/start/, (msg) => {
      void this.handleStart(msg);
    });
    this.bot.onText(/\/status/, (msg) => {
      void this.handleStatus(msg);
    });
    this.bot.onText(/\/price (.+)/, (msg, match) => {
      void this.handlePrice(msg, match);
    });
    this.bot.onText(/\/price$/, (msg) => {
      void this.handlePrice(msg, null);
    });
    this.bot.onText(/\/sentiment/, (msg) => {
      void this.handleSentiment(msg);
    });
    this.bot.onText(/\/trend/, (msg) => {
      void this.handleTrend(msg);
    });
    this.bot.onText(/\/subscribe (.+)/, (msg, match) => {
      void this.handleSubscribe(msg, match);
    });
    this.bot.onText(/\/subscribe$/, (msg) => {
      void this.handleSubscribe(msg, null);
    });
    this.bot.onText(/\/unsubscribe (.+)/, (msg, match) => {
      void this.handleUnsubscribe(msg, match);
    });
    this.bot.onText(/\/unsubscribe$/, (msg) => {
      void this.handleUnsubscribe(msg, null);
    });
    this.bot.onText(/\/silence (.+)/, (msg, match) => {
      void this.handleSilence(msg, match);
    });
    this.bot.onText(/\/silence$/, (msg) => {
      void this.handleSilence(msg, null);
    });
    this.bot.onText(/\/unsilence/, (msg) => {
      void this.handleUnsilence(msg);
    });
    this.bot.onText(/\/subscriptions/, (msg) => {
      void this.handleSubscriptions(msg);
    });
    this.bot.onText(/\/help/, (msg) => {
      void this.handleHelp(msg);
    });

    this.bot.on('polling_error', (error) => {
      this.logger.error('Telegram polling error', error);
    });
  }

  private getChatId(msg: Message): string {
    return (msg as any).chat.id.toString();
  }

  private async sendMessage(chatId: string, text: string) {
    if (!this.bot) return;
    try {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error) {
      this.logger.error(`Failed to send message to ${chatId}`, error);
    }
  }

  private async handleStart(msg: Message) {
    const chatId = this.getChatId(msg);
    const username = (msg as any).from?.username ?? null;

    let sub = await this.subscriptionRepository.findOne({ where: { chatId } });
    if (!sub) {
      sub = this.subscriptionRepository.create({
        chatId,
        username,
        alertTypes: Object.values(TelegramAlertType),
        isActive: true,
      });
      await this.subscriptionRepository.save(sub);
    } else {
      sub.isActive = true;
      sub.username = username;
      await this.subscriptionRepository.save(sub);
    }

    await this.sendMessage(
      chatId,
      'Welcome to LumenPulse Bot! 🚀\n\n' +
        'You are now subscribed to all alerts.\n' +
        'Use /help to see available commands.',
    );
  }

  private async handleStatus(msg: Message) {
    const chatId = this.getChatId(msg);
    const sub = await this.subscriptionRepository.findOne({
      where: { chatId },
    });

    if (!sub || !sub.isActive) {
      await this.sendMessage(
        chatId,
        'You are not subscribed. Use /start to subscribe.',
      );
      return;
    }

    const silenced = await this.isSilenced(chatId);

    const statusText =
      '*Bot Status* ✅\n\n' +
      `Username: ${sub.username ?? 'N/A'}\n` +
      `Active: ${sub.isActive ? 'Yes' : 'No'}\n` +
      `Silenced: ${silenced ? 'Yes' : 'No'}\n` +
      `Alerts: ${sub.alertTypes.join(', ')}`;

    await this.sendMessage(chatId, statusText);
  }

  private async handlePrice(msg: Message, match: RegExpExecArray | null) {
    const chatId = this.getChatId(msg);
    const asset = match?.[1]?.trim().toUpperCase() ?? 'XLM';

    try {
      const price = await this.priceService.getCurrentPrice(asset);
      if (price === 0) {
        await this.sendMessage(
          chatId,
          `Price for *${asset}* is not available.`,
        );
        return;
      }

      await this.sendMessage(
        chatId,
        `*Current Price* 💰\n\n${asset}: $${price.toFixed(4)}`,
      );
    } catch (error) {
      this.logger.error('Price command error', error);
      await this.sendMessage(
        chatId,
        'Failed to fetch price. Please try again later.',
      );
    }
  }

  private async handleSentiment(msg: Message) {
    const chatId = this.getChatId(msg);

    try {
      const summary = await this.newsService.getSentimentSummary();
      const sentimentText = this.formatSentimentSummary(summary);
      await this.sendMessage(chatId, sentimentText);
    } catch (error) {
      this.logger.error('Sentiment command error', error);
      await this.sendMessage(
        chatId,
        'Failed to fetch sentiment. Please try again later.',
      );
    }
  }

  private formatSentimentSummary(summary: {
    overall: { averageSentiment: number; totalArticles: number };
    bySource: { source: string; averageScore: number; articleCount: number }[];
  }): string {
    const avg = summary.overall.averageSentiment;
    let sentimentEmoji = '😐';
    if (avg > 0.3) sentimentEmoji = '😄';
    if (avg < -0.3) sentimentEmoji = '😟';

    let text =
      `*Market Sentiment* ${sentimentEmoji}\n\n` +
      `Overall: ${avg.toFixed(2)} (${summary.overall.totalArticles} articles)\n\n` +
      '*By Source:*\n';

    for (const source of summary.bySource.slice(0, 5)) {
      text += `- ${source.source}: ${source.averageScore.toFixed(2)} (${source.articleCount})\n`;
    }

    return text;
  }

  private async handleTrend(msg: Message) {
    const chatId = this.getChatId(msg);

    try {
      const [price, summary] = await Promise.all([
        this.priceService.getCurrentPrice('XLM'),
        this.newsService.getSentimentSummary(),
      ]);

      const avg = summary.overall.averageSentiment;
      let trend = 'Neutral 📊';
      if (avg > 0.3 && price > 0.12) trend = 'Bullish 📈';
      if (avg < -0.3 || price < 0.1) trend = 'Bearish 📉';

      const text =
        `*Market Trend* ${trend}\n\n` +
        `XLM Price: $${price.toFixed(4)}\n` +
        `Sentiment: ${avg.toFixed(2)}\n` +
        `Articles: ${summary.overall.totalArticles}\n\n` +
        '_Trend is based on price + sentiment combined._';

      await this.sendMessage(chatId, text);
    } catch (error) {
      this.logger.error('Trend command error', error);
      await this.sendMessage(
        chatId,
        'Failed to fetch trend. Please try again later.',
      );
    }
  }

  private async handleSubscribe(msg: Message, match: RegExpExecArray | null) {
    const chatId = this.getChatId(msg);
    const typeInput = match?.[1]?.trim().toLowerCase() ?? '';

    const validTypes = Object.values(TelegramAlertType).map((t) =>
      t.toLowerCase(),
    );
    if (!validTypes.includes(typeInput)) {
      await this.sendMessage(
        chatId,
        `Invalid alert type: *${typeInput}*\n\n` +
          `Valid types: ${validTypes.join(', ')}\n\n` +
          'Use /subscriptions to see your current subscriptions.',
      );
      return;
    }

    const alertType = typeInput as TelegramAlertType;
    let sub = await this.subscriptionRepository.findOne({ where: { chatId } });

    if (!sub) {
      sub = this.subscriptionRepository.create({
        chatId,
        username: (msg as any).from?.username ?? null,
        alertTypes: [alertType],
        isActive: true,
      });
    } else {
      if (!sub.alertTypes.includes(alertType)) {
        sub.alertTypes.push(alertType);
      }
    }

    await this.subscriptionRepository.save(sub);
    await this.sendMessage(chatId, `Subscribed to *${alertType}* alerts ✅`);
  }

  private async handleUnsubscribe(msg: Message, match: RegExpExecArray | null) {
    const chatId = this.getChatId(msg);
    const typeInput = match?.[1]?.trim().toLowerCase() ?? '';

    const validTypes = Object.values(TelegramAlertType).map((t) =>
      t.toLowerCase(),
    );
    if (!validTypes.includes(typeInput)) {
      await this.sendMessage(
        chatId,
        `Invalid alert type: *${typeInput}*\n\n` +
          `Valid types: ${validTypes.join(', ')}`,
      );
      return;
    }

    const alertType = typeInput as TelegramAlertType;
    const sub = await this.subscriptionRepository.findOne({
      where: { chatId },
    });

    if (!sub) {
      await this.sendMessage(
        chatId,
        'You are not subscribed. Use /start to subscribe.',
      );
      return;
    }

    sub.alertTypes = sub.alertTypes.filter((t) => t !== alertType);
    await this.subscriptionRepository.save(sub);
    await this.sendMessage(
      chatId,
      `Unsubscribed from *${alertType}* alerts ❌`,
    );
  }

  private async handleSilence(msg: Message, match: RegExpExecArray | null) {
    const chatId = this.getChatId(msg);
    const hoursStr = match?.[1]?.trim() ?? '';
    const hours = parseInt(hoursStr, 10);

    if (Number.isNaN(hours) || hours <= 0 || hours > 168) {
      await this.sendMessage(
        chatId,
        'Usage: /silence <hours>\n\n' +
          'Example: /silence 4 (mutes for 4 hours)\n' +
          'Maximum: 168 hours (7 days)',
      );
      return;
    }

    const until = new Date(Date.now() + hours * 60 * 60 * 1000);

    let silence = await this.silenceRepository.findOne({ where: { chatId } });
    if (!silence) {
      silence = this.silenceRepository.create({ chatId, silencedUntil: until });
    } else {
      silence.silencedUntil = until;
    }

    await this.silenceRepository.save(silence);
    await this.sendMessage(
      chatId,
      `🔇 Alerts silenced for *${hours}* hour(s).\n` +
        `Until: ${until.toLocaleString()}\n\n` +
        'Use /unsilence to re-enable alerts early.',
    );
  }

  private async handleUnsilence(msg: Message) {
    const chatId = this.getChatId(msg);
    const silence = await this.silenceRepository.findOne({ where: { chatId } });

    if (!silence) {
      await this.sendMessage(chatId, 'You are not currently silenced.');
      return;
    }

    await this.silenceRepository.remove(silence);
    await this.sendMessage(chatId, '🔔 Alerts re-enabled!');
  }

  private async handleSubscriptions(msg: Message) {
    const chatId = this.getChatId(msg);
    const sub = await this.subscriptionRepository.findOne({
      where: { chatId },
    });

    if (!sub || !sub.isActive) {
      await this.sendMessage(
        chatId,
        'You are not subscribed. Use /start to subscribe.',
      );
      return;
    }

    const silenced = await this.isSilenced(chatId);

    const text =
      `*Your Subscriptions* 📋\n\n` +
      `Alerts: ${sub.alertTypes.length > 0 ? sub.alertTypes.join(', ') : 'None'}\n` +
      `Silenced: ${silenced ? 'Yes' : 'No'}\n\n` +
      'Use /subscribe <type> or /unsubscribe <type> to manage.';

    await this.sendMessage(chatId, text);
  }

  private async handleHelp(msg: Message) {
    const chatId = this.getChatId(msg);
    const helpText =
      '*LumenPulse Bot Commands* 🤖\n\n' +
      '/start - Subscribe to alerts\n' +
      '/status - Check your subscription status\n' +
      '/price <asset> - Get current price (default: XLM)\n' +
      '/sentiment - Get market sentiment summary\n' +
      '/trend - Get combined market trend\n' +
      '/subscribe <type> - Subscribe to alert type\n' +
      '/unsubscribe <type> - Unsubscribe from alert type\n' +
      '/subscriptions - List your subscriptions\n' +
      '/silence <hours> - Mute alerts for X hours\n' +
      '/unsilence - Re-enable alerts\n' +
      '/help - Show this help message\n\n' +
      '*Alert types:* price, sentiment, news, portfolio, system';

    await this.sendMessage(chatId, helpText);
  }

  private async isSilenced(chatId: string): Promise<boolean> {
    const silence = await this.silenceRepository.findOne({
      where: {
        chatId,
        silencedUntil: MoreThan(new Date()),
      },
    });
    return !!silence;
  }

  /**
   * Deliver an alert to all subscribed and non-silenced chats for the given alert type.
   */
  async broadcastAlert(
    alertType: TelegramAlertType,
    message: string,
  ): Promise<void> {
    const subs = await this.subscriptionRepository.find({
      where: { isActive: true },
    });

    for (const sub of subs) {
      if (!sub.alertTypes.includes(alertType)) continue;
      if (await this.isSilenced(sub.chatId)) continue;

      await this.sendMessage(sub.chatId, message);
    }
  }

  /**
   * Send a message to a specific chat (used by webhook or other services).
   */
  async sendToChat(chatId: string, message: string): Promise<void> {
    await this.sendMessage(chatId, message);
  }
}
