import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import { createAuthorizedTestUser } from './fixtures/privacy';
import { gmailScopes } from '@/config/google';
import { getErasureLedger } from '@/modules/security/erasure-ledger';
import {
  containSecurityIncident,
  replayErasureLedger,
  verifyErasureReplay,
} from '@/db/security-maintenance';
import { createAccountLifecycleRepository } from '@/db/account-deletion';
import { assertPrivacyAuthorized } from '@/db/privacy';
import { openUserDataAccess } from '@/db/user-data';
import { readWebServerConfig } from '@/config/env';
import { createAccountDeletionRuntime } from '@/db/account-deletion-runtime';
import { recoverErasureRequests } from '@/db/erasure-recovery';

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
  client: ReturnType<typeof createAuthClient>;
  jar: Map<string, string>;
}[] = [];
const cookie = (i = 0) =>
  [...owners[i].jar].map(([name, value]) => `${name}=${value}`).join('; ');
describe('MAIL-062 contención, secretos y recuperación tras restaurar una copia', () => {
  beforeAll(async () => {
    if (url !== 'http://127.0.0.1:55321')
      throw new Error('Solo servicios locales');
    for (let i = 0; i < 2; i++) {
      const email = `mail062-${crypto.randomUUID()}@example.invalid`,
        password = `Test-${crypto.randomUUID()}`;
      const created = await createAuthorizedTestUser(service, {
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const id = created.data.user!.id,
        jar = new Map<string, string>();
      const client = createAuthClient(
        {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (values) => {
            for (const { name, value, options } of values) {
              if (value) jar.set(name, value);
              else jar.delete(name);
              expect(options.httpOnly).toBe(true);
              expect(options.sameSite).toBe('lax');
              expect(options.maxAge).toBeLessThanOrEqual(7 * 86400);
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
      owners.push({ id, email, jar, client });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      expect(
        (
          await service.from('gmail_accounts').insert({
            user_id: id,
            email,
            status: 'CONNECTED',
            encrypted_refresh_token: 'synthetic',
            scope_set: [...gmailScopes],
          })
        ).error,
      ).toBeNull();
    }
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await service.rpc('release_security_hold', { p_reviewed: true });
    for (const owner of owners) {
      await owner.client.auth.signOut();
      const existing = await service.auth.admin.getUserById(owner.id);
      if (existing.data.user)
        expect(
          (await service.auth.admin.deleteUser(owner.id)).error,
        ).toBeNull();
    }
  });
  it('la web devuelve cabeceras de protección y atiende datos privados sin la clave de OpenAI', async () => {
    const response = await fetch(`${origin}/api/account`, {
      headers: { cookie: cookie() },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await response.text();
    expect(body).not.toContain('encrypted_refresh_token');
    expect(body).not.toContain('ERASURE_LEDGER_ENCRYPTION_KEY');
  });
  it('conserva la supresión fuera de la base aunque una restauración recupere el usuario ACTIVE', async () => {
    const owner = owners[1],
      repo = createAccountLifecycleRepository(service, owner.id);
    await repo.requestDeletion('a'.repeat(64));
    expect(await getErasureLedger()!.has(owner.id)).toBe(true);
    // Simulates the affected rows coming back from a pre-erasure database backup.
    expect(
      (
        await service
          .from('account_deletion_requests')
          .delete()
          .eq('user_id', owner.id)
      ).error,
    ).toBeNull();
    expect(
      (
        await service
          .from('users')
          .update({ status: 'ACTIVE' })
          .eq('id', owner.id)
      ).error,
    ).toBeNull();
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({
            status: 'CONNECTED',
            encrypted_refresh_token: 'synthetic-restored',
            scope_set: [...gmailScopes],
          })
          .eq('user_id', owner.id)
      ).error,
    ).toBeNull();
    expect(
      (
        await service
          .from('user_settings')
          .update({ automation_enabled: true })
          .eq('user_id', owner.id)
      ).error,
    ).toBeNull();
    await expect(openUserDataAccess(owner.client)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      assertPrivacyAuthorized(service, owner.id),
    ).rejects.toMatchObject({ code: 'ACCOUNT_ERASED' });
    await expect(verifyErasureReplay(service)).rejects.toMatchObject({
      code: 'RESTORE_REPLAY_INCOMPLETE',
    });
  });
  it('la contención bloquea JWT existentes y los proveedores hasta revisar la restauración', async () => {
    await containSecurityIncident(service);
    expect((await owners[0].client.rpc('security_access_allowed')).data).toBe(
      false,
    );
    expect((await owners[0].client.from('users').select('id')).data).toEqual(
      [],
    );
    await expect(
      assertPrivacyAuthorized(service, owners[0].id),
    ).rejects.toMatchObject({ code: 'PRIVACY_CONSENT_REQUIRED' });
    const response = await fetch(`${origin}/api/account`, {
      headers: { cookie: cookie() },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(owners[0].email);
    expect(
      (await service.rpc('release_security_hold', { p_reviewed: false })).error
        ?.message,
    ).toBe('REVIEW_REQUIRED');
  });
  it('reaplica la eliminación restaurada antes de permitir la liberación y no reactiva Gmail', async () => {
    await expect(
      replayErasureLedger(service, readWebServerConfig()),
    ).rejects.toMatchObject({ code: 'SECURITY_MAINTENANCE' });
    vi.stubEnv('SECURITY_MAINTENANCE_MODE', 'true');
    expect(await replayErasureLedger(service, readWebServerConfig())).toEqual({
      completed: 1,
    });
    await expect(verifyErasureReplay(service)).resolves.toBeUndefined();
    expect(
      (await service.auth.admin.getUserById(owners[1].id)).data.user,
    ).toBeNull();
    expect((await service.rpc('security_access_allowed')).data).toBe(false);
    expect(
      (await service.rpc('release_security_hold', { p_reviewed: true })).error,
    ).toBeNull();
    vi.stubEnv('SECURITY_MAINTENANCE_MODE', 'false');
    expect(
      (
        await service
          .from('gmail_accounts')
          .select('status')
          .eq('user_id', owners[0].id)
          .single()
      ).data?.status,
    ).toBe('PAUSED');
    expect(
      (
        await service
          .from('user_settings')
          .select('automation_enabled')
          .eq('user_id', owners[0].id)
          .single()
      ).data?.automation_enabled,
    ).toBe(false);
  });
  it('el worker recupera una supresión registrada aunque se pierda la inserción de la cola', async () => {
    const email = `mail062-recovery-${crypto.randomUUID()}@example.invalid`;
    const created = await createAuthorizedTestUser(service, {
      email,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;
    try {
      await getErasureLedger()!.record(id);
      // No deletion request exists: this is the failure window after ledger fsync.
      expect(
        (
          await service
            .from('account_deletion_requests')
            .select('id')
            .eq('user_id', id)
        ).data,
      ).toEqual([]);
      await recoverErasureRequests(service);
      const queued = await service
        .from('account_deletion_requests')
        .select('id')
        .eq('user_id', id)
        .single();
      expect(queued.error).toBeNull();
      const result = await createAccountDeletionRuntime(readWebServerConfig())({
        requestId: queued.data!.id,
        limit: 1,
      });
      expect(result.failed).toBe(false);
      expect((await service.auth.admin.getUserById(id)).data.user).toBeNull();
      expect(await getErasureLedger()!.has(id)).toBe(true);
    } finally {
      const user = await service.auth.admin.getUserById(id);
      if (user.data.user) await service.auth.admin.deleteUser(id);
    }
  });
});
