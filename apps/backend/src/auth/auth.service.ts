import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Keypair, Networks, TransactionBuilder, Operation, BASE_FEE, Account, Transaction } from 'stellar-sdk';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

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

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private usersService: UsersService,
    private jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    // Initialize server keypair
    const serverSecret = this.configService.get<string>('STELLAR_SERVER_SECRET');
    if (!serverSecret) {
      throw new Error('STELLAR_SERVER_SECRET is not configured');
    }
    this.serverKeypair = Keypair.fromSecret(serverSecret);
    
    // Set Stellar network
    this.stellarNetwork = this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    
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

  login(user: { id: string; email: string }) {
    const payload = { email: user.email, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
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
    }catch{
  throw new BadRequestException('Invalid Stellar public key format');
}

    // Generate a random nonce
    const nonce = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now();

    // Create a Stellar transaction as the challenge (SEP-10 standard)
    const sourceAccount = new Account(this.serverKeypair.publicKey(), '-1');
    
    const networkPassphrase = this.stellarNetwork === 'testnet' 
      ? Networks.TESTNET 
      : Networks.PUBLIC;
    
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
        })
      )
      .addOperation(
        Operation.manageData({
          name: 'web_auth_domain',
          value: Buffer.from(this.configService.get<string>('DOMAIN', 'lumenpulse.io')),
          source: this.serverKeypair.publicKey(),
        })
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
    user: Partial<User>;
  }> {
    // Retrieve stored challenge
    const storedChallenge = this.challengeStore.get(publicKey);

    if (!storedChallenge) {
      throw new UnauthorizedException(
        'No challenge found for this public key. Please request a new challenge.'
      );
    }

    // Check if challenge has expired
    if (Date.now() > storedChallenge.expiresAt) {
      this.challengeStore.delete(publicKey);
      throw new UnauthorizedException(
        'Challenge has expired. Please request a new challenge.'
      );
    }

    // Import the signed transaction
    const networkPassphrase = this.stellarNetwork === 'testnet' 
      ? Networks.TESTNET 
      : Networks.PUBLIC;
      
    let transaction: Transaction;
    
    try {
      transaction = new Transaction(signedChallenge, networkPassphrase);
    } catch{
      this.challengeStore.delete(publicKey);
      throw new BadRequestException('Invalid transaction format');
    }

    // Verify the transaction was signed by the user
    const userSignature = transaction.signatures.find(sig => {
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
        'Invalid signature. Transaction was not signed by the provided public key.'
      );
    }

    // Remove used challenge
    this.challengeStore.delete(publicKey);

    // Find or create user with this Stellar public key
    let user = await this.userRepository.findOne({
      where: { id: publicKey },
    });

    if (!user) {
      user = this.userRepository.create({
        id: publicKey,
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

    return {
      success: true,
      token,
      user: {
        id: user.id,
        passwordHash: user.id,
        createdAt: user.createdAt
      },
    };
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
}
