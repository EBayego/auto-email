import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import { readPrivacyNotice } from '@/modules/privacy/config';
import {
  createPrivacyRepository,
  assertPrivacyAuthorized,
  enforcePrivacyConfiguration,
} from '@/db/privacy';
import { createGmailOAuthRepository } from '@/db/gmail-oauth-repository';
import { createGmailCredentialRepository } from '@/db/gmail-credential-repository';
import { createProviderRequestGate } from '@/db/provider-request-gate';
import { grantTestPrivacy } from './fixtures/privacy';
import { gmailScopes } from '@/config/google';

const url = process.env.AUTO_EMAIL_TEST_URL!,
  origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const owners: {
  id: string;
  email: string;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
}[] = [];
const cookies = (index = 0) =>
  [...owners[index].jar].map(([name, value]) => `${name}=${value}`).join('; ');
const notice = () => readPrivacyNotice();
const operation = () => ({
  action: 'grant',
  consent: true,
  version: notice().version,
  noticeHash: notice().hash,
});
const post = (body: unknown, index = 0, headers: Record<string, string> = {}) =>
  fetch(`${origin}/api/privacy`, {
    method: 'POST',
    headers: {
      origin,
      cookie: cookies(index),
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe('MAIL-061 privacidad con usuarios, API y Supabase locales', () => {
  beforeAll(async () => {
    if (url !== 'http://127.0.0.1:55321')
      throw new Error('Solo servicios locales');
    for (let i = 0; i < 2; i++) {
      const email = `mail061-${crypto.randomUUID()}@example.invalid`,
        password = `Test-${crypto.randomUUID()}`;
      // Deliberately no implicit consent fixture in this suite.
      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const jar = new Map<string, string>();
      const client = createAuthClient(
        {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (values) => {
            for (const { name, value } of values) {
              if (value) jar.set(name, value);
              else jar.delete(name);
            }
          },
        },
        {
          appOrigin: origin,
          supabaseUrl: url,
          publishableKey: process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
          secureCookies: false,
        },
      );
      owners.push({ id: created.data.user!.id, email, jar, client });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
    }
  });
  afterAll(async () => {
    for (const owner of owners) {
      await owner.client.auth.signOut();
      expect((await service.auth.admin.deleteUser(owner.id)).error).toBeNull();
    }
  });
  it('informa antes de conectar y no inicia OAuth ni procesamiento por navegar', async () => {
    const response = await fetch(`${origin}/privacy-consent?onboarding=1`, {
      headers: { cookie: cookies() },
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    for (const text of [
      'Antes de conectar Gmail',
      'OpenAI',
      'Supabase',
      'Limited Use',
      'Qué conservamos',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('checked=""');
    expect(
      (await createPrivacyRepository(service, owners[0].id).get()).authorized,
    ).toBe(false);
    const connect = await fetch(
      `${origin}/api/gmail/connect?authorized=1&onboarding=1`,
      { headers: { cookie: cookies() }, redirect: 'manual' },
    );
    expect(connect.status).toBe(303);
    expect(connect.headers.get('location')).toBe(
      `${origin}/privacy-consent?onboarding=1`,
    );
    await expect(
      assertPrivacyAuthorized(service, owners[0].id),
    ).rejects.toMatchObject({ code: 'PRIVACY_CONSENT_REQUIRED' });
    const repo = createGmailOAuthRepository(
      service,
      owners[0].id,
      crypto.randomUUID(),
    );
    await expect(
      repo.beginAttempt({
        stateHash: 'a'.repeat(64),
        codeVerifier: 'v'.repeat(43),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'PRIVACY_CONSENT_REQUIRED' });
  });
  it('rechaza CSRF, identidades manipuladas, versiones antiguas y aceptaciones sin acción explícita', async () => {
    expect(
      (await post(operation(), 0, { origin: 'https://evil.invalid' })).status,
    ).toBe(400);
    expect((await post({ ...operation(), userId: owners[1].id })).status).toBe(
      400,
    );
    expect((await post({ ...operation(), consent: false })).status).toBe(400);
    expect((await post({ ...operation(), version: 'old' })).status).toBe(400);
    const stale = await post({ ...operation(), noticeHash: 'b'.repeat(64) });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'STALE_PRIVACY_NOTICE' });
    const anonymous = await fetch(`${origin}/api/privacy`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(operation()),
    });
    expect(anonymous.status).toBe(401);
  });
  it('registra fecha, texto exacto, huella y versión sin conceder permisos opcionales', async () => {
    const response = await post(operation());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await response.json();
    expect(body.authorized).toBe(true);
    expect(body.events).toHaveLength(1);
    expect((await post(operation())).status).toBe(200);
    const stored = await service
      .from('privacy_authorizations')
      .select('*')
      .eq('user_id', owners[0].id)
      .single();
    expect(stored.data).toMatchObject({
      notice_text: notice().snapshot,
      notice_version: notice().version,
      notice_hash: notice().hash,
      withdrawn_at: null,
    });
    expect(Number.isFinite(Date.parse(stored.data!.accepted_at))).toBe(true);
    expect(
      (await createPrivacyRepository(service, owners[1].id).get()).authorized,
    ).toBe(false);
    expect(
      (await owners[1].client.from('privacy_authorizations').select('*')).error
        ?.code,
    ).toBe('42501');
    const rpc = await owners[0].client.rpc('withdraw_privacy_authorization', {
      p_user_id: owners[1].id,
    });
    expect(rpc.error?.code).toBe('42501');
  });
  it('descarga solo datos propios sin tokens y sigue disponible tras retirar la autorización', async () => {
    await grantTestPrivacy(service, owners[1].id);
    for (const owner of owners) {
      const r = await service.from('gmail_accounts').insert({
        user_id: owner.id,
        email: owner.email,
        status: 'CONNECTED',
        encrypted_refresh_token: 'private-test-token',
        scope_set: [...gmailScopes],
      });
      expect(r.error).toBeNull();
    }
    const response = await fetch(`${origin}/api/privacy/export`, {
      headers: { cookie: cookies() },
    });
    const content = await response.text();
    expect(response.status, content).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(content).toContain(owners[0].email);
    expect(content).not.toContain(owners[1].email);
    expect(content).not.toContain('private-test-token');
    expect(content).not.toContain('encrypted_refresh_token');
    const withdrawn = await post({ action: 'withdraw' });
    expect(withdrawn.status).toBe(200);
    expect((await withdrawn.json()).authorized).toBe(false);
    expect(
      (
        await fetch(`${origin}/api/privacy/export`, {
          headers: { cookie: cookies() },
        })
      ).status,
    ).toBe(200);
    const account = await service
      .from('gmail_accounts')
      .select('id,status')
      .eq('user_id', owners[0].id)
      .single();
    expect(account.data?.status).toBe('PAUSED');
    const credentials = createGmailCredentialRepository(
      service,
      owners[0].id,
      account.data!.id,
    );
    await expect(credentials.assertAuthorized!()).rejects.toMatchObject({
      code: 'PRIVACY_CONSENT_REQUIRED',
    });
    const gate = createProviderRequestGate(
      service,
      { userId: owners[0].id, gmailAccountId: account.data!.id },
      false,
    );
    await expect(
      gate.acquire(
        'openai',
        {
          maxConcurrent: 2,
          accountMaxConcurrent: 1,
          requestsPerMinute: 100,
          accountRequestsPerMinute: 50,
        },
        60,
      ),
    ).rejects.toMatchObject({ code: 'PRIVACY_CONSENT_REQUIRED' });
    expect(
      (await createPrivacyRepository(service, owners[1].id).get()).authorized,
    ).toBe(true);
  });
  it('una nueva configuración o versión del texto invalida la autorización anterior', async () => {
    const owner = owners[1];
    await expect(
      assertPrivacyAuthorized(service, owner.id),
    ).resolves.toBeUndefined();
    vi.stubEnv('PRIVACY_OPERATOR_NAME', 'Operador cambiado');
    expect(
      (await createPrivacyRepository(service, owner.id).get()).authorized,
    ).toBe(false);
    await expect(
      assertPrivacyAuthorized(service, owner.id),
    ).rejects.toMatchObject({ code: 'PRIVACY_CONSENT_REQUIRED' });
    await enforcePrivacyConfiguration(service);
    expect(
      (
        await service
          .from('gmail_accounts')
          .select('status')
          .eq('user_id', owner.id)
          .single()
      ).data?.status,
    ).toBe('PAUSED');
    vi.stubEnv('PRIVACY_OPERATOR_NAME', '');
    await enforcePrivacyConfiguration(service);
    await expect(
      assertPrivacyAuthorized(service, owner.id),
    ).rejects.toMatchObject({ code: 'PRIVACY_CONFIGURATION_REQUIRED' });
  });
});
