import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Account,
  Transaction,
} from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';

interface ChallengeData {
  nonce: string;
  timestamp: number;
  challengeXDR: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly challengeStore = new Map<string, ChallengeData>();
  private readonly CHALLENGE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private readonly serverKeypair: Keypair;
  private readonly stellarNetwork: string;

  private static readonly RESET_TOKEN_BYTES = 32;
  private static readonly RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
  private static readonly BCRYPT_SALT_ROUNDS = 10;
  private static readonly REFRESH_TOKEN_BYTES = 32;
  private static readonly REFRESH_TOKEN_EXPIRY_DAYS = 30;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokenRepository: Repository<PasswordResetToken>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private usersService: UsersService,
    private jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    // Initialize server keypair
    const serverSecret = this.configService.get<string>(
      'STELLAR_SERVER_SECRET',
    );
    if (!serverSecret) {
      throw new Error('STELLAR_SERVER_SECRET is not configured');
    }
    this.serverKeypair = Keypair.fromSecret(serverSecret);

    // Set Stellar network
    this.stellarNetwork = this.configService.get<string>(
      'STELLAR_NETWORK',
      'testnet',
    );

    // Start cleanup interval
    setInterval(() => this.cleanupExpiredChallenges(), 60000);

    this.logger.log('AuthService initialized');
  }

  async validateUser(
    email: string,
    pass: string,
  ): Promise<Omit<User, 'passwordHash'> | null> {
    const user = await this.usersService.findByEmail(email);

    if (
      user &&
      user.passwordHash &&
      (await bcrypt.compare(pass, user.passwordHash))
    ) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(
    user: { id: string; email: string; role?: string },
    deviceInfo?: string,
    ipAddress?: string,
  ) {
    const payload = { email: user.email, sub: user.id, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    // Generate and store refresh token
    const refreshToken = this.generateRefreshToken();
    await this.storeRefreshToken(refreshToken, user.id, deviceInfo, ipAddress);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  /**
   * Generate a cryptographic challenge for the user to sign
   */

  // eslint-disable-next-line @typescript-eslint/require-await
  async generateChallenge(publicKey: string): Promise<{
    challenge: string;
    nonce: string;
    expiresIn: number;
  }> {
    // Validate public key format
    try {
      Keypair.fromPublicKey(publicKey);
    } catch {
      throw new BadRequestException('Invalid Stellar public key format');
    }

    // Generate a random nonce
    const nonce = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now();

    // Create a Stellar transaction as the challenge (SEP-10 standard)
    const sourceAccount = new Account(this.serverKeypair.publicKey(), '-1');

    const networkPassphrase =
      this.stellarNetwork === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase,
      timebounds: {
        minTime: 0,
        maxTime: Math.floor(timestamp / 1000) + 300, // 5 minutes from now
      },
    })
      .addOperation(
        Operation.manageData({
          name: 'LumenPulse auth',
          value: Buffer.from(nonce),
          source: publicKey,
        }),
      )
      .addOperation(
        Operation.manageData({
          name: 'web_auth_domain',
          value: Buffer.from(
            this.configService.get<string>('DOMAIN', 'lumenpulse.io'),
          ),
          source: this.serverKeypair.publicKey(),
        }),
      )
      .build();

    // Server signs the transaction
    transaction.sign(this.serverKeypair);

    const challengeXDR = transaction.toXDR();

    // Store challenge with expiration
    this.challengeStore.set(publicKey, {
      nonce,
      timestamp,
      challengeXDR,
      expiresAt: timestamp + this.CHALLENGE_TIMEOUT,
    });

    this.logger.debug(`Challenge generated for ${publicKey}`);

    return {
      challenge: challengeXDR,
      nonce,
      expiresIn: 300, // seconds
    };
  }

  /**
   * Verify the signed challenge and issue a JWT
   */
  async verifyChallenge(
    publicKey: string,
    signedChallenge: string,
  ): Promise<{
    success: boolean;
    token: string;
    refresh_token: string;
    user: Partial<User>;
  }> {
    // Retrieve stored challenge
    const storedChallenge = this.challengeStore.get(publicKey);

    if (!storedChallenge) {
      throw new UnauthorizedException(
        'No challenge found for this public key. Please request a new challenge.',
      );
    }

    // Check if challenge has expired
    if (Date.now() > storedChallenge.expiresAt) {
      this.challengeStore.delete(publicKey);
      throw new UnauthorizedException(
        'Challenge has expired. Please request a new challenge.',
      );
    }

    // Import the signed transaction
    const networkPassphrase =
      this.stellarNetwork === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

    let transaction: Transaction;

    try {
      transaction = new Transaction(signedChallenge, networkPassphrase);
    } catch {
      this.challengeStore.delete(publicKey);
      throw new BadRequestException('Invalid transaction format');
    }

    // Verify the transaction was signed by the user
    const userSignature = transaction.signatures.find((sig) => {
      try {
        const keypair = Keypair.fromPublicKey(publicKey);
        return keypair.verify(transaction.hash(), sig.signature());
      } catch {
        return false;
      }
    });

    if (!userSignature) {
      this.challengeStore.delete(publicKey);
      throw new UnauthorizedException(
        'Invalid signature. Transaction was not signed by the provided public key.',
      );
    }

    // Remove used challenge
    this.challengeStore.delete(publicKey);

    // Find or create user with this Stellar public key
    let user = await this.userRepository.findOne({
      where: { stellarPublicKey: publicKey },
    });

    if (!user) {
      user = this.userRepository.create({
        stellarPublicKey: publicKey,
        updatedAt: new Date(),
      });
      await this.userRepository.save(user);
      this.logger.log(`New user created with public key: ${publicKey}`);
    } else {
      user.updatedAt = new Date();
      await this.userRepository.save(user);
      this.logger.log(`Existing user logged in: ${user.id}`);
    }

    // Generate JWT
    const payload = {
      sub: user.id,
      stellarPublicKey: publicKey,
      type: 'stellar-auth',
    };

    const token = this.jwtService.sign(payload);

    // Generate and store refresh token for Stellar auth
    const refreshToken = this.generateRefreshToken();
    await this.storeRefreshToken(refreshToken, user.id);

    return {
      success: true,
      token,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        createdAt: user.createdAt,
      },
    };
  }

  /**
   * Initiate password reset by generating a one-time token.
   * Always returns a success-style response to avoid leaking whether
   * an email exists in the system.
   */
  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      // Do not reveal that the email doesn't exist
      this.logger.debug('Password reset requested for non-existent email');
      return {
        message: 'If that email is registered, a reset link has been sent.',
      };
    }

    // Invalidate any previous unused tokens for this user
    await this.resetTokenRepository.update(
      { userId: user.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    // Generate a cryptographically secure random token
    const rawToken = crypto
      .randomBytes(AuthService.RESET_TOKEN_BYTES)
      .toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const resetToken = this.resetTokenRepository.create({
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + AuthService.RESET_TOKEN_EXPIRY_MS),
    });
    await this.resetTokenRepository.save(resetToken);

    // Send the email (mocked)
    await this.emailService.sendPasswordResetEmail(user.email, rawToken);

    return {
      message: 'If that email is registered, a reset link has been sent.',
    };
  }

  /**
   * Validate a one-time reset token and update the user's password.
   * The token is immediately invalidated after use.
   */
  async resetPassword(
    rawToken: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const storedToken = await this.resetTokenRepository.findOne({
      where: {
        tokenHash,
        usedAt: IsNull(),
      },
    });

    if (!storedToken) {
      throw new BadRequestException('Invalid or already-used reset token.');
    }

    if (new Date() > storedToken.expiresAt) {
      // Mark expired token as used so it cannot be retried
      storedToken.usedAt = new Date();
      await this.resetTokenRepository.save(storedToken);
      throw new BadRequestException(
        'Reset token has expired. Please request a new one.',
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: storedToken.userId },
    });

    if (!user) {
      throw new NotFoundException('Associated user account no longer exists.');
    }

    // Hash and persist the new password
    user.passwordHash = await bcrypt.hash(
      newPassword,
      AuthService.BCRYPT_SALT_ROUNDS,
    );
    await this.userRepository.save(user);

    // Invalidate the token
    storedToken.usedAt = new Date();
    await this.resetTokenRepository.save(storedToken);

    this.logger.log(`Password successfully reset for user ${user.id}`);

    return { message: 'Password has been reset successfully.' };
  }

  /**
   * Clean up expired challenges from memory
   */
  private cleanupExpiredChallenges(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, value] of this.challengeStore.entries()) {
      if (now > value.expiresAt) {
        this.challengeStore.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired challenges`);
    }
  }

  /**
   * Generate a cryptographically secure refresh token
   */
  private generateRefreshToken(): string {
    return crypto.randomBytes(AuthService.REFRESH_TOKEN_BYTES).toString('hex');
  }

  /**
   * Store refresh token in database
   */
  private async storeRefreshToken(
    token: string,
    userId: string,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const refreshToken = this.refreshTokenRepository.create({
      tokenHash,
      userId,
      expiresAt: new Date(
        Date.now() +
          AuthService.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      ),
      deviceInfo,
      ipAddress,
    });

    await this.refreshTokenRepository.save(refreshToken);
  }

  /**
   * Validate refresh token and return user
   */
  private async validateRefreshToken(
    token: string,
  ): Promise<{ user: User; refreshToken: RefreshToken }> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const refreshToken = await this.refreshTokenRepository.findOne({
      where: {
        tokenHash,
        revokedAt: IsNull(),
      },
      relations: ['user'],
    });

    if (!refreshToken) {
      throw new UnauthorizedException('Invalid or revoked refresh token');
    }

    if (new Date() > refreshToken.expiresAt) {
      // Mark expired token as revoked
      refreshToken.revokedAt = new Date();
      await this.refreshTokenRepository.save(refreshToken);
      throw new UnauthorizedException('Refresh token has expired');
    }

    return { user: refreshToken.user, refreshToken };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(
    refreshToken: string,
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<{
    access_token: string;
    refresh_token?: string;
  }> {
    const { user, refreshToken: storedToken } =
      await this.validateRefreshToken(refreshToken);

    // Generate new access token
    const payload = { email: user.email, sub: user.id };
    const accessToken = this.jwtService.sign(payload);

    // Token rotation: invalidate old refresh token and create new one
    storedToken.revokedAt = new Date();
    await this.refreshTokenRepository.save(storedToken);

    // Generate new refresh token
    const newRefreshToken = this.generateRefreshToken();
    await this.storeRefreshToken(
      newRefreshToken,
      user.id,
      deviceInfo,
      ipAddress,
    );

    this.logger.log(`Token refreshed for user ${user.id}`);

    return {
      access_token: accessToken,
      refresh_token: newRefreshToken,
    };
  }

  /**
   * Logout user by revoking refresh token
   */
  async logout(refreshToken: string): Promise<{ message: string }> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const storedToken = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
    });

    if (!storedToken) {
      // Token doesn't exist or already revoked - still return success for security
      this.logger.debug('Logout attempted with non-existent refresh token');
      return { message: 'Successfully logged out' };
    }

    if (storedToken.revokedAt) {
      // Token already revoked
      return { message: 'Successfully logged out' };
    }

    // Revoke the token
    storedToken.revokedAt = new Date();
    await this.refreshTokenRepository.save(storedToken);

    this.logger.log(
      `User logged out, refresh token revoked for user ${storedToken.userId}`,
    );

    return { message: 'Successfully logged out' };
  }

  /**
   * Logout from all devices by revoking all refresh tokens for a user
   */
  async logoutAll(userId: string): Promise<{ message: string }> {
    await this.refreshTokenRepository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    this.logger.log(`All refresh tokens revoked for user ${userId}`);

    return { message: 'Successfully logged out from all devices' };
  }
}
