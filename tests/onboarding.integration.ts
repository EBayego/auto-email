import { createAuthorizedTestUser } from './fixtures/privacy';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import { createOnboardingWorkerStore } from '@/db/onboarding';
import { runOnboardingAnalysis } from '@/worker/onboarding';
import { sentEmail, sentMailbox, withHeaders } from './fixtures/sent-emails';
import { writingProfileFixture } from './fixtures/writing-profile';

const url = process.env.AUTO_EMAIL_TEST_URL!;
const origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
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
const scope = {
  after: '2026-01-01',
  before: '2026-10-18',
  maxCandidates: 200,
  excludedAddresses: [],
  excludedDomains: [],
};
const cookie = (index = 0) =>
  [...owners[index].jar].map(([key, value]) => `${key}=${value}`).join('; ');
const post = (body: unknown, index = 0) =>
  fetch(`${origin}/api/onboarding`, {
    method: 'POST',
    headers: {
      origin,
      cookie: cookie(index),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
async function consent() {
  const response = await post({
    action: 'consent',
    consent: true,
    version: 'mail051-v1',
    scope,
  });
  expect(response.status).toBe(200);
  return (await response.json()).onboarding as {
    consent_revision: string;
    status: string;
  };
}
async function start() {
  const record = await consent();
  expect(
    (await post({ action: 'start', revision: record.consent_revision })).status,
  ).toBe(202);
  return record;
}
const get = async () =>
  (
    await (
      await fetch(`${origin}/api/onboarding`, { headers: { cookie: cookie() } })
    ).json()
  ).onboarding;
function worker(
  options: { empty?: boolean; duringModel?: () => Promise<void> } = {},
) {
  const gmail = sentMailbox(
    options.empty
      ? []
      : [0, 1, 2].map((index) =>
          withHeaders(sentEmail(index), { From: owners[0].email }),
        ),
  );
  const generate = vi.fn(async () => {
    await options.duringModel?.();
    return {
      text: JSON.stringify(writingProfileFixture()),
      inputTokens: 123,
      outputTokens: 90,
    };
  });
  const clientsFor = vi.fn(async (work: { userId: string }) => {
    if (work.userId !== owners[0].id)
      throw new Error(
        'No se permite procesar solicitudes ajenas a estas pruebas',
      );
    return {
      gmail,
      text: { generate },
      mailboxAddress: owners[0].email,
      model: 'test-model',
    };
  });
  return {
    run: () =>
      runOnboardingAnalysis({
        store: createOnboardingWorkerStore(service),
        clientsFor,
      }),
    clientsFor,
    generate,
  };
}
describe('MAIL-051 onboarding con sesión, cola y perfil real en Supabase local', () => {
  beforeAll(async () => {
    if (new URL(url).origin !== 'http://127.0.0.1:55321')
      throw new Error('Solo local');
    const pending = await service
      .from('gmail_onboarding')
      .select('user_id')
      .in('status', ['QUEUED', 'SAMPLING', 'ANALYZING']);
    expect(pending.error).toBeNull();
    expect(pending.data).toEqual([]);
    for (let index = 0; index < 2; index++) {
      const email = `mail051-${crypto.randomUUID()}@example.invalid`,
        password = `Test-${crypto.randomUUID()}`;
      const created = await createAuthorizedTestUser(service, {
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
      expect(
        (
          await service.from('gmail_accounts').insert({
            user_id: created.data.user!.id,
            email,
            status: 'CONNECTED',
            encrypted_refresh_token: '\\x74657374',
            scope_set: [
              'https://www.googleapis.com/auth/gmail.readonly',
              'https://www.googleapis.com/auth/gmail.compose',
            ],
          })
        ).error,
      ).toBeNull();
    }
  });
  beforeEach(async () => {
    for (const owner of owners) {
      expect(
        (
          await service
            .from('gmail_onboarding')
            .delete()
            .eq('user_id', owner.id)
        ).error,
      ).toBeNull();
      expect(
        (await service.from('style_profiles').delete().eq('user_id', owner.id))
          .error,
      ).toBeNull();
      expect(
        (
          await service
            .from('gmail_accounts')
            .update({ status: 'CONNECTED' })
            .eq('user_id', owner.id)
        ).error,
      ).toBeNull();
    }
  });
  afterAll(async () => {
    for (const owner of owners) {
      await owner.client.auth.signOut({ scope: 'local' });
      expect((await service.auth.admin.deleteUser(owner.id)).error).toBeNull();
    }
  });
  it('no admite acceso sin sesión ni análisis sin consentimiento', async () => {
    expect((await fetch(`${origin}/api/onboarding`)).status).toBe(401);
    const response = await post({
      action: 'start',
      revision: crypto.randomUUID(),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'CONSENT_REQUIRED' });
    const runtime = worker();
    expect(await runtime.run()).toEqual({ failed: false });
    expect(runtime.clientsFor).not.toHaveBeenCalled();
  });
  it('rechaza consentimiento falso y campos de identidad manipulados', async () => {
    expect(
      (
        await post({
          action: 'consent',
          consent: false,
          version: 'mail051-v1',
          scope,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          action: 'consent',
          consent: true,
          version: 'mail051-v1',
          scope,
          user_id: owners[1].id,
        })
      ).status,
    ).toBe(400);
    expect(await get()).toBeNull();
  });
  it('persistir consentimiento no consulta proveedores ni modifica la automatización', async () => {
    await consent();
    expect((await get()).status).toBe('CONSENTED');
    const runtime = worker();
    await runtime.run();
    expect(runtime.clientsFor).not.toHaveBeenCalled();
    const settings = await service
      .from('user_settings')
      .select('automation_enabled')
      .eq('user_id', owners[0].id)
      .single();
    expect(settings.data?.automation_enabled).toBe(false);
  });
  it('aísla el estado y los permisos de administración por usuario', async () => {
    await consent();
    const response = await fetch(`${origin}/api/onboarding`, {
      headers: { cookie: cookie(1) },
    });
    expect(await response.json()).toEqual({ onboarding: null });
    const other = await owners[1].client
      .from('gmail_onboarding')
      .select('user_id,scope')
      .eq('user_id', owners[0].id);
    expect(other.data).toEqual([]);
    const forbidden = await owners[1].client.rpc('claim_onboarding_analysis');
    expect(forbidden.error?.code).toBe('42501');
    const hidden = await owners[0].client
      .from('gmail_onboarding')
      .select('lease_id');
    expect(hidden.error?.code).toBe('42501');
    expect(JSON.stringify(await get())).not.toContain('lease_id');
  });
  it('rechaza una revisión antigua y hace idempotente un doble clic', async () => {
    const old = await consent();
    const current = await consent();
    expect(
      (await post({ action: 'start', revision: old.consent_revision })).status,
    ).toBe(409);
    const responses = await Promise.all([
      post({ action: 'start', revision: current.consent_revision }),
      post({ action: 'start', revision: current.consent_revision }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect((await get()).status).toBe('QUEUED');
  });
  it('completa muestreo y análisis, guarda un perfil pendiente de revisión y conserva el estado al recargar', async () => {
    await start();
    const runtime = worker();
    expect(await runtime.run()).toEqual({ failed: false });
    expect(runtime.generate).toHaveBeenCalledOnce();
    const record = await get();
    expect(record).toMatchObject({
      status: 'COMPLETED',
      selected: 3,
      scanned: 3,
      error_code: null,
    });
    const saved = await service
      .from('style_profiles')
      .select('profile,review_status,revision,source_message_ids')
      .eq('user_id', owners[0].id)
      .single();
    expect(saved.error).toBeNull();
    expect(saved.data?.review_status).toBe('UNREVIEWED');
    expect(saved.data?.revision).toBe(record.profile_revision);
    expect(saved.data?.profile).toEqual(writingProfileFixture());
    expect(JSON.stringify(saved.data)).not.toContain(
      'he revisado la propuesta del proyecto',
    );
    const html = await (
      await fetch(`${origin}/onboarding`, { headers: { cookie: cookie() } })
    ).text();
    expect(html).toContain('Tu perfil de escritura está preparado');
    expect(html).not.toContain(owners[1].email);
  });
  it('descarta el resultado de OpenAI cuando el usuario cancela durante el análisis', async () => {
    const record = await start();
    const runtime = worker({
      duringModel: async () => {
        expect(
          (await post({ action: 'cancel', revision: record.consent_revision }))
            .status,
        ).toBe(200);
      },
    });
    expect(await runtime.run()).toEqual({ failed: false });
    expect((await get()).status).toBe('CANCELLED');
    expect(
      (
        await service
          .from('style_profiles')
          .select('id')
          .eq('user_id', owners[0].id)
      ).data,
    ).toEqual([]);
  });
  it('una pausa durante la generación cancela el trabajo y bloquea la escritura del perfil', async () => {
    await start();
    const runtime = worker({
      duringModel: async () => {
        expect(
          (
            await service
              .from('gmail_accounts')
              .update({ status: 'PAUSED' })
              .eq('user_id', owners[0].id)
          ).error,
        ).toBeNull();
      },
    });
    expect(await runtime.run()).toEqual({ failed: false });
    expect((await get()).status).toBe('CANCELLED');
    expect(
      (
        await service
          .from('style_profiles')
          .select('id')
          .eq('user_id', owners[0].id)
      ).data,
    ).toEqual([]);
  });
  it('permite reintentar una muestra vacía sin volver a aceptar un alcance distinto', async () => {
    const record = await start();
    const runtime = worker({ empty: true });
    expect(await runtime.run()).toEqual({ failed: true });
    expect(runtime.generate).not.toHaveBeenCalled();
    expect(await get()).toMatchObject({
      status: 'FAILED',
      error_code: 'EMPTY_SAMPLE',
    });
    expect(
      (await post({ action: 'start', revision: record.consent_revision }))
        .status,
    ).toBe(202);
    expect(await worker().run()).toEqual({ failed: false });
  });
});
