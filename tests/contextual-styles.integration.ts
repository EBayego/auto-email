import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createWritingProfileRepository } from '@/db/writing-profiles';
import { createStyleRelationshipRepository } from '@/db/style-relationships';
import { selectContextualWritingProfile } from '@/db/contextual-styles';
import type { StyleScope } from '@/modules/identity/contextual-style';
import { gmailScopes } from '@/config/google';
import { writingProfileFixture } from './fixtures/writing-profile';

const url = process.env.AUTO_EMAIL_TEST_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const owners: { id: string; accountId: string }[] = [];
const deletedUsers = new Set<string>();
const browsers: ReturnType<typeof createClient<Database>>[] = [];
const generalInput = () => ({
  profile: writingProfileFixture(),
  model: 'test-model',
  sampleSize: 1,
  sourceMessageIds: ['sent0'],
  inputTokens: 10,
  outputTokens: 10,
  warnings: [] as const,
});
const repo = (scope: StyleScope = { kind: 'GENERAL', key: '' }, index = 0) =>
  createWritingProfileRepository(
    service,
    owners[index].id,
    owners[index].accountId,
    scope,
  );
const relationships = (index = 0) =>
  createStyleRelationshipRepository(
    service,
    owners[index].id,
    owners[index].accountId,
  );
const select = (recipient: string, now?: Date, index = 0) =>
  selectContextualWritingProfile(
    service,
    owners[index].id,
    owners[index].accountId,
    recipient,
    now,
  );
const contact: StyleScope = { kind: 'RECIPIENT', key: 'alice@company.invalid' };
const domain: StyleScope = { kind: 'DOMAIN', key: 'company.invalid' };
const category: StyleScope = { kind: 'RELATIONSHIP', key: 'CLIENT' };
async function contextualInput(scope: StyleScope) {
  const general = (await repo().get())!;
  const rules = await relationships().list();
  return {
    ...generalInput(),
    profile: {
      ...writingProfileFixture(),
      formality: 'high' as const,
      average_length: 'long' as const,
      language: 'en',
    },
    sampleSize: 10,
    sourceMessageIds: Array.from({ length: 10 }, (_, i) => `sent${i}`),
    context: {
      parentRevision: general.revision,
      evidence: {
        threads: 5,
        days: 3,
        words: 200,
        recipients: scope.kind === 'RECIPIENT' ? 1 : 3,
      },
      ...(scope.kind === 'RELATIONSHIP'
        ? { ruleRevisions: rules.map((r) => r.revision) }
        : {}),
    },
  };
}
describe('MAIL-025, perfiles contextuales y categorías con dos cuentas reales locales', () => {
  beforeAll(async () => {
    if (new URL(url).port !== '55321')
      throw new Error('Solo base temporal local.');
    for (let i = 0; i < 2; i++) {
      const email = `mail025-${crypto.randomUUID()}@example.invalid`,
        password = `Test-${crypto.randomUUID()}`;
      const user = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(user.error).toBeNull();
      owners.push({ id: user.data.user!.id, accountId: '' });
      const account = await service
        .from('gmail_accounts')
        .insert({
          user_id: owners[i].id,
          email,
          status: 'CONNECTED',
          scope_set: [...gmailScopes],
          encrypted_refresh_token: '\\x74657374',
        })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      owners[i].accountId = account.data!.id;
      const browser = createClient<Database>(
        url,
        process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      browsers.push(browser);
      expect(
        (await browser.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      const profile = await repo({ kind: 'GENERAL', key: '' }, i).save(
        generalInput(),
      );
      await repo({ kind: 'GENERAL', key: '' }, i).confirm(profile.revision);
    }
  });
  afterAll(async () => {
    for (const browser of browsers)
      await browser.auth.signOut({ scope: 'local' });
    for (const owner of owners)
      if (!deletedUsers.has(owner.id))
        expect(
          (await service.auth.admin.deleteUser(owner.id)).error,
        ).toBeNull();
  });
  it('crea y recupera estilos diferentes para contacto, dominio y categoría sin sobrescribir el general', async () => {
    await relationships().set({
      kind: 'DOMAIN',
      key: 'company.invalid',
      category: 'CLIENT',
    });
    for (const scope of [contact, domain, category]) {
      const saved = await repo(scope).save(await contextualInput(scope));
      await repo(scope).confirm(saved.revision);
      expect((await repo(scope).get())?.scope_key).toBe(scope.key);
    }
    expect((await repo().get())!.profile.formality).toBe('medium');
    expect((await select('alice@company.invalid'))?.scope_kind).toBe(
      'RECIPIENT',
    );
    expect((await select('unknown@company.invalid'))?.scope_kind).toBe(
      'RELATIONSHIP',
    );
    expect((await select('someone@other.invalid'))?.scope_kind).toBe('GENERAL');
    expect((await select('alice@company.invalid'))!.profile).toMatchObject({
      formality: 'high',
      average_length: 'long',
      language: 'en',
    });
  });
  it('descarta perfiles sin revisar o caducados y usa otra evidencia suficiente', async () => {
    await repo(contact).save(await contextualInput(contact));
    expect((await select('alice@company.invalid'))?.scope_kind).toBe(
      'RELATIONSHIP',
    );
    expect(
      (
        await select(
          'alice@company.invalid',
          new Date(Date.now() + 91 * 86400000),
        )
      )?.scope_kind,
    ).toBe('GENERAL');
  });
  it('impide perfiles contextuales con muestras insuficientes antes de escribir', async () => {
    const input = await contextualInput(contact);
    await expect(
      repo(contact).save({
        ...input,
        context: {
          ...input.context,
          evidence: { ...input.context.evidence, threads: 1 },
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('invalida categorías al reasignarlas y rechaza una generación terminada con configuración antigua', async () => {
    const oldRules = await relationships().list();
    await relationships().set({
      kind: 'DOMAIN',
      key: 'company.invalid',
      category: 'SUPPLIER',
    });
    expect(await repo(category).get()).toBeNull();
    const supplier: StyleScope = { kind: 'RELATIONSHIP', key: 'SUPPLIER' };
    const input = await contextualInput(supplier);
    const stale = await repo(supplier).save({
      ...input,
      context: {
        ...input.context,
        ruleRevisions: oldRules.map((r) => r.revision),
      },
    });
    await repo(supplier).confirm(stale.revision);
    expect((await select('unknown@company.invalid'))?.scope_kind).toBe(
      'DOMAIN',
    );
    const current = await repo(supplier).save(await contextualInput(supplier));
    await repo(supplier).confirm(current.revision);
    expect((await select('unknown@company.invalid'))?.scope_key).toBe(
      'SUPPLIER',
    );
    await relationships().remove({ kind: 'DOMAIN', key: 'company.invalid' });
    expect(await repo(supplier).get()).toBeNull();
    expect((await select('unknown@company.invalid'))?.scope_kind).toBe(
      'DOMAIN',
    );
  });
  it('RLS y los repositorios aíslan configuraciones y perfiles incluso para el mismo contacto', async () => {
    const visible = await browsers[1]
      .from('style_profiles')
      .select('scope_kind');
    expect(visible.error).toBeNull();
    expect(visible.data).toEqual([{ scope_kind: 'GENERAL' }]);
    expect(
      (await select('alice@company.invalid', undefined, 1))?.scope_kind,
    ).toBe('GENERAL');
    const wrong = createStyleRelationshipRepository(
      service,
      owners[0].id,
      owners[1].accountId,
    );
    await expect(
      wrong.set({
        kind: 'RECIPIENT',
        key: 'alice@company.invalid',
        category: 'CLIENT',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createWritingProfileRepository(
        service,
        owners[0].id,
        owners[1].accountId,
        contact,
      ).get(),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const foreign = await browsers[1]
      .from('style_relationships')
      .select('*')
      .eq('user_id', owners[0].id);
    expect(foreign.data).toEqual([]);
  });
  it('regenerar el perfil general deja inactivos los contextos de la revisión antigua', async () => {
    const fresh = await repo().save(generalInput());
    expect(await select('alice@company.invalid')).toBeNull();
    await repo().confirm(fresh.revision);
    expect((await select('alice@company.invalid'))?.scope_kind).toBe('GENERAL');
    await expect(
      repo(contact).save({
        ...(await contextualInput(contact)),
        context: {
          ...(await contextualInput(contact)).context,
          parentRevision: '00000000-0000-4000-8000-000000000099',
        },
      }),
    ).rejects.toMatchObject({ code: 'STALE_REVIEW' });
  });
  it('elimina una cuenta con categorías y perfiles mediante Supabase Auth sin ampliar privilegios', async () => {
    await relationships().set({
      kind: 'DOMAIN',
      key: 'cleanup.invalid',
      category: 'OTHER',
    });
    expect(
      (await service.auth.admin.deleteUser(owners[0].id)).error,
    ).toBeNull();
    deletedUsers.add(owners[0].id);
    expect(
      (
        await service
          .from('style_profiles')
          .select('id')
          .eq('user_id', owners[0].id)
      ).data,
    ).toEqual([]);
    expect(
      (
        await service
          .from('style_relationships')
          .select('match_key')
          .eq('user_id', owners[0].id)
      ).data,
    ).toEqual([]);
  });
});
