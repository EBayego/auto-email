import { createAuthorizedTestUser } from './fixtures/privacy';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import { gmailScopes } from '@/config/google';
import { createAutomationSettingsRepository } from '@/db/automation-settings';
import { defaultResponsePolicySettings } from '@/modules/policy/settings';
import type {
  AutomationSnapshot,
  AutomationSettings,
} from '@/modules/workflow/automation-settings';
import { createAccountEmailClassifier } from '@/worker/email-classifier';
import { inspectAutomationSelection } from '@/worker/automation-selection';
import { createKnowledgeSources } from '@/db/knowledge-sources';
import { createKnowledgeDocuments } from '@/db/knowledge-documents';
import {
  createExecutionControlRepository,
  assertExecutionAllowed,
} from '@/db/execution-controls';
import {
  classifierMessage,
  classifierMetadata,
} from './fixtures/classifier-emails';
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
const cookies = (index = 0) =>
  [...owners[index].jar].map(([key, value]) => `${key}=${value}`).join('; ');
async function state(index = 0): Promise<AutomationSnapshot> {
  const response = await fetch(`${origin}/api/automation/settings`, {
    headers: { cookie: cookies(index) },
  });
  expect(response.status).toBe(200);
  return response.json();
}
async function save(
  settings: AutomationSettings,
  old?: AutomationSnapshot,
  index = 0,
) {
  return fetch(`${origin}/api/automation/settings`, {
    method: 'PUT',
    headers: {
      origin,
      cookie: cookies(index),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      revision: (old ?? (await state(index))).revision,
      settings,
    }),
  });
}
const repo = (index = 0) =>
  createAutomationSettingsRepository(service, owners[index].id);
const sources = () => createKnowledgeSources(service, owners[0].id);
function classifier(labels = ['INBOX', 'UNREAD']) {
  const message = classifierMessage({ to: owners[0].email, labels });
  const getMessage = vi.fn(
    async (_id: string, options?: { format?: string }) =>
      options?.format === 'metadata' ? classifierMetadata(message) : message,
  );
  const generate = vi.fn(async () => ({
    text: JSON.stringify({
      decision: 'REPLY_REQUIRED',
      intent: 'REQUEST_INFORMATION',
      reasons: ['EXPLICIT_QUESTION'],
      riskFlags: [],
      needsAttachment: false,
      confidence: 'HIGH',
    }),
    inputTokens: 10,
    outputTokens: 10,
  }));
  const work = { userId: owners[0].id, gmailAccountId: owners[0].accountId };
  return {
    message,
    getMessage,
    generate,
    work,
    build: () =>
      createAccountEmailClassifier({
        client: service,
        work,
        gmail: { getMessage },
        text: { generate },
      }),
  };
}
describe('MAIL-053 configuración web aplicada por el worker', () => {
  beforeAll(async () => {
    if (new URL(url).origin !== 'http://127.0.0.1:55321')
      throw new Error('Solo Supabase local');
    for (let index = 0; index < 2; index++) {
      const email = `mail053-${crypto.randomUUID()}@example.invalid`,
        password = `Test-${crypto.randomUUID()}`;
      const result = await createAuthorizedTestUser(service, {
        email,
        password,
        email_confirm: true,
      });
      expect(result.error).toBeNull();
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
        id: result.data.user!.id,
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
          user_id: owners[index].id,
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
    for (let index = 0; index < owners.length; index++) {
      const snapshot = await repo(index).get();
      await repo(index).set({
        ...snapshot,
        settings: {
          execution: {
            automationEnabled: false,
            pollIntervalSeconds: 300,
            maxDailyDrafts: 30,
          },
          processingScope: 'ALL_INCOMING',
          excludedAddresses: [],
          excludedDomains: [],
          policy: defaultResponsePolicySettings(),
        },
      });
    }
  });
  afterAll(async () => {
    for (const owner of owners) {
      for (const document of await createKnowledgeDocuments(
        service,
        owner.id,
      ).list())
        await createKnowledgeDocuments(service, owner.id).remove(document.id);
      expect(
        (await service.from('source_rules').delete().eq('user_id', owner.id))
          .error,
      ).toBeNull();
      await owner.client.auth.signOut({ scope: 'local' });
      expect((await service.auth.admin.deleteUser(owner.id)).error).toBeNull();
    }
  });
  it('protege la sesión y aísla los ajustes entre usuarios', async () => {
    expect((await fetch(`${origin}/api/automation/settings`)).status).toBe(401);
    const other = await state(1);
    expect(
      (
        await save(
          { ...other.settings, excludedDomains: ['other.invalid'] },
          other,
          1,
        )
      ).status,
    ).toBe(200);
    expect((await state()).settings.excludedDomains).toEqual([]);
    expect(
      (
        await owners[1].client.rpc('get_automation_configuration', {
          p_user_id: owners[0].id,
        })
      ).error?.code,
    ).toBe('42501');
    const response = await fetch(`${origin}/settings`, {
      headers: { cookie: cookies() },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const html = await response.text();
    expect(html).toContain('Qué correos puede procesar');
    expect(html).not.toContain(owners[1].email);
    expect(html).not.toContain('encrypted_refresh_token');
  });
  it('una selección guardada se aplica sin recrear el clasificador y evita leer el cuerpo', async () => {
    const f = classifier(['INBOX']);
    const worker = await f.build();
    const old = await state();
    expect(
      (await save({ ...old.settings, processingScope: 'UNREAD_INBOX' })).status,
    ).toBe(200);
    expect(await worker.classify(f.message.id)).toMatchObject({
      decision: 'NO_REPLY',
      reasons: ['OUTSIDE_SELECTION'],
      modelCalls: 0,
    });
    expect(f.getMessage).toHaveBeenCalledTimes(1);
    expect(f.generate).not.toHaveBeenCalled();
    expect(
      (await save({ ...old.settings, processingScope: 'INBOX' })).status,
    ).toBe(200);
    expect(await worker.classify(f.message.id)).toMatchObject({
      decision: 'REPLY_REQUIRED',
    });
  });
  it('las exclusiones se normalizan y evitan analizar remitentes excluidos', async () => {
    const f = classifier();
    const old = await state();
    expect(
      (await save({ ...old.settings, excludedDomains: ['EXAMPLE.invalid'] }))
        .status,
    ).toBe(200);
    expect((await state()).settings.excludedDomains).toEqual([
      'example.invalid',
    ]);
    expect(await (await f.build()).classify(f.message.id)).toMatchObject({
      decision: 'NO_REPLY',
      reasons: ['EXCLUDED_DOMAIN'],
    });
    expect(f.generate).not.toHaveBeenCalled();
  });
  it('los tipos no permitidos no pasan de clasificación a generación', async () => {
    const f = classifier();
    const old = await state();
    expect(
      (
        await save({
          ...old.settings,
          policy: {
            ...old.settings.policy,
            blockedCategories: ['REQUEST_INFORMATION'],
          },
        })
      ).status,
    ).toBe(200);
    expect(await (await f.build()).classify(f.message.id)).toMatchObject({
      decision: 'NO_REPLY',
      intent: 'REQUEST_INFORMATION',
      reasons: ['CATEGORY_EXCLUDED'],
    });
  });
  it('vuelve a comprobar selección y exclusiones para mensajes ya clasificados', async () => {
    const f = classifier(['INBOX']);
    const old = await state();
    const inspect = () =>
      inspectAutomationSelection({
        client: service,
        work: f.work,
        gmail: { getMessage: f.getMessage },
        messageId: f.message.id,
      });
    expect((await inspect()).reason).toBeNull();
    expect(
      (await save({ ...old.settings, processingScope: 'UNREAD_INBOX' })).status,
    ).toBe(200);
    expect((await inspect()).reason).toBe('OUTSIDE_SELECTION');
    expect(
      (
        await save({
          ...old.settings,
          excludedAddresses: ['contact@example.invalid'],
        })
      ).status,
    ).toBe(200);
    expect((await inspect()).reason).toBe('EXCLUDED_SENDER');
  });
  it('la pausa guardada desactiva el worker y retira la revisión manual pendiente', async () => {
    const old = await state();
    expect(
      (
        await save({
          ...old.settings,
          execution: { ...old.settings.execution, automationEnabled: true },
        })
      ).status,
    ).toBe(200);
    const controls = createExecutionControlRepository(service, owners[0].id);
    await controls.account('run');
    await assertExecutionAllowed(service, {
      userId: owners[0].id,
      gmailAccountId: owners[0].accountId,
    });
    expect((await save(old.settings)).status).toBe(200);
    await expect(
      assertExecutionAllowed(service, {
        userId: owners[0].id,
        gmailAccountId: owners[0].accountId,
      }),
    ).rejects.toThrow('FORBIDDEN');
    expect(
      (
        await service
          .from('gmail_accounts')
          .select('manual_processing_until')
          .eq('id', owners[0].accountId)
          .single()
      ).data?.manual_processing_until,
    ).toBeNull();
  });
  it('rechaza una copia antigua sin perder las preferencias nuevas', async () => {
    const old = await state();
    expect(
      (
        await save(
          { ...old.settings, excludedDomains: ['latest.invalid'] },
          old,
        )
      ).status,
    ).toBe(200);
    const response = await save(old.settings, old);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'SETTINGS_CHANGED' });
    expect((await state()).settings.excludedDomains).toEqual([
      'latest.invalid',
    ]);
  });
  it('un ajuste inválido no modifica el resto de la configuración', async () => {
    const old = await state();
    expect(
      (
        await save({
          ...old.settings,
          excludedDomains: ['https://invalid'],
          policy: { ...old.settings.policy, blockedTopics: ['descuentos'] },
        })
      ).status,
    ).toBe(400);
    expect(await state()).toEqual(old);
    const response = await save({
      ...old.settings,
      policy: {
        ...old.settings.policy,
        sourceRequirements: [
          { kind: 'PRICE', sourceIds: [crypto.randomUUID()] },
        ],
      },
    });
    expect(response.status).toBe(400);
    expect(await state()).toEqual(old);
  });
  it('permite subir, asignar y eliminar un documento y revocar el acceso a su fuente', async () => {
    const headers = {
      origin,
      cookie: cookies(),
      'content-type': 'application/json',
    };
    const create = await fetch(`${origin}/api/knowledge/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'save_source',
        title: 'Horario MAIL-053',
        priority: 0,
        enabled: true,
      }),
    });
    expect(create.status).toBe(200);
    const { id: sourceId } = await create.json();
    const form = new FormData();
    form.set(
      'file',
      new File(
        ['El horario de atención es de 09:00 a 17:00 de lunes a viernes.'],
        'mail053-horario.txt',
        { type: 'text/plain' },
      ),
    );
    const upload = await fetch(`${origin}/api/knowledge/documents`, {
      method: 'POST',
      headers: { origin, cookie: cookies() },
      body: form,
    });
    expect(upload.status).toBe(201);
    const { document } = await upload.json();
    for (const operation of [
      { action: 'assign_document', documentId: document.id, sourceId },
      {
        action: 'save_rule',
        title: 'Horario',
        intent: 'REQUEST_INFORMATION',
        terms: [],
        priority: 0,
        enabled: true,
        allowEmailHistory: false,
        primarySourceIds: [sourceId],
        fallbackSourceIds: [],
        excludedSourceIds: [],
      },
    ])
      expect(
        (
          await fetch(`${origin}/api/knowledge/sources`, {
            method: 'POST',
            headers,
            body: JSON.stringify(operation),
          })
        ).status,
      ).toBe(200);
    expect(
      (
        await sources().plan({
          query: 'horario',
          intent: 'REQUEST_INFORMATION',
        })
      ).primarySources.map((item) => item.id),
    ).toContain(sourceId);
    const old = await state();
    expect(
      (
        await save({
          ...old.settings,
          policy: {
            ...old.settings.policy,
            sourceRequirements: [{ kind: 'HOURS', sourceIds: [sourceId] }],
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${origin}/api/knowledge/sources`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: 'save_source',
            id: sourceId,
            title: 'Horario MAIL-053',
            priority: 0,
            enabled: false,
          }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await sources().plan({
          query: 'horario',
          intent: 'REQUEST_INFORMATION',
        })
      ).primarySources,
    ).toEqual([]);
    expect(
      (
        await fetch(`${origin}/api/knowledge/documents/${document.id}`, {
          method: 'DELETE',
          headers: { origin, cookie: cookies() },
        })
      ).status,
    ).toBe(204);
    expect(
      (await createKnowledgeDocuments(service, owners[0].id).list()).some(
        (item) => item.id === document.id,
      ),
    ).toBe(false);
  });
});
