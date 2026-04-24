/**
 * Test Notification Seeder
 * 
 * This script creates sample notifications for testing the notifications feature.
 * Run with: npx ts-node scripts/seed-test-notifications.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { NotificationsService } from '../src/notifications/notifications.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';

async function bootstrap() {
  console.log('🌱 Starting notification seeder...');
  
  const app = await NestFactory.createApplicationContext(AppModule);
  const notificationsService = app.get(NotificationsService);
  const userRepository = app.get<Repository<User>>(getRepositoryToken(User));

  // Get the first user or create test notifications for all users
  const users = await userRepository.find();
  
  if (users.length === 0) {
    console.log('❌ No users found in database. Please create a user first.');
    await app.close();
    process.exit(1);
  }

  const testNotifications = [
    {
      title: 'Price Alert: XLM Surge',
      message: 'Stellar (XLM) has increased by 15% in the last 24 hours. Current price: $0.12',
      type: 'price_alert',
    },
    {
      title: 'New Partnership Announced',
      message: 'Stellar Development Foundation announces partnership with major financial institution.',
      type: 'news_alert',
    },
    {
      title: 'Security Alert: Login Detected',
      message: 'New login detected from Chrome on Windows. Location: New York, US.',
      type: 'security_alert',
    },
    {
      title: 'Portfolio Snapshot Created',
      message: 'Your daily portfolio snapshot has been created. Total value: $1,234.56',
      type: 'account_activity',
    },
    {
      title: 'Price Alert: BTC Drop',
      message: 'Bitcoin (BTC) has dropped by 5% in the last hour. Current price: $42,000',
      type: 'price_alert',
    },
    {
      title: 'Weekly Market Report',
      message: 'Your weekly market summary is ready. View detailed insights in the app.',
      type: 'news_alert',
    },
  ];

  let totalCreated = 0;

  for (const user of users) {
    console.log(`\n📝 Creating notifications for user: ${user.email}`);
    
    for (const notif of testNotifications) {
      await notificationsService.createNotification(
        user.id,
        notif.title,
        notif.message,
        notif.type,
      );
      totalCreated++;
      console.log(`  ✓ Created: ${notif.title}`);
    }
  }

  console.log(`\n✅ Successfully created ${totalCreated} test notifications!`);
  console.log('\n💡 Tips:');
  console.log('  - Login to the mobile app to see these notifications');
  console.log('  - Tap the bell icon in the header to view notifications');
  console.log('  - Unread notifications show a red badge count');
  console.log('  - Tap a notification to mark it as read');
  
  await app.close();
  process.exit(0);
}

bootstrap().catch((error) => {
  console.error('❌ Seeder failed:', error);
  process.exit(1);
});
