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
import { createOnboardingWorkerStore } from '@/db/onboarding';
import { runOnboardingAnalysis, type OnboardingEvent } from './onboarding';
import { inspectAutomationSelection } from './automation-selection';
import { createAccountDeletionRuntime } from '@/db/account-deletion-runtime';
import { createGenerationRecorder } from '@/db/generation-runs';
import { readGenerationPricing } from '@/modules/analytics/generations';
import { createSentDraftTrackingStore } from '@/db/sent-draft-tracking';
import {
  runSentDraftTracking,
  type SentTrackingEvent,
} from './sent-draft-tracking';
import { createReplyComparisonStore } from '@/db/reply-comparisons';
import { runStyleLearning } from './style-learning';
import { createStyleLearningWorkerStore } from '@/db/style-learning';
import {
  runReplyComparisons,
  type ReplyComparisonEvent,
} from './reply-comparisons';

export function createWorkerRuntime(
  config: ServerConfig = getServerConfig(),
  mocks?: ProviderClients,
  controls: {
    signal?: AbortSignal;
    report?: (
      event:
        | ProviderRequestEvent
        | JobEvent
        | OnboardingEvent
        | SentTrackingEvent
        | ReplyComparisonEvent,
    ) => void;
    enforceExecution?: boolean;
  } = {},
) {
  const client = createServiceDataClient(config);
  const generationPricing = readGenerationPricing(process.env);
  const requestConfig = readRequestPolicyConfig(process.env, config.timeoutMs);
  const executorFor = (
    work: OwnedWorkItem,
    enforceExecution = controls.enforceExecution,
  ) =>
    createProviderRequestExecutor({
      gate: createProviderRequestGate(client, work, enforceExecution),
      config: requestConfig,
      signal: controls.signal,
      report: controls.report,
      accountId: work?.gmailAccountId,
    });
  const connectGmail = async (
    work: OwnedWorkItem,
    enforceExecution = controls.enforceExecution,
  ) => {
    await openWorkerDataAccess(client, work);
    if (config.providerMode !== 'live') throw new Error('GMAIL_UNAVAILABLE');
    return createGmailConnection({
      store: createGmailCredentialRepository(
        client,
        work.userId,
        work.gmailAccountId,
      ),
      providers: createProviderClients(
        config,
        mocks,
        executorFor(work, enforceExecution),
      ),
      encryptionKey: config.gmail.tokenEncryptionKey,
      timeoutMs: config.timeoutMs,
    }).client;
  };
  const gmailFor = (work: OwnedWorkItem) => connectGmail(work);
  // Tracking previous drafts is independent of incoming-mail automation.
  // The credential store still requires an active user and connected account.
  const trackingGmailFor = async (work: OwnedWorkItem) => {
    const gmail = await connectGmail(work, false);
    return Object.freeze({
      get: gmail.get.bind(gmail),
      getThread: gmail.getThread.bind(gmail),
      getMessage: gmail.getMessage.bind(gmail),
    });
  };
  const runtime = Object.freeze({
    providersFor: (work: OwnedWorkItem) =>
      createProviderClients(config, mocks, executorFor(work, false)),
    runAccountDeletions: createAccountDeletionRuntime(config),
    syncStore: createGmailSyncStore(client),
    jobStore: createEmailJobStore(client),
    dataFor: (work: OwnedWorkItem) => openWorkerDataAccess(client, work),
    gmailFor,
    async runOnboarding() {
      return runOnboardingAnalysis({
        store: createOnboardingWorkerStore(client),
        signal: controls.signal,
        report: controls.report,
        async clientsFor(work, assertActive) {
          const account = await (
            await openWorkerDataAccess(client, work)
          ).getAccount();
          if (config.providerMode !== 'live')
            throw new Error('GMAIL_UNAVAILABLE');
          // This explicit, consented analysis is independent of email automation.
          const base = createProviderRequestExecutor({
            gate: createProviderRequestGate(client, work),
            config: requestConfig,
            signal: controls.signal,
            accountId: work.gmailAccountId,
          });
          const execute: typeof base = (provider, safe, operation, before) =>
            base(
              provider,
              safe,
              async (remaining) => {
                await assertActive();
                return operation(remaining);
              },
              async () => {
                await assertActive();
                await before?.();
              },
            );
          const scoped = createProviderClients(config, mocks, execute);
          const gmail = createGmailConnection({
            store: createGmailCredentialRepository(
              client,
              work.userId,
              work.gmailAccountId,
            ),
            providers: scoped,
            encryptionKey: config.gmail.tokenEncryptionKey,
            timeoutMs: config.timeoutMs,
          }).client;
          return {
            gmail,
            text: scoped.text,
            mailboxAddress: account.email,
            model: config.openai.model,
          };
        },
      });
    },
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
      await runSentDraftTracking(
        {
          store: createSentDraftTrackingStore(client),
          gmailFor: trackingGmailFor,
          report: (event) => controls.report?.(event),
        },
        limit,
        signal ?? controls.signal,
      );
      await runReplyComparisons(
        {
          store: createReplyComparisonStore(client),
          gmailFor: trackingGmailFor,
          report: (event) => controls.report?.(event),
        },
        limit,
        signal ?? controls.signal,
      );
      await runStyleLearning(
        createStyleLearningWorkerStore(client),
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
      if (existing?.sent)
        return { status: 'SKIPPED', reasonCode: 'ALREADY_ANSWERED' };
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
      const selection = await inspectAutomationSelection({
        client,
        work: job,
        gmail,
        messageId: job.targetMessageId,
        classification: job.classification,
      });
      if (selection.reason)
        return { status: 'SKIPPED', reasonCode: selection.reason };
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
          generations: createGenerationRecorder(
            client,
            { ...job, emailJobId: job.id },
            { id: config.openai.model, ...config.openai },
            generationPricing,
          ),
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
    async generationsFor(work: OwnedWorkItem) {
      await openWorkerDataAccess(client, work);
      if (!config.openai) throw new DataAccessError('UNAVAILABLE');
      return createGenerationRecorder(
        client,
        work,
        { id: config.openai.model, ...config.openai },
        generationPricing,
      );
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
