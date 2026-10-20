import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createWritingProfileRepository } from '@/db/writing-profiles';
import { gmailScopes } from '@/config/google';
import {
  legacyWritingProfileFixture,
  writingProfileFixture,
} from './fixtures/writing-profile';

const url = process.env.AUTO_EMAIL_TEST_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const owners: { id: string; accountId: string }[] = [];
const browsers: ReturnType<typeof createClient<Database>>[] = [];
const repository = (index = 0) =>
  createWritingProfileRepository(
    service,
    owners[index].id,
    owners[index].accountId,
  );
const generation = () => ({
  profile: writingProfileFixture(),
  model: 'test-model',
  sampleSize: 1,
  inputTokens: 10,
  outputTokens: 10,
  warnings: [] as const,
  sourceMessageIds: ['sent0'],
});

describe('MAIL-024, perfiles versionados con Supabase real y dos propietarios', () => {
  beforeAll(async () => {
    if (new URL(url).port !== '55321')
      throw new Error('Solo base temporal local.');
    for (let i = 0; i < 2; i++) {
      const email = `mail024-${crypto.randomUUID()}@example.invalid`;
      const password = `Test-${crypto.randomUUID()}`;
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
          user_id: user.data.user!.id,
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
    }
  });
  afterAll(async () => {
    for (const browser of browsers)
      await browser.auth.signOut({ scope: 'local' });
    for (const owner of owners)
      expect((await service.auth.admin.deleteUser(owner.id)).error).toBeNull();
  });

  it('serializa y recupera el esquema completo con versión, origen y timestamps', async () => {
    for (let i = 0; i < 2; i++) {
      const saved = await repository(i).save(generation());
      expect(saved).toMatchObject({
        version: 1,
        origin: 'SENT_HISTORY',
        source_message_ids: ['sent0'],
        prompt_version: 'mail024-v2',
        profile: writingProfileFixture(),
        review_status: 'UNREVIEWED',
      });
      expect(Date.parse(saved.created_at)).not.toBeNaN();
      expect(Date.parse(saved.updated_at)).not.toBeNaN();
      expect(await repository(i).get()).toEqual(saved);
    }
  });
  it('asigna versiones consecutivas a dos escrituras simultáneas y rechaza una confirmación obsoleta', async () => {
    const initial = (await repository().get())!;
    const saved = await Promise.all([
      repository().save(generation()),
      repository().save(generation()),
    ]);
    expect(saved.map((row) => row.version).sort()).toEqual([2, 3]);
    const current = (await repository().get())!;
    expect(current.version).toBe(3);
    expect(current.created_at).toBe(initial.created_at);
    await expect(repository().confirm(initial.revision)).rejects.toMatchObject({
      code: 'STALE_REVIEW',
    });
    const confirmed = await repository().confirm(current.revision);
    expect(confirmed).toMatchObject({
      version: 3,
      revision: current.revision,
      review_status: 'CONFIRMED',
    });
    expect(confirmed.reviewed_at).not.toBeNull();
    const regenerated = await repository().save(generation());
    expect(regenerated).toMatchObject({
      version: 4,
      review_status: 'UNREVIEWED',
      reviewed_at: null,
    });
    expect(regenerated.revision).not.toBe(current.revision);
  });
  it('RLS y el repositorio impiden leer, confirmar o sobrescribir perfiles ajenos', async () => {
    for (let i = 0; i < 2; i++) {
      const visible = await browsers[i]
        .from('style_profiles')
        .select('user_id,version,origin');
      expect(visible.error).toBeNull();
      expect(visible.data).toHaveLength(1);
      expect(visible.data![0].user_id).toBe(owners[i].id);
      const foreign = await browsers[i]
        .from('style_profiles')
        .select('id')
        .eq('user_id', owners[1 - i].id);
      expect(foreign.data).toEqual([]);
    }
    const wrong = createWritingProfileRepository(
      service,
      owners[0].id,
      owners[1].accountId,
    );
    await expect(wrong.get()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(wrong.save(generation())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      wrong.confirm((await repository(1).get())!.revision),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const attempt = await browsers[0]
      .from('style_profiles')
      .update({ version: 99 })
      .eq('user_id', owners[1].id);
    expect(attempt.error?.code).toBe('42501');
    expect((await repository(1).get())!.version).toBe(1);
  });
  it('conserva un perfil legado y lo sustituye por v2 al regenerar con una muestra trazable', async () => {
    expect(
      (
        await service
          .from('style_profiles')
          .delete()
          .eq('user_id', owners[0].id)
      ).error,
    ).toBeNull();
    const inserted = await service.from('style_profiles').insert({
      user_id: owners[0].id,
      gmail_account_id: owners[0].accountId,
      profile: legacyWritingProfileFixture(),
      model: 'test-model',
      prompt_version: 'mail018-v1',
      sample_size: 1,
      input_tokens: 10,
      output_tokens: 10,
    });
    expect(inserted.error).toBeNull();
    const legacy = (await repository().get())!;
    expect(legacy.profile).toEqual(legacyWritingProfileFixture());
    expect(legacy.source_message_ids).toEqual([]);
    expect(await repository().save(generation())).toMatchObject({
      version: 2,
      profile: writingProfileFixture(),
      source_message_ids: ['sent0'],
    });
  });
  it('desconectar o deshabilitar el propietario impide reutilizar el perfil', async () => {
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ status: 'DISCONNECTED' })
          .eq('id', owners[0].accountId)
      ).error,
    ).toBeNull();
    await expect(repository().get()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      (await browsers[0].from('style_profiles').select('id')).data,
    ).toEqual([]);
    expect(
      (
        await service
          .from('users')
          .update({ status: 'DISABLED' })
          .eq('id', owners[1].id)
      ).error,
    ).toBeNull();
    await expect(repository(1).save(generation())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      (await browsers[1].from('style_profiles').select('id')).data,
    ).toEqual([]);
  });
});
