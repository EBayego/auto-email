import { getServerConfig, type ServerConfig } from '@/config/env';
import { createServiceDataClient } from '@/db/service-client';
import { createProviderClients } from '@/providers/runtime';
import type { ProviderClients } from '@/providers/contracts';
import { openWorkerDataAccess, type OwnedWorkItem } from './data-access';
import { createGmailCredentialRepository } from '@/db/gmail-credential-repository';
import { createGmailConnection } from '@/modules/gmail/credentials';
import { createGmailSyncStore } from '@/db/gmail-sync';
import { createAccountEmailClassifier } from './email-classifier';
import { createEmailJobStore } from '@/db/email-jobs';
import { checkAccountEmailIntervention } from './email-intervention';
import type { EmailJob } from './email-jobs';
import { createProviderRequestGate } from '@/db/provider-request-gate';
import {
  createProviderRequestExecutor,
  type ProviderRequestEvent,
} from '@/providers/request-policy';
import { readRequestPolicyConfig } from './request-config';
import { createEmailJobDraftWriter } from './email-drafts';
import { createKnowledgeSources } from '@/db/knowledge-sources';
import type { PreparedReplyContext } from '@/modules/gmail/manual-selection';
import { DataAccessError } from '@/db/errors';
import { createReplyKnowledgeResolver } from '@/modules/response/knowledge-context';
import { KnowledgeRetrievalError } from '@/modules/knowledge/retriever';
import { createResponsePolicyRepository } from '@/db/response-policy';
import { createResponseValidationRepository } from '@/db/response-validation';
import { createDraftReconciliationStore } from '@/db/draft-reconciliation';
import { runDraftReconciliation } from './draft-reconciliation';
import { generateEmailJobDraft } from './email-generation';
import type { GenerationOutcome, JobEvent } from './email-jobs';
import { createDraftGenerationRepository } from '@/db/draft-generations';
import { selectContextualWritingProfile } from '@/db/contextual-styles';
import { createStylePreferenceRepository } from '@/db/style-preferences';
import { createWritingProfileRepository } from '@/db/writing-profiles';
import { createStyleExampleRetriever } from '@/modules/identity/style-example-retriever';
import { createResponseGenerator } from '@/modules/response/generator';

export function createWorkerRuntime(
  config: ServerConfig = getServerConfig(),
  mocks?: ProviderClients,
  controls: {
    signal?: AbortSignal;
    report?: (event: ProviderRequestEvent | JobEvent) => void;
    enforceExecution?: boolean;
  } = {},
) {
  const client = createServiceDataClient(config);
  const requestConfig = readRequestPolicyConfig(process.env, config.timeoutMs);
  const executorFor = (work?: OwnedWorkItem) =>
    createProviderRequestExecutor({
      gate: createProviderRequestGate(client, work, controls.enforceExecution),
      config: requestConfig,
      signal: controls.signal,
      report: controls.report,
      accountId: work?.gmailAccountId,
    });
  const providers = createProviderClients(config, mocks, executorFor());
  const gmailFor = async (work: OwnedWorkItem) => {
    await openWorkerDataAccess(client, work);
    if (config.providerMode !== 'live') throw new Error('GMAIL_UNAVAILABLE');
    return createGmailConnection({
      store: createGmailCredentialRepository(
        client,
        work.userId,
        work.gmailAccountId,
      ),
      providers: createProviderClients(config, mocks, executorFor(work)),
      encryptionKey: config.gmail.tokenEncryptionKey,
      timeoutMs: config.timeoutMs,
    }).client;
  };
  const runtime = Object.freeze({
    providers,
    syncStore: createGmailSyncStore(client),
    jobStore: createEmailJobStore(client),
    dataFor: (work: OwnedWorkItem) => openWorkerDataAccess(client, work),
    gmailFor,
    async reconcileDrafts(limit: number, signal?: AbortSignal) {
      await runDraftReconciliation(
        {
          store: createDraftReconciliationStore(client),
          gmailFor,
          report: (event) => controls.report?.(event),
        },
        limit,
        signal ?? controls.signal,
      );
    },
    async generateEmailJob(
      job: EmailJob,
      control: { assertLease(): Promise<void>; signal?: AbortSignal },
    ): Promise<GenerationOutcome> {
      if (!config.openai)
        return {
          status: 'REVIEW_REQUIRED',
          reasonCode: 'GENERATOR_NOT_CONFIGURED',
        };
      const data = await openWorkerDataAccess(client, job),
        account = await data.getAccount();
      const store = createDraftGenerationRepository(
        client,
        job.userId,
        job.gmailAccountId,
      );
      const existing = await store.find(job.targetMessageId);
      if (existing)
        return existing.status === 'CREATED' && existing.draftId
          ? { status: 'DRAFT_CREATED', draftId: existing.draftId }
          : {
              status: 'REVIEW_REQUIRED',
              reasonCode: 'DRAFT_RECONCILIATION_REQUIRED',
            };
      const profile = await createWritingProfileRepository(
        client,
        job.userId,
        job.gmailAccountId,
      ).get();
      if (profile?.review_status !== 'CONFIRMED')
        return {
          status: 'REVIEW_REQUIRED',
          reasonCode: 'STYLE_PROFILE_REQUIRED',
        };
      const gmail = await gmailFor(job);
      return generateEmailJobDraft({
        job,
        store,
        model: config.openai.model,
        assertLease: control.assertLease,
        signal: control.signal ?? controls.signal,
        selection: {
          accountId: job.gmailAccountId,
          mailboxAddress: account.email,
          threadId: job.threadId,
          style: { revision: profile.revision, profile: profile.profile },
          resolvePreferences: (recipient) =>
            createStylePreferenceRepository(
              client,
              job.userId,
              job.gmailAccountId,
            ).resolve(recipient),
          resolveStyle: async (recipient) => {
            const chosen = await selectContextualWritingProfile(
              client,
              job.userId,
              job.gmailAccountId,
              recipient,
            );
            if (!chosen) throw new DataAccessError('FORBIDDEN');
            return {
              revision: chosen.revision,
              profile: chosen.profile,
              ...(chosen.scope_kind !== 'GENERAL'
                ? { exampleMessageIds: chosen.source_message_ids }
                : {}),
            };
          },
        },
        orchestration: {
          gmail,
          generator: createResponseGenerator(
            createProviderClients(config, mocks, executorFor(job)).text,
          ),
          styleExamples: createStyleExampleRetriever({
            gmail,
            identity: {
              accountId: job.gmailAccountId,
              mailboxAddress: account.email,
            },
          }),
          retrieveKnowledge: await runtime.knowledgeFor(job),
          policy: await runtime.policyFor(job),
          factualValidation: await runtime.factualValidationFor(job),
        },
        writer: createEmailJobDraftWriter({
          client,
          job,
          gmail,
          assertLease: control.assertLease,
          signal: control.signal ?? controls.signal,
        }),
      });
    },
    async factualValidationFor(work: OwnedWorkItem) {
      await openWorkerDataAccess(client, work);
      return createResponseValidationRepository(
        client,
        work.userId,
        work.gmailAccountId,
      );
    },
    async policyFor(work: OwnedWorkItem) {
      await openWorkerDataAccess(client, work);
      const access = createResponsePolicyRepository(
        client,
        work.userId,
      ).forAccount(work.gmailAccountId);
      return Object.freeze({
        ...access,
        async classify(context: PreparedReplyContext) {
          if (context.accountId !== work.gmailAccountId)
            throw new DataAccessError('FORBIDDEN');
          const classifier = await createAccountEmailClassifier({
            client,
            work,
            gmail: await gmailFor(work),
            text: createProviderClients(config, mocks, executorFor(work)).text,
            propagateProviderErrors: true,
          });
          const result = await classifier.classify(context.targetMessageId);
          if (result.decision === 'UNCERTAIN')
            throw new DataAccessError('UNAVAILABLE');
          return { intent: result.intent, riskFlags: result.riskFlags };
        },
      });
    },
    async knowledgeFor(work: OwnedWorkItem) {
      const data = await openWorkerDataAccess(client, work);
      const sources = createKnowledgeSources(client, work.userId);
      const resolve = createReplyKnowledgeResolver({
        async configuration() {
          const account = await data.getAccount();
          if (account.status !== 'CONNECTED')
            throw new DataAccessError('FORBIDDEN');
          return sources.list();
        },
        async classify(context) {
          const classifier = await createAccountEmailClassifier({
            client,
            work,
            gmail: await gmailFor(work),
            text: createProviderClients(config, mocks, executorFor(work)).text,
            propagateProviderErrors: true,
          });
          const classification = await classifier.classify(
            context.targetMessageId,
          );
          if (
            classification.reasons.some((r) =>
              ['MODEL_UNAVAILABLE', 'INVALID_MODEL_RESPONSE'].includes(r),
            )
          )
            throw new KnowledgeRetrievalError('UNAVAILABLE');
          return {
            intent: classification.intent,
            riskFlags: [...classification.riskFlags],
          };
        },
        retriever: sources,
      });
      return async (context: PreparedReplyContext) => {
        if (context.accountId !== work.gmailAccountId)
          throw new DataAccessError('FORBIDDEN');
        return resolve(context);
      };
    },
    async draftWriterFor(
      job: EmailJob,
      control: { assertLease(): Promise<void> },
    ) {
      return createEmailJobDraftWriter({
        client,
        job,
        gmail: await gmailFor(job),
        assertLease: control.assertLease,
        signal: controls.signal,
      });
    },
    async inspectEmailJob(job: EmailJob) {
      return checkAccountEmailIntervention({
        client,
        job,
        gmail: await gmailFor(job),
      });
    },
    async classifierFor(work: OwnedWorkItem) {
      return createAccountEmailClassifier({
        client,
        work,
        gmail: await gmailFor(work),
        text: createProviderClients(config, mocks, executorFor(work)).text,
        propagateProviderErrors: true,
      });
    },
  });
  return runtime;
}
