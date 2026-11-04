import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // Web + případné další originy (např. Expo web při vývoji mobilu: http://localhost:8081).
  // Nativní appka Origin neposílá, CORS se jí netýká.
  const origins = [process.env.WEB_URL ?? 'http://localhost:5173'].concat(
    (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
  app.enableCors({ origin: origins });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT ?? 3000));
}

void bootstrap();
