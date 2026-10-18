import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createGmailOAuthRepository } from '@/db/gmail-oauth-repository';
import { createGmailCredentialRepository } from '@/db/gmail-credential-repository';
import { SecretValue } from '@/config/env';
import { gmailScopes } from '@/config/google';
import {
  decryptGmailRefreshToken,
  encryptGmailRefreshToken,
} from '@/modules/gmail/tokens';

const url = process.env.AUTO_EMAIL_TEST_URL!;
const secret = process.env.AUTO_EMAIL_TEST_SECRET_KEY!;
const publishable = process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!;
const service = createClient<Database>(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const users: string[] = [];
const sessions: {
  client: ReturnType<typeof createClient<Database>>;
  id: string;
  userId: string;
}[] = [];
const key = new SecretValue(Buffer.alloc(32, 12).toString('base64'));
const state = 'a'.repeat(64);
const attempt = {
  stateHash: state,
  codeVerifier: 'v'.repeat(43),
  expiresAt: new Date(Date.now() + 600000).toISOString(),
};

describe('MAIL-012 con sesiones y base de datos reales', () => {
  beforeAll(async () => {
    if (new URL(url).port !== '55321')
      throw new Error('Solo base local auto-email.');
    const password = `Test-${crypto.randomUUID()}`;
    for (let i = 0; i < 2; i++) {
      const email = `mail012-${crypto.randomUUID()}@example.invalid`;
      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      users.push(created.data.user!.id);
      for (let n = 0; n < (i === 0 ? 2 : 1); n++) {
        const client = createClient<Database>(url, publishable, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        expect(
          (await client.auth.signInWithPassword({ email, password })).error,
        ).toBeNull();
        const { data, error } = await client.auth.getClaims();
        expect(error).toBeNull();
        sessions.push({
          client,
          id: data!.claims.session_id as string,
          userId: created.data.user!.id,
        });
      }
    }
  });
  afterAll(async () => {
    for (const user of users)
      expect((await service.auth.admin.deleteUser(user)).error).toBeNull();
    for (const { client } of sessions) await client.auth.signOut();
  });
  const repository = (index: number) =>
    createGmailOAuthRepository(
      service,
      sessions[index].userId,
      sessions[index].id,
    );
  const connect = async (
    index: number,
    account: Parameters<ReturnType<typeof repository>['connectAccount']>[0],
  ) => {
    const repo = repository(index);
    await repo.beginAttempt(attempt);
    await repo.consumeAttempt(state);
    return repo.connectAccount(account);
  };

  it('otro usuario y otra sesión del mismo usuario no consumen el intento', async () => {
    await repository(0).beginAttempt(attempt);
    expect(await repository(2).consumeAttempt(state)).toBeNull();
    expect(await repository(1).consumeAttempt(state)).toBeNull();
    expect(await repository(0).consumeAttempt(state)).toBe(
      attempt.codeVerifier,
    );
    expect(await repository(0).consumeAttempt(state)).toBeNull();
  });

  it('la base consume el intento una sola vez incluso con callbacks concurrentes', async () => {
    await repository(0).beginAttempt(attempt);
    const results = await Promise.all([
      repository(0).consumeAttempt(state),
      repository(0).consumeAttempt(state),
    ]);
    expect(results.filter(Boolean)).toEqual([attempt.codeVerifier]);
  });

  it('rechaza intentos caducados y el navegador no puede leer verificadores', async () => {
    await repository(0).beginAttempt({
      ...attempt,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await repository(0).consumeAttempt(state)).toBeNull();
    expect(
      (await sessions[0].client.from('gmail_oauth_attempts').select('*')).error,
    ).not.toBeNull();
  });

  it('guarda una cuenta por usuario, cifra tokens y rechaza apropiaciones y sustituciones', async () => {
    const email = `mail012-box-${crypto.randomUUID()}@example.invalid`;
    const refresh = new SecretValue('synthetic-private-refresh');
    const ciphertext = encryptGmailRefreshToken(refresh, key, users[0], email);
    const account = {
      email,
      scopes: gmailScopes,
      encryptedRefreshToken: ciphertext,
    };
    await connect(0, account);
    const connected = await service
      .from('gmail_accounts')
      .select('*')
      .eq('user_id', users[0])
      .single();
    expect(connected.error).toBeNull();
    expect(connected.data!.status).toBe('CONNECTED');
    expect(
      decryptGmailRefreshToken(
        connected.data!.encrypted_refresh_token!,
        key,
        users[0],
        email,
      ).reveal(),
    ).toBe(refresh.reveal());
    expect(
      (
        await sessions[0].client
          .from('gmail_accounts')
          .select('encrypted_refresh_token')
      ).error,
    ).not.toBeNull();
    await expect(connect(2, account)).rejects.toMatchObject({
      code: 'ACCOUNT_IN_USE',
    });
    await expect(
      connect(0, {
        ...account,
        email: 'another@example.invalid',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });
    const newer = encryptGmailRefreshToken(
      new SecretValue('rotated-synthetic-token'),
      key,
      users[0],
      email,
    );
    await connect(1, {
      ...account,
      encryptedRefreshToken: newer,
    });
    const updated = await service
      .from('gmail_accounts')
      .select('*')
      .eq('user_id', users[0])
      .single();
    expect(updated.data!.id).toBe(connected.data!.id);
    expect(updated.data!.email).toBe(email);
    expect(updated.data!.encrypted_refresh_token).toBe(newer);
  });

  it('un callback iniciado antes de desconectar no puede volver a conectar la cuenta', async () => {
    const callback = repository(0);
    await callback.beginAttempt(attempt);
    await callback.consumeAttempt(state);
    const row = await service
      .from('gmail_accounts')
      .select('id,email')
      .eq('user_id', users[0])
      .single();
    const credentials = createGmailCredentialRepository(
      service,
      users[0],
      row.data!.id,
    );
    const lease = crypto.randomUUID();
    const stopped = await credentials.beginDisconnect(
      await credentials.get(),
      lease,
      new Date(Date.now() + 60000).toISOString(),
    );
    await credentials.finishDisconnect(stopped!, lease);
    await expect(
      callback.connectAccount({
        email: row.data!.email,
        scopes: gmailScopes,
        encryptedRefreshToken: encryptGmailRefreshToken(
          new SecretValue('stale-token'),
          key,
          users[0],
          row.data!.email,
        ),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await credentials.get()).status).toBe('DISCONNECTED');
  });

  it('rechaza usuarios deshabilitados y elimina el intento al cerrar la sesión', async () => {
    await repository(0).beginAttempt(attempt);
    expect(
      (
        await service
          .from('users')
          .update({ status: 'DISABLED' })
          .eq('id', users[0])
      ).error,
    ).toBeNull();
    await expect(repository(0).consumeAttempt(state)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      (
        await service
          .from('users')
          .update({ status: 'ACTIVE' })
          .eq('id', users[0])
      ).error,
    ).toBeNull();
    expect(
      (await sessions[0].client.auth.signOut({ scope: 'local' })).error,
    ).toBeNull();
    expect(await repository(0).consumeAttempt(state)).toBeNull();
  });
});
