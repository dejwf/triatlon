import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.WEB_URL ?? 'http://localhost:5173' });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT ?? 3000));
}

void bootstrap();
