import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageTemplateService } from '../message-template/message-template.service';
import { MessageTemplateKey } from '../message-template/message-template.keys';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly messageTemplateService: MessageTemplateService,
  ) {}

  /**
   * Mocked email sending function.
   * In a real production environment, this would use a provider like SendGrid,
   * Postmark, or AWS SES.
   */
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    const resetLink = `${frontendUrl}/auth/reset-password?token=${token}`;
    const rendered = await this.messageTemplateService.render(
      MessageTemplateKey.EMAIL_PASSWORD_RESET,
      { resetLink },
    );

    this.logger.log('--- MOCK EMAIL SENT ---');
    this.logger.log(`To: ${email}`);
    this.logger.log(`Subject: ${rendered.subject ?? ''}`);
    this.logger.log(`Message: ${rendered.body ?? ''}`);
    this.logger.log(`Raw Token: ${token}`);
    this.logger.log('------------------------');

    // Simulate async operation
    return Promise.resolve();
  }
}
