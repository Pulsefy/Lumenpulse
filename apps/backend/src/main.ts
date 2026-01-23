import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getConnectionToken } from '@nestjs/typeorm';
import { Connection } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Wait for TypeORM connection to be established
  try {
    const connection = app.get<Connection>(getConnectionToken());
    if (connection.isConnected) {
      console.log('✅ TypeORM Connection established');
      const options = connection.options;
      const database = String(options.database || 'unknown');
      
      // Type guard for PostgreSQL connection options
      if ('host' in options && 'port' in options) {
        const host = String(options.host || 'unknown');
        const port = Number(options.port) || 5432;
        console.log(`📊 Database: ${database}`);
        console.log(`🔌 Host: ${host}:${port}`);
      } else {
        console.log(`📊 Database: ${database}`);
      }
    }
  } catch (error) {
    console.error('❌ TypeORM Connection failed:', error);
  }
  
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}
void bootstrap();
