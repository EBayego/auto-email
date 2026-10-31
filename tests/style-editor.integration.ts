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
import { createWritingProfileRepository } from '@/db/writing-profiles';
import { createStylePreferenceRepository } from '@/db/style-preferences';
import { createStyleRelationshipRepository } from '@/db/style-relationships';
import { selectContextualWritingProfile } from '@/db/contextual-styles';
import { createResponseGenerator } from '@/modules/response/generator';
import {
  parseEditorInstructions,
  scopeIdentity,
  type StyleEditorSnapshot,
} from '@/modules/identity/style-editor';
import type { StyleScope } from '@/modules/identity/contextual-style';
import type { StylePreference } from '@/modules/identity/style-preferences';
import { gmailScopes } from '@/config/google';
import { writingProfileFixture } from './fixtures/writing-profile';
import {
  responseInput,
  readyResponse,
  supportedResponse,
} from './fixtures/responses';

const url = process.env.AUTO_EMAIL_TEST_URL!,
  origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const owners: {
  id: string;
  accountId: string;
  email: string;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
}[] = [];
const general = { kind: 'GENERAL', key: '' } as const;
const category = { kind: 'RELATIONSHIP', key: 'CLIENT' } as const;
const generation = () => ({
  profile: writingProfileFixture(),
  model: 'test-model',
  sampleSize: 1,
  sourceMessageIds: ['style52'],
  inputTokens: 10,
  outputTokens: 10,
  warnings: [],
});
const profile = (index = 0, scope: StyleScope = general) =>
  createWritingProfileRepository(
    service,
    owners[index].id,
    owners[index].accountId,
    scope,
  );
const cookies = (index = 0) =>
  [...owners[index].jar].map(([name, value]) => `${name}=${value}`).join('; ');
async function snapshot(index = 0): Promise<StyleEditorSnapshot> {
  const response = await fetch(`${origin}/api/style`, {
    headers: { cookie: cookies(index) },
  });
  expect(response.status).toBe(200);
  return (await response.json()).style;
}
const body = (snapshot: StyleEditorSnapshot, scope: StyleScope = general) => ({
  scope,
  generalRevision: snapshot.generalRevision,
  profileRevision:
    snapshot.profiles.find(
      (view) => scopeIdentity(view.scope) === scopeIdentity(scope),
    )?.revision ?? null,
  expectedRevisions: snapshot.preferences
    .filter((row) => scopeIdentity(row.scope) === scopeIdentity(scope))
    .map((row) => row.revision),
});
const put = (body: unknown, index = 0) =>
  fetch(`${origin}/api/style`, {
    method: 'PUT',
    headers: {
      origin,
      cookie: cookies(index),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
async function save(
  preferences: StylePreference[],
  scope: StyleScope = general,
  stale?: StyleEditorSnapshot,
) {
  return put({
    action: 'save',
    ...body(stale ?? (await snapshot()), scope),
    preferences,
  });
}
async function confirm(scope: StyleScope = general) {
  return put({
    action: 'confirm',
    ...body(await snapshot(), scope),
    reviewed: true,
  });
}
const repo = () =>
  createStylePreferenceRepository(service, owners[0].id, owners[0].accountId);
async function contextual() {
  expect((await confirm()).status).toBe(200);
  const rules = createStyleRelationshipRepository(
    service,
    owners[0].id,
    owners[0].accountId,
  );
  await rules.set({
    kind: 'DOMAIN',
    key: 'company.invalid',
    category: 'CLIENT',
  });
  const revisions = (await rules.list()).map((rule) => rule.revision);
  const parent = (await profile().get())!;
  return createWritingProfileRepository(
    service,
    owners[0].id,
    owners[0].accountId,
    category,
  ).save({
    ...generation(),
    profile: {
      ...writingProfileFixture(),
      formality: 'high',
      average_length: 'long',
    },
    sampleSize: 10,
    sourceMessageIds: Array.from(
      { length: 10 },
      (_, index) => `context52_${index}`,
    ),
    context: {
      parentRevision: parent.revision,
      evidence: { threads: 4, days: 3, words: 200, recipients: 3 },
      ruleRevisions: revisions,
    },
  });
}
describe('MAIL-052 editor de escritura y aplicación real de sus preferencias', () => {
  beforeAll(async () => {
    if (new URL(url).origin !== 'http://127.0.0.1:55321')
      throw new Error('Solo Supabase local');
    for (let index = 0; index < 2; index++) {
      const email = `mail052-${crypto.randomUUID()}@example.invalid`,
        password = `Test-${crypto.randomUUID()}`;
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
      owners.push({
        id: created.data.user!.id,
        accountId: '',
        email,
        jar,
        client,
      });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      const account = await service
        .from('gmail_accounts')
        .insert({
          user_id: created.data.user!.id,
          email,
          status: 'CONNECTED',
          encrypted_refresh_token: '\\x74657374',
          scope_set: [...gmailScopes],
        })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      owners[index].accountId = account.data!.id;
    }
  });
  beforeEach(async () => {
    for (const owner of owners) {
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
            .update({ status: 'CONNECTED' })
            .eq('user_id', owner.id)
        ).error,
      ).toBeNull();
      for (const table of [
        'style_preferences',
        'style_profiles',
        'style_relationships',
      ] as const)
        expect(
          (await service.from(table).delete().eq('user_id', owner.id)).error,
        ).toBeNull();
      await createWritingProfileRepository(
        service,
        owner.id,
        owner.accountId,
      ).save(generation());
    }
  });
  afterAll(async () => {
    for (const owner of owners) {
      await owner.client.auth.signOut({ scope: 'local' });
      expect((await service.auth.admin.deleteUser(owner.id)).error).toBeNull();
    }
  });
  it('protege la sesión y evita exponer referencias o datos de otro usuario', async () => {
    expect((await fetch(`${origin}/api/style`)).status).toBe(401);
    const own = await snapshot();
    const other = await snapshot(1);
    expect(own.generalRevision).not.toBe(other.generalRevision);
    expect(JSON.stringify(own)).not.toMatch(
      /source_message_ids|encrypted_refresh_token|input_tokens|output_tokens/,
    );
    const response = await fetch(`${origin}/style`, {
      headers: { cookie: cookies() },
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).not.toContain(owners[1].email);
    expect(
      (
        await owners[1].client.rpc('edit_writing_style', {
          p_user_id: owners[0].id,
          p_account_id: owners[0].accountId,
          p_general_revision: own.generalRevision,
          p_scope_kind: 'GENERAL',
          p_scope_key: '',
        })
      ).error?.code,
    ).toBe('42501');
  });
  it('guardar no confirma el perfil; la revisión explícita sí lo habilita para el worker', async () => {
    expect((await save([{ key: 'length', value: 'long' }])).status).toBe(200);
    expect((await profile().get())?.review_status).toBe('UNREVIEWED');
    expect(
      await selectContextualWritingProfile(
        service,
        owners[0].id,
        owners[0].accountId,
        'contact@company.invalid',
      ),
    ).toBeNull();
    expect((await confirm()).status).toBe(200);
    expect(
      (
        await selectContextualWritingProfile(
          service,
          owners[0].id,
          owners[0].accountId,
          'contact@company.invalid',
        )
      )?.review_status,
    ).toBe('CONFIRMED');
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
  it('las instrucciones guardadas en la web llegan a las siguientes llamadas del generador y del verificador', async () => {
    expect((await confirm()).status).toBe(200);
    const before = await repo().resolve('contact@company.invalid');
    expect(before.preferences).toEqual([]);
    const preferences = parseEditorInstructions(
      'Usa un tono formal. Respuestas detalladas. Sin saludo ni despedida. Sin emojis.',
    );
    expect((await save(preferences)).status).toBe(200);
    const after = await repo().resolve('contact@company.invalid');
    expect(after.preferences).toEqual(preferences);
    const selected = (await selectContextualWritingProfile(
      service,
      owners[0].id,
      owners[0].accountId,
      'contact@company.invalid',
    ))!;
    const api = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          text: JSON.stringify({
            ...readyResponse(),
            bodyText: 'Confirmo que he recibido tu mensaje.',
          }),
          inputTokens: 100,
          outputTokens: 30,
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(supportedResponse()),
          inputTokens: 50,
          outputTokens: 10,
        }),
    };
    const input = responseInput();
    input.conversation.style = selected.profile;
    const result = await createResponseGenerator(api).generate({
      ...input,
      stylePreferences: after.preferences,
    });
    expect(result.status).toBe('READY');
    for (const [request] of api.generate.mock.calls) {
      const payload = JSON.parse(request.input);
      expect(payload.stylePreferences).toEqual(preferences);
      expect(payload.userInstructions).toContain('No uses saludo.');
      expect(payload.userInstructions).toContain(
        'Usa una respuesta detallada.',
      );
    }
    expect((await snapshot()).preferences.map((row) => row.preference)).toEqual(
      preferences,
    );
    expect((await profile().get())?.profile.average_length).toBe('short');
  });
  it('restaura únicamente el ámbito seleccionado y conserva los ajustes por destinatario', async () => {
    expect((await save([{ key: 'length', value: 'long' }])).status).toBe(200);
    const contact = {
      kind: 'RECIPIENT',
      key: 'contact@company.invalid',
    } as const;
    expect(
      (await save([{ key: 'greeting', value: 'none' }], contact)).status,
    ).toBe(200);
    const response = await put({
      action: 'restore',
      ...body(await snapshot()),
    });
    expect(response.status).toBe(200);
    expect((await snapshot()).preferences).toHaveLength(1);
    expect(
      (await repo().resolve('contact@company.invalid')).preferences,
    ).toEqual([{ key: 'greeting', value: 'none' }]);
    expect((await profile().get())?.profile).toEqual(writingProfileFixture());
  });
  it('un segundo editor con una copia antigua no pisa los cambios más recientes', async () => {
    const old = await snapshot();
    expect(
      (await save([{ key: 'length', value: 'long' }], general, old)).status,
    ).toBe(200);
    const response = await save(
      [{ key: 'greeting', value: 'none' }],
      general,
      old,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'STALE_PREFERENCE' });
    expect((await repo().list()).map((row) => row.preference)).toEqual([
      { key: 'length', value: 'long' },
    ]);
    const restore = await put({ action: 'restore', ...body(old) });
    expect(restore.status).toBe(409);
  });
  it('no confirma ni modifica el perfil si se ha regenerado mientras el usuario lo revisaba', async () => {
    const old = await snapshot();
    await profile().save(generation());
    const response = await put({
      action: 'confirm',
      ...body(old),
      reviewed: true,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'STALE_STYLE' });
    expect((await profile().get())?.review_status).toBe('UNREVIEWED');
  });
  it('un lote mal formado se rechaza por completo sin cambiar los ajustes', async () => {
    expect((await save([{ key: 'length', value: 'long' }])).status).toBe(200);
    const response = await put({
      action: 'save',
      ...body(await snapshot()),
      preferences: [
        { key: 'length', value: 'short' },
        { key: 'emojis', value: 'invalid' },
      ],
    });
    expect(response.status).toBe(400);
    expect((await repo().list()).map((row) => row.preference)).toEqual([
      { key: 'length', value: 'long' },
    ]);
  });
  it('muestra diferencias contextuales y permite confirmar un perfil vigente', async () => {
    const context = await contextual();
    const state = await snapshot();
    const view = state.profiles.find(
      (view) => view.scope.kind === 'RELATIONSHIP',
    )!;
    expect(view).toMatchObject({
      scope: category,
      current: true,
      reviewed: false,
      profile: { formality: 'high', average_length: 'long' },
    });
    const confirmation = await confirm(category);
    expect(confirmation.status, JSON.stringify(await confirmation.json())).toBe(
      200,
    );
    expect(
      (
        await selectContextualWritingProfile(
          service,
          owners[0].id,
          owners[0].accountId,
          'contact@company.invalid',
        )
      )?.revision,
    ).toBe(context.revision);
    const html = await (
      await fetch(`${origin}/style`, { headers: { cookie: cookies() } })
    ).text();
    expect(html).toContain('Clientes');
    expect(html).toContain('Comparación del estilo general');
  });
  it('no permite confirmar un perfil contextual después de cambiar las relaciones', async () => {
    await contextual();
    const old = await snapshot();
    await createStyleRelationshipRepository(
      service,
      owners[0].id,
      owners[0].accountId,
    ).set({ kind: 'DOMAIN', key: 'company.invalid', category: 'SUPPLIER' });
    const state = await snapshot();
    expect(
      state.profiles.some((view) => view.scope.kind === 'RELATIONSHIP'),
    ).toBe(false);
    const response = await put({
      action: 'confirm',
      ...body(old, category),
      reviewed: true,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'STALE_STYLE' });
  });
  it('la pausa impide guardar incluso con una revisión conocida', async () => {
    const old = await snapshot();
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ status: 'PAUSED' })
          .eq('user_id', owners[0].id)
      ).error,
    ).toBeNull();
    const response = await save(
      [{ key: 'length', value: 'long' }],
      general,
      old,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'NOT_CONNECTED' });
  });
  it('presenta el estado vacío cuando no hay perfil aprendido', async () => {
    expect(
      (
        await service
          .from('style_profiles')
          .delete()
          .eq('user_id', owners[0].id)
      ).error,
    ).toBeNull();
    expect(await snapshot()).toBeNull();
    const html = await (
      await fetch(`${origin}/style`, { headers: { cookie: cookies() } })
    ).text();
    expect(html).toContain('Preparar mi perfil de escritura');
  });
});
