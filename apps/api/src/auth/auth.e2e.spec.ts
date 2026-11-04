/**
 * Integrační test přihlášení magic linkem proti skutečné DB (docker-compose).
 * E-maily se neodesílají — MailService se v testu nahradí zachytávačem.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AuthTokens } from '@triatlon/shared';
import { AppModule } from '../app.module';
import { AUTH } from '../config';
import { MailService, type MailMessage } from '../mail/mail.service';
import { PrismaService } from '../prisma.service';

const email = `test-${crypto.randomUUID()}@example.com`;
const outbox: MailMessage[] = [];
let app: INestApplication;
let base: string;

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as unknown) : undefined };
}

async function requestMail(): Promise<{ token: string; code: string }> {
  const before = outbox.length;
  assert.equal((await post('/auth/request', { email: email.toUpperCase() })).status, 202);
  assert.equal(outbox.length, before + 1, 'má přijít právě jeden e-mail');
  const text = outbox.at(-1)!.text;
  return {
    token: decodeURIComponent(/token=([^\s]+)/.exec(text)![1]!),
    code: /kód: (\d{6})/.exec(text)![1]!,
  };
}

describe('auth (magic link)', () => {
  before(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    app.get(MailService).send = async (m: MailMessage) => {
      outbox.push(m);
    };
    await app.listen(0);
    base = `${await app.getUrl()}/api`.replace('[::1]', 'localhost');
    await app.get(PrismaService).user.create({ data: { email, name: 'Test', role: 'organizer' } });
  });

  after(async () => {
    await app.get(PrismaService).user.deleteMany({ where: { email } });
    await app.close();
  });

  it('neznámý e-mail: 202, ale žádný e-mail se neodešle', async () => {
    const res = await post('/auth/request', { email: `nikdo-${crypto.randomUUID()}@example.com` });
    assert.equal(res.status, 202);
    assert.equal(outbox.length, 0);
  });

  it('chráněný endpoint bez tokenu vrací 401', async () => {
    assert.equal((await fetch(`${base}/auth/me`)).status, 401);
  });

  it('přihlášení odkazem; odkaz jde použít jen jednou', async () => {
    const { token } = await requestMail();
    const res = await post('/auth/verify', { token });
    assert.equal(res.status, 200);
    const tokens = res.body as AuthTokens;
    assert.equal(tokens.user.email, email);

    const me = await fetch(`${base}/auth/me`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(me.status, 200);
    assert.equal(((await me.json()) as { role: string }).role, 'organizer');

    assert.equal((await post('/auth/verify', { token })).status, 401);
  });

  it('kód se po vyčerpání pokusů zneplatní', async () => {
    const { code } = await requestMail();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < AUTH.maxCodeAttempts; i++) {
      assert.equal((await post('/auth/verify', { email, code: wrong })).status, 401);
    }
    assert.equal((await post('/auth/verify', { email, code })).status, 401);
  });

  it('přihlášení kódem, rotace refresh tokenu a odhlášení', async () => {
    const { code } = await requestMail();
    const login = await post('/auth/verify', { email, code, deviceId: 'test-device' });
    assert.equal(login.status, 200);
    const first = login.body as AuthTokens;

    const refreshed = await post('/auth/refresh', { refreshToken: first.refreshToken });
    assert.equal(refreshed.status, 200);
    const second = refreshed.body as AuthTokens;
    assert.notEqual(second.refreshToken, first.refreshToken);

    // Starý refresh token už neplatí.
    assert.equal((await post('/auth/refresh', { refreshToken: first.refreshToken })).status, 401);

    assert.equal((await post('/auth/logout', {}, second.accessToken)).status, 204);
    assert.equal((await post('/auth/refresh', { refreshToken: second.refreshToken })).status, 401);
  });

  it('neplatná data vrací 400', async () => {
    assert.equal((await post('/auth/request', { email: 'není-email' })).status, 400);
    assert.equal((await post('/auth/verify', { email, code: '12' })).status, 400);
  });
});
