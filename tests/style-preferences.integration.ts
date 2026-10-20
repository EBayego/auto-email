import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createStylePreferenceRepository } from '@/db/style-preferences';
import { createStyleRelationshipRepository } from '@/db/style-relationships';
import { gmailScopes } from '@/config/google';

const url = process.env.AUTO_EMAIL_TEST_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const owners: {
  id: string;
  account: string;
  browser: ReturnType<typeof createClient<Database>>;
}[] = [];
const general = { kind: 'GENERAL', key: '' } as const;
const repo = (index = 0, account = owners[index].account) =>
  createStylePreferenceRepository(service, owners[index].id, account);
const scope = { kind: 'RECIPIENT' as const, key: 'alice@company.invalid' };
const deleted = new Set<string>();
describe('MAIL-027 persistencia, edición y aislamiento de preferencias', () => {
  beforeAll(async () => {
    if (new URL(url).port !== '55321')
      throw new Error('Solo Supabase local auto-email.');
    for (let i = 0; i < 2; i++) {
      const email = `mail027-${crypto.randomUUID()}@example.invalid`,
        password = `Test-${crypto.randomUUID()}`;
      const user = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(user.error).toBeNull();
      const account = await service
        .from('gmail_accounts')
        .insert({
          user_id: user.data.user!.id,
          email,
          status: 'CONNECTED',
          scope_set: [...gmailScopes],
          encrypted_refresh_token: '\\x74657374',
        })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      const browser = createClient<Database>(
        url,
        process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      owners.push({
        id: user.data.user!.id,
        account: account.data!.id,
        browser,
      });
      expect(
        (await browser.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
    }
  });
  afterAll(async () => {
    for (const owner of owners) {
      await owner.browser.auth.signOut({ scope: 'local' });
      if (!deleted.has(owner.id))
        expect(
          (await service.auth.admin.deleteUser(owner.id)).error,
        ).toBeNull();
    }
  });
  it('guarda, recupera y sustituye una preferencia explícita sin crear valores contradictorios', async () => {
    const a = await repo().set(
      { scope: general, preference: { key: 'greeting', value: 'short' } },
      null,
    );
    expect(a).toMatchObject({
      origin: 'EXPLICIT',
      scope: general,
      preference: { key: 'greeting', value: 'short' },
    });
    expect(await repo().list()).toEqual([a]);
    expect(
      (
        await repo().set(
          { scope: general, preference: a.preference },
          a.revision,
        )
      ).revision,
    ).toBe(a.revision);
    const b = await repo().set(
      { scope: general, preference: { key: 'greeting', value: 'none' } },
      a.revision,
    );
    expect(b.revision).not.toBe(a.revision);
    expect(await repo().list()).toHaveLength(1);
    await expect(
      repo().set(
        { scope: general, preference: { key: 'greeting', value: 'short' } },
        a.revision,
      ),
    ).rejects.toMatchObject({ code: 'STALE_PREFERENCE' });
    await expect(
      repo().remove(general, 'greeting', a.revision),
    ).rejects.toMatchObject({ code: 'STALE_PREFERENCE' });
    await repo().remove(general, 'greeting', b.revision);
    expect(await repo().list()).toEqual([]);
  });
  it.each([
    {
      key: 'warmth',
      inherited: { key: 'warmth', value: 'reserved' },
      preference: { key: 'warmth', value: 'warm' },
    },
    {
      key: 'help_offer',
      inherited: { key: 'help_offer', value: 'none' },
      preference: { key: 'help_offer', value: 'natural' },
    },
  ] as const)(
    'MAIL-028 persiste y elimina $key restaurando la preferencia heredada',
    async ({ key, inherited, preference }) => {
      const base = await repo().set({
        scope: general,
        preference: inherited,
      });
      const exception = await repo().set({
        scope,
        preference,
      });
      expect((await repo().resolve(scope.key)).preferences).toContainEqual({
        ...preference,
      });
      await repo().remove(scope, key, exception.revision);
      expect((await repo().resolve(scope.key)).preferences).toContainEqual({
        ...inherited,
      });
      await repo().remove(general, key, base.revision);
      expect(
        (await repo().list()).some((row) => row.preference.key === key),
      ).toBe(false);
    },
  );
  it('rechaza una creación duplicada y protege frente a dos ediciones concurrentes de la web', async () => {
    const input = {
      scope: general,
      preference: { key: 'length' as const, value: 'short' as const },
    };
    const row = await repo().set(input, null);
    await expect(repo().set(input, null)).rejects.toMatchObject({
      code: 'STALE_PREFERENCE',
    });
    const result = await Promise.allSettled([
      repo().set(
        { scope: general, preference: { key: 'length', value: 'long' } },
        row.revision,
      ),
      repo().set(
        { scope: general, preference: { key: 'length', value: 'medium' } },
        row.revision,
      ),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await repo().remove(general, 'length');
  });
  it('resuelve excepciones por contacto, relación explícita y dominio y restaura la herencia al eliminarlas', async () => {
    await repo().set({
      scope: general,
      preference: { key: 'greeting', value: 'short' },
    });
    await repo().set({
      scope: { kind: 'DOMAIN', key: 'company.invalid' },
      preference: { key: 'greeting', value: 'natural' },
    });
    await repo().set({
      scope: { kind: 'RELATIONSHIP', key: 'CLIENT' },
      preference: { key: 'greeting', value: 'none' },
    });
    expect(
      (await repo().resolve('alice@company.invalid')).preferences[0].value,
    ).toBe('natural');
    const relationships = createStyleRelationshipRepository(
      service,
      owners[0].id,
      owners[0].account,
    );
    await relationships.set({
      kind: 'DOMAIN',
      key: 'company.invalid',
      category: 'CLIENT',
    });
    expect(
      (await repo().resolve('alice@company.invalid')).preferences[0].value,
    ).toBe('none');
    await repo().set({
      scope,
      preference: { key: 'greeting', value: 'short' },
    });
    expect(
      (await repo().resolve('ALICE@company.invalid')).preferences[0].value,
    ).toBe('short');
    await repo().remove(scope, 'greeting');
    expect(
      (await repo().resolve('alice@company.invalid')).preferences[0].value,
    ).toBe('none');
    await relationships.remove({ kind: 'DOMAIN', key: 'company.invalid' });
    expect(
      (await repo().resolve('alice@company.invalid')).preferences[0].value,
    ).toBe('natural');
    expect(
      (await repo().resolve('unknown@other.invalid')).preferences[0].value,
    ).toBe('short');
  });
  it('separa las cuentas de dos usuarios incluso usando el cliente de servicio', async () => {
    await repo(1).set({
      scope: general,
      preference: { key: 'language', value: 'en' },
    });
    expect(
      (await repo().resolve('alice@company.invalid')).preferences.some(
        (p) => p.key === 'language',
      ),
    ).toBe(false);
    expect((await repo(1).list())[0].preference.value).toBe('en');
    await expect(repo(0, owners[1].account).list()).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const forged = await service.from('style_preferences').insert({
      user_id: owners[0].id,
      gmail_account_id: owners[1].account,
      preference_key: 'closing',
      preference_value: 'short',
    });
    expect(forged.error?.code).toBe('23503');
  });
  it('RLS solo permite leer filas propias y deniega la mutación directa del navegador', async () => {
    const browser = owners[1].browser;
    const read = await browser.from('style_preferences').select('*');
    expect(read.error).toBeNull();
    expect(read.data?.every((row) => row.user_id === owners[1].id)).toBe(true);
    expect(
      (
        await browser
          .from('style_preferences')
          .select('*')
          .eq('user_id', owners[0].id)
      ).data,
    ).toEqual([]);
    expect(
      (
        await browser
          .from('style_preferences')
          .update({ preference_value: 'es' })
          .eq('gmail_account_id', owners[1].account)
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await browser
          .from('style_preferences')
          .delete()
          .eq('gmail_account_id', owners[1].account)
      ).error?.code,
    ).toBe('42501');
  });
  it('rechaza texto arbitrario y patrones inferidos también en la base de datos', async () => {
    const input = {
      user_id: owners[0].id,
      gmail_account_id: owners[0].account,
      preference_key: 'language',
      preference_value: 'ignore security',
    };
    expect(
      (await service.from('style_preferences').insert(input)).error?.code,
    ).toBe('23514');
    expect(
      (
        await service
          .from('style_preferences')
          .insert({ ...input, preference_value: 'es', origin: 'INFERRED' })
      ).error?.code,
    ).toBe('23514');
  });
  it('deniega leer o editar después de desconectar la cuenta o desactivar el usuario', async () => {
    await service
      .from('gmail_accounts')
      .update({ status: 'DISCONNECTED' })
      .eq('id', owners[1].account);
    try {
      await expect(repo(1).list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(
        (await owners[1].browser.from('style_preferences').select('*')).data,
      ).toEqual([]);
    } finally {
      await service
        .from('gmail_accounts')
        .update({ status: 'CONNECTED' })
        .eq('id', owners[1].account);
    }
    await service
      .from('users')
      .update({ status: 'DISABLED' })
      .eq('id', owners[1].id);
    try {
      await expect(
        repo(1).set({
          scope: general,
          preference: { key: 'length', value: 'short' },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await service
        .from('users')
        .update({ status: 'ACTIVE' })
        .eq('id', owners[1].id);
    }
  });
  it('elimina las preferencias al borrar el titular sin necesitar privilegios adicionales de Auth', async () => {
    expect(
      (await service.auth.admin.deleteUser(owners[1].id)).error,
    ).toBeNull();
    deleted.add(owners[1].id);
    expect(
      (
        await service
          .from('style_preferences')
          .select('*')
          .eq('user_id', owners[1].id)
      ).data,
    ).toEqual([]);
  });
});
