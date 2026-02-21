import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {}

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

    this.logger.log('--- MOCK EMAIL SENT ---');
    this.logger.log(`To: ${email}`);
    this.logger.log(`Subject: Reset Your Passkey`);
    this.logger.log(
      `Message: Please use the following link to reset your passkey: ${resetLink}`,
    );
    this.logger.log(`Raw Token: ${token}`);
    this.logger.log('------------------------');

    // Simulate async operation
    return Promise.resolve();
  }
}
