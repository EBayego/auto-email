import { randomBytes, randomUUID } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { SecretValue, type ServerConfig } from '@/config/env';
import { gmailScopes } from '@/config/google';
import { createAuthorizedTestUser } from '../fixtures/privacy';
import { writingProfileFixture } from '../fixtures/writing-profile';
import { createWritingProfileRepository } from '@/db/writing-profiles';
import { createKnowledgeDocuments } from '@/db/knowledge-documents';
import { createKnowledgeSources } from '@/db/knowledge-sources';
import { createStylePreferenceRepository } from '@/db/style-preferences';
import { createResponsePolicyRepository } from '@/db/response-policy';
import { defaultResponsePolicySettings } from '@/modules/policy/settings';
import { encryptGmailRefreshToken } from '@/modules/gmail/tokens';
import { createWorkerRuntime } from '@/worker/runtime';
import { runMailWorkerCycle } from '@/worker/pipeline';
import { readSyncConfig } from '@/worker/sync-config';
import { createGmailConnection } from '@/modules/gmail/credentials';
import { createGmailCredentialRepository } from '@/db/gmail-credential-repository';
import { createProviderClients } from '@/providers/runtime';
import { parseGmailMessage } from '@/modules/gmail/parser';
import type { GmailMessage, GmailThread } from '@/providers/contracts';
import type { Scenario } from './scenarios';
import { safeOperationalEvent } from '@/modules/security/operational-log';

const url = process.env.AUTO_EMAIL_TEST_URL!,
  origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
if (url !== 'http://127.0.0.1:55321') throw new Error('Solo Supabase local.');
const protectedFetch = globalThis.fetch;
export const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const id = () => randomBytes(8).toString('hex');
const contact = 'client@example.invalid';
type ModelPayload = {
  conversation?: { messages: { text: string }[] };
  replyTask?: { targetLanguage: string };
  knowledge?: { content: string }[];
};
export type Actor = {
  id: string;
  email: string;
  password: string;
  accountId: string;
  refresh: string;
  access: string;
  scenario: Scenario;
  thread: GmailThread;
  incoming: GmailMessage;
  drafts: { id: string; message: GmailMessage }[];
  manual: GmailMessage | null;
  modelCalls: { schema: string; payload: ModelPayload }[];
  reads: number;
  writes: number;
  transientFailures: number;
};

export class MailWorld {
  events: ReturnType<typeof safeOperationalEvent>[] = [];
  actors: Actor[] = [];
  readonly key = new SecretValue(randomBytes(32).toString('base64'));
  current: Actor | undefined;
  install() {
    globalThis.fetch = this.fetch;
  }
  readonly fetch: typeof fetch = async (input, init) => {
    const target = new URL(
      input instanceof Request ? input.url : String(input),
    );
    if (target.hostname === 'oauth2.googleapis.com') {
      if (target.pathname === '/revoke')
        return new Response(null, { status: 200 });
      const actor = this.actors.find(
        (a) =>
          a.refresh ===
          new URLSearchParams(String(init?.body)).get('refresh_token'),
      );
      if (!actor) throw new Error('UNKNOWN_SYNTHETIC_REFRESH_TOKEN');
      return Response.json({
        access_token: actor.access,
        expires_in: 3600,
        token_type: 'Bearer',
        scope: gmailScopes.join(' '),
      });
    }
    if (target.hostname === 'gmail.googleapis.com')
      return this.gmail(target, init);
    if (target.hostname === 'api.openai.com') return this.model(init);
    return protectedFetch(input, init);
  };
  async create(
    scenario: Scenario,
    identifiers?: { threadId: string; messageId: string },
  ): Promise<Actor> {
    const email = `mail065-${randomUUID()}@example.invalid`,
      password = `Synthetic-${randomUUID()}!`;
    const user = await createAuthorizedTestUser(service, {
      email,
      password,
      email_confirm: true,
    });
    expect(user.error).toBeNull();
    const ownerId = user.data.user!.id,
      refresh = `refresh_${id()}`,
      access = `access_${id()}`;
    const threadId = identifiers?.threadId ?? id(),
      messageId = identifiers?.messageId ?? id(),
      stamp = Date.now() - 300000;
    const from =
      scenario.id === 'no-reply' ? 'no-reply@example.invalid' : contact;
    const incoming: GmailMessage = {
      id: messageId,
      threadId,
      internalDate: String(stamp),
      labelIds: ['INBOX'],
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: from },
          { name: 'To', value: email },
          { name: 'Subject', value: `Consulta ${scenario.id}` },
          { name: 'Message-ID', value: `<${messageId}@example.invalid>` },
          { name: 'Date', value: new Date(stamp).toUTCString() },
          ...(scenario.id === 'newsletter'
            ? [
                {
                  name: 'List-Unsubscribe',
                  value: '<https://newsletter.example.invalid/unsubscribe>',
                },
                { name: 'Precedence', value: 'bulk' },
              ]
            : []),
        ],
        body: {
          data: Buffer.from(scenario.text).toString('base64url'),
          size: Buffer.byteLength(scenario.text),
        },
      },
    };
    const actor: Actor = {
      id: ownerId,
      email,
      password,
      accountId: '',
      refresh,
      access,
      scenario,
      thread: { id: threadId, historyId: '100', messages: [incoming] },
      incoming,
      drafts: [],
      manual: null,
      modelCalls: [],
      reads: 0,
      writes: 0,
      transientFailures: 0,
    };
    this.actors.push(actor);
    const account = await service
      .from('gmail_accounts')
      .insert({
        user_id: ownerId,
        email,
        status: 'CONNECTED',
        encrypted_refresh_token: encryptGmailRefreshToken(
          new SecretValue(refresh),
          this.key,
          ownerId,
          email,
        ),
        scope_set: [...gmailScopes],
      })
      .select('id')
      .single();
    expect(account.error).toBeNull();
    actor.accountId = account.data!.id;
    const profiles = createWritingProfileRepository(
      service,
      actor.id,
      actor.accountId,
    );
    const profile = await profiles.save({
      profile: writingProfileFixture(),
      model: 'synthetic-style',
      sampleSize: 1,
      inputTokens: 1,
      outputTokens: 1,
      sourceMessageIds: [id()],
      warnings: [],
    });
    await profiles.confirm(profile.revision);
    if (scenario.id === 'answered') this.reply(actor);
    if (scenario.id === 'manual-draft') {
      actor.manual = {
        ...incoming,
        id: id(),
        labelIds: ['DRAFT'],
        raw: Buffer.from(
          `From: ${email}\r\nTo: ${contact}\r\nSubject: Consulta\r\n\r\nBorrador manual privado.`,
          'utf8',
        ).toString('base64url'),
      };
      actor.thread = {
        ...actor.thread,
        messages: [...actor.thread.messages!, actor.manual],
      };
    }
    if (scenario.id === 'authority' || scenario.id === 'expired')
      await this.priceDocument(actor);
    return actor;
  }
  reply(actor: Actor, historical = false) {
    const stamp =
      Number(actor.incoming.internalDate) + (historical ? -60000 : 60000);
    const body = historical
      ? 'El precio de Atlas es de 90 euros.'
      : 'Confirmo que he recibido tu mensaje.';
    const message: GmailMessage = {
      id: id(),
      threadId: actor.thread.id,
      labelIds: ['SENT'],
      internalDate: String(stamp),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: actor.email },
          { name: 'To', value: contact },
          { name: 'Subject', value: 'Consulta' },
          { name: 'Message-ID', value: `<${id()}@example.invalid>` },
          { name: 'Date', value: new Date(stamp).toUTCString() },
          ...(historical
            ? []
            : [
                {
                  name: 'In-Reply-To',
                  value: `<${actor.incoming.id}@example.invalid>`,
                },
              ]),
        ],
        body: {
          data: Buffer.from(body).toString('base64url'),
          size: Buffer.byteLength(body),
        },
      },
    };
    actor.thread = {
      ...actor.thread,
      messages: [...actor.thread.messages!, message],
    };
  }
  async priceDocument(actor: Actor) {
    const sources = createKnowledgeSources(service, actor.id),
      documents = createKnowledgeDocuments(service, actor.id);
    const source = await sources.mutate({
      action: 'save_source',
      title: 'Tarifa oficial Atlas',
      priority: 0,
      enabled: true,
    });
    const document = await documents.upload(
      new File(['El precio de Atlas es de 125 euros.'], 'tarifa-oficial.txt', {
        type: 'text/plain',
      }),
    );
    await sources.mutate({
      action: 'assign_document',
      documentId: document.id,
      sourceId: source.id,
    });
    await sources.mutate({
      action: 'save_rule',
      title: 'Precios oficiales',
      intent: '*',
      terms: [],
      priority: 0,
      enabled: true,
      allowEmailHistory: false,
      primarySourceIds: [source.id],
      fallbackSourceIds: [],
      excludedSourceIds: [],
    });
    await createResponsePolicyRepository(service, actor.id).set({
      ...defaultResponsePolicySettings(),
      sourceRequirements: [{ kind: 'PRICE', sourceIds: [source.id] }],
    });
    await documents.setValidity(document.id, {
      validFrom: '2020-01-01',
      validUntil: new Date(
        Date.now() +
          (actor.scenario.id === 'expired' ? -172800000 : 2592000000),
      )
        .toISOString()
        .slice(0, 10),
    });
    if (actor.scenario.id !== 'expired') this.reply(actor, true);
  }
  config(): ServerConfig {
    return {
      environment: 'development',
      providerMode: 'live',
      timeoutMs: 10000,
      auth: {
        appOrigin: origin,
        supabaseUrl: url,
        publishableKey: process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
        secureCookies: false,
      },
      supabase: {
        url,
        secretKey: new SecretValue(process.env.AUTO_EMAIL_TEST_SECRET_KEY!),
      },
      gmail: { tokenEncryptionKey: this.key },
      google: {
        clientId: 'synthetic.apps.googleusercontent.com',
        clientSecret: new SecretValue('synthetic-google-secret'),
        redirectUri: `${origin}/api/gmail/callback`,
      },
      openai: {
        apiKey: new SecretValue('sk-synthetic-mail065'),
        model: 'synthetic-regression-model',
        reasoningEffort: 'none',
        maxOutputTokens: 2048,
      },
    };
  }
  async cycle(actor: Actor) {
    this.current = actor;
    const report = (event: unknown) => {
      this.events.push(safeOperationalEvent(event));
    };
    const runtime = createWorkerRuntime(this.config(), undefined, {
      enforceExecution: true,
      report,
    });
    const sync = {
      ...readSyncConfig({}, 10000),
      maxAccountsPerCycle: 2,
      maxJobsPerCycle: 4,
    };
    const tick = () =>
      runMailWorkerCycle(
        { store: runtime.syncStore, gmailFor: runtime.gmailFor, report },
        sync,
        {
          store: runtime.jobStore,
          inspect: runtime.inspectEmailJob,
          classifierFor: runtime.classifierFor,
          generate: runtime.generateEmailJob,
          reconcileDrafts: runtime.reconcileDrafts,
          report,
        },
        {
          leaseSeconds: sync.leaseSeconds,
          maxJobsPerCycle: sync.maxJobsPerCycle,
        },
      );
    if (actor.scenario.id === 'disconnected') {
      expect((await tick()).failed).toBe(false);
      return;
    }
    let failed = false;
    // A SKIP LOCKED claim can leave work for the next scheduler tick. Wait for
    // terminal state, without sleeping blindly or retrying a failing test.
    await expect
      .poll(
        async () => {
          failed = (await tick()).failed || failed;
          return (await this.job(actor))?.status ?? 'WAITING';
        },
        { timeout: 10000, intervals: [100, 250, 500] },
      )
      .not.toMatch(/^(WAITING|PENDING|CLASSIFYING|GENERATING)$/);
    expect(failed, JSON.stringify(this.events)).toBe(false);
  }
  async enable(actor: Actor, enabled = true) {
    const result = await service.rpc('set_automation_settings', {
      p_user_id: actor.id,
      p_enabled: enabled,
      p_poll_seconds: 300,
      p_daily_limit: 30,
    });
    expect(result.error).toBeNull();
    expect(result.data).toBe(true);
  }
  async disconnect(actor: Actor) {
    await createGmailConnection({
      store: createGmailCredentialRepository(
        service,
        actor.id,
        actor.accountId,
      ),
      providers: createProviderClients(this.config()),
      encryptionKey: this.key,
      timeoutMs: 10000,
    }).disconnect();
  }
  async job(actor: Actor) {
    const result = await service
      .from('email_jobs')
      .select('*')
      .eq('user_id', actor.id)
      .eq('target_message_id', actor.incoming.id)
      .maybeSingle();
    expect(result.error).toBeNull();
    return result.data;
  }
  async draftText(actor: Actor) {
    return actor.drafts[0]
      ? (await parseGmailMessage(actor.drafts[0].message)).bodyText
      : '';
  }
  private gmail(target: URL, init?: RequestInit): Response {
    const headers = new Headers(init?.headers),
      actor = this.actors.find(
        (a) => headers.get('authorization') === `Bearer ${a.access}`,
      );
    if (!actor) throw new Error('UNKNOWN_SYNTHETIC_ACCESS_TOKEN');
    const resource = decodeURIComponent(
      target.pathname.split('/users/me/')[1] ?? '',
    );
    actor.reads++;
    if (
      actor.scenario.id === 'google-retry' &&
      resource === 'messages' &&
      actor.transientFailures === 0
    ) {
      actor.transientFailures++;
      return Response.json({ error: { code: 503 } }, { status: 503 });
    }
    if (resource === 'profile')
      return Response.json({ emailAddress: actor.email });
    if (resource === 'messages') {
      const sent = target.searchParams.getAll('labelIds').includes('SENT');
      return Response.json({
        messages: sent
          ? []
          : [{ id: actor.incoming.id, threadId: actor.thread.id }],
      });
    }
    if (resource === `threads/${actor.thread.id}`)
      return Response.json(actor.thread);
    if (resource.startsWith('messages/')) {
      const message = [
        ...actor.thread.messages!,
        ...actor.drafts.map((d) => d.message),
      ].find((m) => m.id === resource.slice(9));
      if (!message) return Response.json({}, { status: 404 });
      return Response.json(
        target.searchParams.get('format') === 'metadata'
          ? {
              ...message,
              raw: undefined,
              payload: { headers: message.payload?.headers, body: { size: 0 } },
            }
          : message,
      );
    }
    if (resource === 'drafts' && init?.method === 'POST') {
      const { message } = JSON.parse(String(init.body)) as {
        message: { raw: string; threadId: string };
      };
      actor.writes++;
      const draft = {
        id: `r-${id()}`,
        message: {
          id: id(),
          threadId: message.threadId,
          labelIds: ['DRAFT'],
          raw: message.raw,
        },
      };
      actor.drafts.push(draft);
      actor.thread = {
        ...actor.thread,
        messages: [...actor.thread.messages!, draft.message],
      };
      return Response.json(draft);
    }
    if (resource === 'drafts') return Response.json({ drafts: actor.drafts });
    const draft = actor.drafts.find((d) => resource === `drafts/${d.id}`);
    if (draft) return Response.json(draft);
    throw new Error('UNSCRIPTED_GMAIL_RESOURCE');
  }
  private model(init?: RequestInit): Response {
    const actor = this.current;
    if (!actor) throw new Error('MODEL_WITHOUT_ACCOUNT');
    const request = JSON.parse(String(init?.body)) as {
      store: boolean;
      background: boolean;
      tool_choice: string;
      tools?: unknown;
      text: { format: { name: string } };
      input: { content: { text: string }[] }[];
    };
    expect(request.store).toBe(false);
    expect(request.background).toBe(false);
    expect(request.tool_choice).toBe('none');
    expect(request.tools).toBeUndefined();
    const schema = request.text.format.name,
      payload = JSON.parse(request.input[0].content[0].text) as ModelPayload;
    actor.modelCalls.push({ schema, payload });
    const price = payload.knowledge?.find((k) =>
      k.content.includes('125 euros'),
    );
    const english = payload.replyTask?.targetLanguage === 'en';
    const body = price
      ? 'El precio de Atlas es de 125 euros.'
      : english
        ? 'Hello,\n\nI confirm that I have received your message.\n\nThank you and kind regards.'
        : 'Buenos días,\n\nConfirmo que he recibido tu mensaje.\n\nGracias y un saludo.';
    const value =
      schema === 'email_classification'
        ? {
            decision: 'REPLY_REQUIRED',
            intent:
              actor.scenario.id === 'authority' ||
              actor.scenario.id === 'expired'
                ? 'REQUEST_INFORMATION'
                : 'CONFIRMATION',
            reasons: ['EXPLICIT_QUESTION'],
            riskFlags: [],
            needsAttachment: false,
            confidence: 'HIGH',
          }
        : schema === 'response_verification_v1'
          ? { verdict: 'SUPPORTED', issues: [] }
          : {
              status: 'READY',
              bodyText: body,
              language: english ? 'en' : 'es',
              missingInformation: [],
              evidence: price
                ? [
                    {
                      knowledgeIndex: payload.knowledge!.indexOf(price),
                      quote: 'El precio de Atlas es de 125 euros.',
                      claim: 'El precio de Atlas es de 125 euros.',
                    },
                  ]
                : [],
              warnings: [],
            };
    if (
      schema === 'generated_response_v1' &&
      actor.scenario.id === 'late-reply'
    )
      this.reply(actor);
    return Response.json({
      id: `resp_${id()}`,
      object: 'response',
      status: 'completed',
      output: [
        {
          id: id(),
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify(value),
              annotations: [],
            },
          ],
        },
      ],
      usage: { input_tokens: 50, output_tokens: 20 },
    });
  }
  async cleanup() {
    globalThis.fetch = protectedFetch;
    for (const actor of this.actors) {
      const files = await service.storage
        .from('knowledge-documents')
        .list(actor.id);
      if (files.data?.length)
        expect(
          (
            await service.storage
              .from('knowledge-documents')
              .remove(files.data.map((f) => `${actor.id}/${f.name}`))
          ).error,
        ).toBeNull();
      expect(
        (await service.from('source_rules').delete().eq('user_id', actor.id))
          .error,
      ).toBeNull();
      expect(
        (
          await service
            .from('source_documents')
            .delete()
            .eq('user_id', actor.id)
        ).error,
      ).toBeNull();
      expect((await service.auth.admin.deleteUser(actor.id)).error).toBeNull();
    }
  }
}
export async function login(page: Page, actor: Actor) {
  await page.goto('/login');
  await page
    .getByLabel('Correo electrónico', { exact: true })
    .fill(actor.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(actor.password);
  await page
    .getByRole('button', { name: 'Iniciar sesión', exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
export const test = base.extend<{ world: MailWorld }>({
  world: async ({ context }, provide) => {
    const blocked: string[] = [];
    await context.route('**/*', (route) => {
      const destination = new URL(route.request().url());
      if ([origin, url].includes(destination.origin)) return route.continue();
      blocked.push(destination.origin);
      return route.abort('blockedbyclient');
    });
    const world = new MailWorld();
    world.install();
    try {
      await provide(world);
    } finally {
      await world.cleanup();
      expect(blocked).toEqual([]);
    }
  },
});
export { expect };
export { createStylePreferenceRepository };
