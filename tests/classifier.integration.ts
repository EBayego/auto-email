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
import { createClassifierExclusionRepository } from '@/db/classifier-exclusions';
import { createAccountEmailClassifier } from '@/worker/email-classifier';
import type { GmailClient, TextGenerationClient } from '@/providers/contracts';
import { gmailScopes } from '@/config/google';
import {
  classifierMessage,
  classifierMetadata,
} from './fixtures/classifier-emails';

const service = createClient<Database>(
  process.env.AUTO_EMAIL_TEST_URL!,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const owners: { userId: string; gmailAccountId: string; email: string }[] = [];
const password = 'Mail030-Synthetic-Password!';
const positive = {
  decision: 'REPLY_REQUIRED',
  intent: 'REQUEST_INFORMATION',
  reasons: ['EXPLICIT_QUESTION'],
  riskFlags: [],
  needsAttachment: false,
  confidence: 'HIGH',
};
function rules(index = 0) {
  const owner = owners[index];
  return createClassifierExclusionRepository(
    service,
    owner.userId,
    owner.gmailAccountId,
  );
}
function dependencies(index = 0) {
  const full = classifierMessage({ to: owners[index].email });
  const getMessage = vi
    .fn<GmailClient['getMessage']>()
    .mockImplementation(async (_id, options) =>
      options?.format === 'metadata' ? classifierMetadata(full) : full,
    );
  const generate = vi.fn<TextGenerationClient['generate']>().mockResolvedValue({
    text: JSON.stringify(positive),
    inputTokens: 100,
    outputTokens: 30,
  });
  return {
    full,
    getMessage,
    generate,
    input: {
      client: service,
      work: owners[index],
      gmail: { getMessage },
      text: { generate },
    },
  };
}

describe('MAIL-030 reglas persistentes y clasificador por usuario', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const email = `mail030-${crypto.randomUUID()}@example.invalid`;
      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const userId = created.data.user!.id;
      owners.push({ userId, gmailAccountId: '', email });
      const account = await service
        .from('gmail_accounts')
        .insert({
          user_id: userId,
          email,
          status: 'CONNECTED',
          encrypted_refresh_token: `\\x${'01'.repeat(40)}`,
          scope_set: [...gmailScopes],
        })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      owners[i].gmailAccountId = account.data!.id;
    }
  });
  beforeEach(async () => {
    for (const owner of owners) {
      expect(
        (
          await service
            .from('users')
            .update({ status: 'ACTIVE' })
            .eq('id', owner.userId)
        ).error,
      ).toBeNull();
      expect(
        (
          await service
            .from('gmail_accounts')
            .update({ status: 'CONNECTED' })
            .eq('id', owner.gmailAccountId)
            .eq('user_id', owner.userId)
        ).error,
      ).toBeNull();
      expect(
        (
          await service
            .from('user_settings')
            .update({
              classifier_excluded_addresses: [],
              classifier_excluded_domains: [],
            })
            .eq('user_id', owner.userId)
        ).error,
      ).toBeNull();
    }
  });
  afterAll(async () => {
    for (const owner of owners)
      expect(
        (await service.auth.admin.deleteUser(owner.userId)).error,
      ).toBeNull();
  });

  it('conserva reglas normalizadas después de crear otro repositorio', async () => {
    expect(await rules().get()).toEqual({
      excludedAddresses: [],
      excludedDomains: [],
    });
    await rules().set({
      excludedAddresses: ['CONTACT@EXAMPLE.INVALID', 'contact@example.invalid'],
      excludedDomains: ['ESPAÑA.es'],
    });
    expect(await rules().get()).toEqual({
      excludedAddresses: ['contact@example.invalid'],
      excludedDomains: ['xn--espaa-rta.es'],
    });
  });

  it('solo aplica las exclusiones del propietario de la cuenta, sin sesión de navegador', async () => {
    await rules(0).set({ excludedDomains: ['example.invalid'] });
    const first = dependencies(0);
    const second = dependencies(1);
    const classifierA = await createAccountEmailClassifier(first.input);
    const classifierB = await createAccountEmailClassifier(second.input);
    expect(await classifierA.classify(first.full.id)).toMatchObject({
      decision: 'NO_REPLY',
      reasons: ['EXCLUDED_DOMAIN'],
      modelCalls: 0,
    });
    expect(first.getMessage).toHaveBeenCalledOnce();
    expect(first.generate).not.toHaveBeenCalled();
    expect(await classifierB.classify(second.full.id)).toMatchObject({
      decision: 'REPLY_REQUIRED',
      source: 'MODEL',
    });
    expect(second.generate).toHaveBeenCalledOnce();
  });

  it('refresca las exclusiones entre llamadas y permite vaciarlas explícitamente', async () => {
    const f = dependencies();
    const classifier = await createAccountEmailClassifier(f.input);
    expect((await classifier.classify(f.full.id)).decision).toBe(
      'REPLY_REQUIRED',
    );
    await rules().set({ excludedAddresses: ['contact@example.invalid'] });
    expect((await classifier.classify(f.full.id, {})).decision).toBe(
      'NO_REPLY',
    );
    expect(f.generate).toHaveBeenCalledOnce();
    await rules().set({});
    expect((await classifier.classify(f.full.id)).decision).toBe(
      'REPLY_REQUIRED',
    );
    expect(f.generate).toHaveBeenCalledTimes(2);
  });

  it('las exclusiones de una prueba no cambian la configuración persistida', async () => {
    const f = dependencies();
    const classifier = await createAccountEmailClassifier(f.input);
    expect(
      (
        await classifier.classify(f.full.id, {
          excludedAddresses: ['contact@example.invalid'],
        })
      ).decision,
    ).toBe('NO_REPLY');
    expect(await rules().get()).toEqual({
      excludedAddresses: [],
      excludedDomains: [],
    });
  });

  it('rechaza mezclar la cuenta y el propietario, también con un cliente privilegiado', async () => {
    const f = dependencies();
    await expect(
      createAccountEmailClassifier({
        ...f.input,
        work: {
          userId: owners[1].userId,
          gmailAccountId: owners[0].gmailAccountId,
        },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createClassifierExclusionRepository(
        service,
        owners[1].userId,
        owners[0].gmailAccountId,
      ).set({ excludedDomains: ['blocked.invalid'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(f.getMessage).not.toHaveBeenCalled();
    expect((await rules(0).get()).excludedDomains).toEqual([]);
    expect((await rules(1).get()).excludedDomains).toEqual([]);
  });

  it('revalida pausa y baja del usuario antes de leer correo', async () => {
    const f = dependencies();
    const classifier = await createAccountEmailClassifier(f.input);
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ status: 'PAUSED' })
          .eq('id', owners[0].gmailAccountId)
      ).error,
    ).toBeNull();
    await expect(classifier.classify(f.full.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      (
        await service
          .from('users')
          .update({ status: 'DISABLED' })
          .eq('id', owners[0].userId)
      ).error,
    ).toBeNull();
    await expect(classifier.classify(f.full.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(f.getMessage).not.toHaveBeenCalled();
  });

  it('RLS permite consultar únicamente reglas propias y el navegador no puede modificarlas directamente', async () => {
    const browser = createClient<Database>(
      process.env.AUTO_EMAIL_TEST_URL!,
      process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    try {
      expect(
        (
          await browser.auth.signInWithPassword({
            email: owners[0].email,
            password,
          })
        ).error,
      ).toBeNull();
      const read = await browser
        .from('user_settings')
        .select(
          'user_id, classifier_excluded_addresses, classifier_excluded_domains',
        );
      expect(read.error).toBeNull();
      expect(read.data).toHaveLength(1);
      expect(read.data![0].user_id).toBe(owners[0].userId);
      const write = await browser
        .from('user_settings')
        .update({ classifier_excluded_domains: ['blocked.invalid'] })
        .eq('user_id', owners[0].userId);
      expect(write.error?.code).toBe('42501');
    } finally {
      await browser.auth.signOut({ scope: 'local' });
    }
  });
});
