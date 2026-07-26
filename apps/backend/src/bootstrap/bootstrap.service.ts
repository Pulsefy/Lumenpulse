import {
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { config } from '../lib/config';
import { CrowdfundService } from '../crowdfund/crowdfund.service';
import { News } from '../news/news.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { BootstrapResponseDto, SeededEntity } from './dto/bootstrap-response.dto';

const DEMO_USERS = [
  {
    email: 'alice@lumenpulse.test',
    firstName: 'Alice',
    lastName: 'Stellar',
    displayName: 'alice_stellar',
    stellarPublicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    role: UserRole.USER,
    password: 'DemoPassword123!',
  },
  {
    email: 'bob@lumenpulse.test',
    firstName: 'Bob',
    lastName: 'Horizon',
    displayName: 'bob_horizon',
    stellarPublicKey: 'GBYD6MQZFKGTX4XFNXMZPTBOHSXMCURJJR7JTXRLDTZBQ7IJQFZUWEJ',
    role: UserRole.REVIEWER,
    password: 'DemoPassword123!',
  },
  {
    email: 'carol@lumenpulse.test',
    firstName: 'Carol',
    lastName: 'Soroban',
    displayName: 'carol_soroban',
    stellarPublicKey: 'GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH3PRXC7XMGZ3TQKQ',
    role: UserRole.ADMIN,
    password: 'DemoPassword123!',
  },
];

const DEMO_ARTICLES = [
  {
    title: 'Stellar Network Reaches 10M Daily Transactions',
    url: 'https://stellar.org/news/stellar-10m-tx',
    source: 'Stellar Blog',
    tags: ['stellar', 'milestone', 'network'],
    category: 'ecosystem',
    sentimentScore: 0.85,
  },
  {
    title: 'Soroban Smart Contracts Launch on Testnet',
    url: 'https://stellar.org/news/soroban-testnet',
    source: 'Stellar Blog',
    tags: ['soroban', 'smart-contracts', 'testnet'],
    category: 'technology',
    sentimentScore: 0.92,
  },
  {
    title: 'Lumenpulse Integrates Soroban for Crowdfunding',
    url: 'https://lumenpulse.io/blog/soroban-crowdfund',
    source: 'Lumenpulse',
    tags: ['lumenpulse', 'crowdfund', 'soroban'],
    category: 'product',
    sentimentScore: 0.78,
  },
  {
    title: 'Stellar Community Fund Announces Q3 Grants',
    url: 'https://stellar.org/community-fund-q3',
    source: 'Stellar Blog',
    tags: ['stellar', 'community', 'grants'],
    category: 'community',
    sentimentScore: 0.72,
  },
  {
    title: 'Cross-Chain Bridge Development Kit Released',
    url: 'https://stellar.org/dev/bridge-kit',
    source: 'Stellar Developers',
    tags: ['stellar', 'bridge', 'development'],
    category: 'technology',
    sentimentScore: 0.88,
  },
];

@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly crowdfundService: CrowdfundService,
    @InjectRepository(News)
    private readonly newsRepository: Repository<News>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async bootstrapAll(): Promise<BootstrapResponseDto> {
    this.assertTestnetOrThrow();
    this.assertFeatureEnabledOrThrow();

    const seeded: SeededEntity[] = [];

    const users = await this.seedUsers();
    seeded.push(users);

    const projects = await this.seedCrowdfundProjects();
    seeded.push(projects);

    const articles = await this.seedNewsArticles();
    seeded.push(articles);

    const summary = [
      `Bootstrapped ${users.count} users`,
      `${projects.count} projects`,
      `${articles.count} news articles`,
    ].join(', ');

    this.logger.log(summary);

    return {
      success: true,
      seeded,
      summary,
      timestamp: new Date().toISOString(),
      network: config.stellar.network,
    };
  }

  async reset(): Promise<void> {
    this.assertTestnetOrThrow();
    this.assertFeatureEnabledOrThrow();

    this.logger.log('Resetting demo data...');

    this.crowdfundService.resetDemoData();

    const demoEmails = DEMO_USERS.map((u) => u.email);
    await this.userRepository.delete({ email: In(demoEmails as [string, ...string[]]) });

    const demoUrls = DEMO_ARTICLES.map((a) => a.url);
    await this.newsRepository.delete({ url: In(demoUrls as [string, ...string[]]) });

    this.logger.log('Demo data reset complete');
  }

  private assertTestnetOrThrow(): void {
    if (config.stellar.network !== 'testnet') {
      throw new ForbiddenException(
        'Bootstrap is only available on testnet. ' +
        `Current network: ${config.stellar.network}. ` +
        `Set STELLAR_NETWORK=testnet to use this feature.`,
      );
    }
  }

  private assertFeatureEnabledOrThrow(): void {
    if (!config.featureFlags.bootstrapDemoData) {
      throw new ForbiddenException(
        'Demo bootstrap is disabled. Set BOOTSTRAP_DEMO_DATA_ENABLED=true to enable it.',
      );
    }
  }

  private async seedUsers(): Promise<SeededEntity> {
    const ids: string[] = [];

    for (const demo of DEMO_USERS) {
      const existing = await this.userRepository.findOne({
        where: { email: demo.email },
      });
      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const passwordHash = await bcrypt.hash(demo.password, 10);
      const user = this.userRepository.create({
        email: demo.email,
        firstName: demo.firstName,
        lastName: demo.lastName,
        displayName: demo.displayName,
        stellarPublicKey: demo.stellarPublicKey,
        role: demo.role,
        passwordHash,
      });
      const saved = await this.userRepository.save(user);
      ids.push(saved.id);
    }

    return { type: 'users', count: ids.length, ids };
  }

  private async seedCrowdfundProjects(): Promise<SeededEntity> {
    this.crowdfundService.resetDemoData();

    const { projectIds } = this.crowdfundService.bootstrapDemoData();

    return {
      type: 'projects',
      count: projectIds.length,
      ids: projectIds.map(String),
    };
  }

  private async seedNewsArticles(): Promise<SeededEntity> {
    const ids: string[] = [];

    for (const article of DEMO_ARTICLES) {
      const existing = await this.newsRepository.findOne({
        where: { url: article.url },
      });
      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const entity = this.newsRepository.create({
        ...article,
        publishedAt: new Date(Date.now() - Math.random() * 7 * 86400000),
      });
      const saved = await this.newsRepository.save(entity);
      ids.push(saved.id);
    }

    return { type: 'news', count: ids.length, ids };
  }
}
