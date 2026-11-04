/** Pomocné funkce pro integrační testy (node:test) proti skutečné DB z docker-compose. */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { UserRole } from '@triatlon/shared';
import { AppModule } from './app.module';
import { TokenService } from './auth/token.service';
import { MailService, type MailMessage } from './mail/mail.service';
import { PrismaService } from './prisma.service';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  outbox: MailMessage[];
  base: string;
  /** Vytvoří uživatele a vrátí access token (bez e-mailového kolečka). */
  login(role: UserRole, email?: string): Promise<{ id: string; token: string }>;
  request(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  const outbox: MailMessage[] = [];
  app.get(MailService).send = async (m: MailMessage) => {
    outbox.push(m);
  };
  await app.listen(0);
  const base = `${await app.getUrl()}/api`.replace('[::1]', 'localhost');
  const prisma = app.get(PrismaService);
  const createdUsers: string[] = [];

  return {
    app,
    prisma,
    outbox,
    base,
    async login(role, email = `test-${crypto.randomUUID()}@example.com`) {
      const user = await prisma.user.create({ data: { email, name: `Test ${role}`, role } });
      createdUsers.push(user.id);
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          refreshHash: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      const { token } = await app
        .get(TokenService)
        .signAccessToken({ id: user.id, role, sessionId: session.id });
      return { id: user.id, token };
    },
    async request(method, path, body, token) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined };
    },
    async close() {
      await prisma.auditLog.deleteMany({ where: { userId: { in: createdUsers } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
      await app.close();
    },
  };
}
