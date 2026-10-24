import { createHash, randomUUID } from 'node:crypto';
import {
  verifiedFactsAtWrite,
  validateResponseFacts,
  rejectFactualValidation,
  factualAudit,
  type FactualAudit,
} from '@/modules/response/factual-validation';
import { performance } from 'node:perf_hooks';
import type { GmailClient } from '@/providers/contracts';
import {
  responseLimits,
  type ResponseGenerationResult,
} from '@/modules/response/contracts';
import { parseGeneratedResponse, record } from '@/modules/response/schema';
import {
  selectPendingEmail,
  validateManualSelection,
  type ManualSelectionInput,
  type PreparedReplyContext,
} from './manual-selection';
import { buildReplyMime } from './reply-mime';
import { draftFingerprint } from './draft-intent';
import {
  replyRecipientAddresses,
  sameReplyRecipients,
} from './reply-recipients';
import { parseGmailMessage } from './parser';
import { normalizeEmailText } from './email-content';
import { createResponsePolicyEngine } from '@/modules/policy/response-policy';
import { responseOutputHasInjection } from '@/modules/security/prompt-injection';
import {
  DraftWriteError,
  DraftPreconditionError,
  existingDraftResult,
  type DraftStore,
  type DraftWriteResult,
} from './draft-contracts';

const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const fingerprint = (context: PreparedReplyContext) =>
  createHash('sha256').update(JSON.stringify(context)).digest('hex');
export const draftRevalidationMaxAgeMs = 5000;

export function createDraftWriter(input: {
  gmail: Pick<GmailClient, 'getThread' | 'getMessage' | 'createDraft'>;
  store: DraftStore;
  assertCanWrite?: () => Promise<void>;
  monotonicNow?: () => number;
  signal?: AbortSignal;
  recordFactualValidation?: (validation: FactualAudit) => Promise<void>;
}) {
  return Object.freeze({
    async create(options: {
      selection: ManualSelectionInput;
      context: PreparedReplyContext;
      response: ResponseGenerationResult;
      model: string;
      now?: Date;
    }): Promise<DraftWriteResult> {
      const { selection, context, response } = options;
      const factualInput = {
        conversation: context.modelInput,
        recipient: context.replyTarget.to.address,
        recipients: replyRecipientAddresses(context.replyTarget),
        messageAudiences: context.messageAudiences,
      };
      const recordFactualFailure = async () => {
        const checked = validateResponseFacts(factualInput, response);
        await input.recordFactualValidation?.(
          factualAudit(
            checked.status === 'REVIEW_REQUIRED'
              ? checked
              : rejectFactualValidation(checked, 'VALIDATION_CHANGED'),
          ),
        );
      };
      validateManualSelection(selection);
      if (
        !selection.style ||
        context.accountId !== selection.accountId ||
        context.threadId !== selection.threadId ||
        (selection.targetMessageId &&
          selection.targetMessageId !== context.targetMessageId)
      )
        throw new DraftWriteError('INVALID_INPUT');
      const previous = await input.store.find(context.targetMessageId);
      if (previous) {
        if (previous.threadId !== context.threadId)
          throw new DraftWriteError('INVALID_INPUT');
        return existingDraftResult(previous);
      }
      if (
        response.status !== 'READY' ||
        !response.bodyText ||
        !Number.isInteger(response.modelCalls) ||
        response.modelCalls < 2 ||
        response.modelCalls > responseLimits.modelCalls ||
        response.warnings.some(
          (warning) => warning !== 'HUMAN_REVIEW_REQUIRED',
        ) ||
        response.policyEvaluations?.some((e) => e.action !== 'ALLOW_DRAFT') ||
        responseOutputHasInjection(response)
      )
        throw new DraftWriteError('RESPONSE_NOT_READY');
      const policy = createResponsePolicyEngine();
      if (
        [
          context.modelInput,
          {
            ...context.modelInput,
            messages: [
              {
                speaker: 'participant_1',
                text: response.bodyText,
                isTarget: true,
              },
            ],
          },
        ].some(
          (conversation) =>
            policy.preflight({ conversation }, { checkSources: false })
              .action !== 'ALLOW_DRAFT',
        )
      )
        throw new DraftWriteError('RESPONSE_NOT_READY');
      // Repeat the structural check at the write boundary; never accept MIME or
      // recipients supplied by the model or an operator's CLI arguments.
      parseGeneratedResponse(
        JSON.stringify({
          status: response.status,
          bodyText: response.bodyText,
          language: response.language,
          missingInformation: response.missingInformation,
          evidence: response.evidence,
          warnings: [],
        }),
      );
      const factualValidation = verifiedFactsAtWrite(factualInput, response);
      if (!factualValidation) {
        await recordFactualFailure();
        throw new DraftWriteError('RESPONSE_NOT_READY');
      }
      const attemptId = randomUUID();
      const mime = buildReplyMime({
        from: selection.mailboxAddress,
        target: context.replyTarget,
        bodyText: response.bodyText,
        attemptId,
        now: options.now,
      });
      const expected = fingerprint(context);
      const reservation = await input.store.reserve({
        id: attemptId,
        threadId: context.threadId,
        targetMessageId: context.targetMessageId,
        styleRevision: context.styleRevision ?? selection.style.revision,
        model: options.model,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        sourcesUsed: response.sourcesUsed,
        policyRevision: response.policyRevision,
        knowledgeRevision: response.knowledgeRevision,
        factualValidation,
        intent: {
          version: 'mail048-v1',
          internetMessageId: mime.internetMessageId,
          inReplyTo: context.replyTarget.inReplyTo,
          fingerprint: draftFingerprint({
            from: [{ name: '', address: selection.mailboxAddress }],
            to: mime.to,
            cc: mime.cc,
            subject: mime.subject,
            inReplyTo: [context.replyTarget.inReplyTo],
            bodyText: response.bodyText,
          }),
        },
      });
      if (!reservation.acquired) return existingDraftResult(reservation.record);
      let attempted = false;
      const now = input.monotonicNow ?? (() => performance.now());
      let readAt = -Infinity;
      const revalidate = async () => {
        let matches = false;
        await selectPendingEmail(
          {
            getThread: async (...args) => {
              const thread = await input.gmail.getThread(...args);
              // Start freshness at the actual read, before style/preferences I/O.
              readAt = now();
              return thread;
            },
          },
          { ...selection, targetMessageId: context.targetMessageId },
          async (fresh) => {
            matches = fingerprint(fresh) === expected;
          },
        );
        if (!matches) throw new DraftPreconditionError('THREAD_CHANGED');
      };
      let result: DraftWriteResult = {
        status: 'CANCELLED',
        attemptId,
        draftId: null,
        draftMessageId: null,
        verified: false,
        reason: 'THREAD_CHANGED',
      };
      try {
        let raw: unknown;
        try {
          raw = await input.gmail.createDraft(
            {
              raw: mime.raw,
              threadId: context.threadId,
            },
            {
              prepare: revalidate,
              async beforeRequest() {
                await input.assertCanWrite?.();
                if (!verifiedFactsAtWrite(factualInput, response)) {
                  await recordFactualFailure();
                  throw new DraftPreconditionError('PREWRITE_FAILED');
                }
                if (
                  !(await input.store.beginWrite(
                    attemptId,
                    context.threadId,
                    context.targetMessageId,
                  ))
                )
                  throw new DraftPreconditionError('PREWRITE_FAILED');
                // Google drafts.create has no conditional thread/history write.
                // Reject slow preflight/permit/DB waits, leaving only the small
                // unavoidable race between this last snapshot and Google's POST.
                if (
                  input.signal?.aborted ||
                  now() - readAt > draftRevalidationMaxAgeMs
                )
                  throw new DraftPreconditionError('PREWRITE_FAILED');
                attempted = true;
              },
            },
          );
        } catch (error) {
          if (!attempted) throw error;
          // A failed POST can have succeeded at Google. Never replay it.
          await input.store
            .stop(attemptId, 'UNCERTAIN', 'GMAIL_WRITE_UNCERTAIN')
            .catch(() => {});
          result = {
            ...result,
            status: 'RECONCILIATION_REQUIRED',
            reason: 'GMAIL_WRITE_UNCERTAIN',
          };
          return result;
        }
        const draftId = record(raw) && safeId(raw.id) ? raw.id : null;
        const message = record(raw) && record(raw.message) ? raw.message : null;
        const draftMessageId =
          message && safeId(message.id) ? message.id : null;
        result = { ...result, draftId, draftMessageId };
        if (
          !draftId ||
          !draftMessageId ||
          message?.threadId !== context.threadId
        ) {
          await input.store
            .stop(attemptId, 'UNCERTAIN', 'GMAIL_WRITE_UNCERTAIN', {
              draftId,
              draftMessageId,
            })
            .catch(() => {});
          result = {
            ...result,
            status: 'RECONCILIATION_REQUIRED',
            reason: 'GMAIL_WRITE_UNCERTAIN',
          };
          return result;
        }
        // Persist Google's stable draft ID before the optional read-back, so a
        // read failure cannot hide a successfully created draft or trigger retry.
        try {
          await input.store.created(attemptId, draftId, draftMessageId);
        } catch {
          await input.store
            .stop(attemptId, 'UNCERTAIN', 'PERSISTENCE_FAILED', {
              draftId,
              draftMessageId,
            })
            .catch(() => {});
          result = {
            ...result,
            status: 'RECONCILIATION_REQUIRED',
            reason: 'PERSISTENCE_FAILED',
          };
          return result;
        }
        result = {
          status: 'CREATED_UNVERIFIED',
          attemptId,
          draftId,
          draftMessageId,
          verified: false,
          reason: 'VERIFICATION_FAILED',
        };
        try {
          const saved = await parseGmailMessage(
            await input.gmail.getMessage(draftMessageId, {
              format: 'full',
            }),
          );
          if (
            saved.id !== draftMessageId ||
            saved.threadId !== context.threadId ||
            !saved.labels.includes('DRAFT') ||
            saved.labels.includes('SENT') ||
            saved.from.length !== 1 ||
            saved.from[0].address.toLowerCase() !==
              selection.mailboxAddress.toLowerCase() ||
            !sameReplyRecipients(saved.to, mime.to) ||
            !sameReplyRecipients(saved.cc, mime.cc) ||
            saved.bcc.length ||
            saved.attachments.length ||
            (saved.subject ?? '') !== mime.subject ||
            // Gmail can replace the draft's own Message-ID. Reply threading
            // is verified through the original In-Reply-To and References.
            !saved.internetMessageId ||
            saved.inReplyTo.length !== 1 ||
            saved.inReplyTo[0] !== context.replyTarget.inReplyTo ||
            JSON.stringify(saved.references) !==
              JSON.stringify(mime.references) ||
            saved.bodyStatus !== 'complete' ||
            saved.bodyText !== normalizeEmailText(response.bodyText!)
          )
            return result;
          await input.store.verified(attemptId);
          result = {
            status: 'CREATED',
            attemptId,
            draftId,
            draftMessageId,
            verified: true,
          };
        } catch {
          // Keep the known draft and its IDs. Read/verification errors never
          // authorize an update, deletion or second creation.
        }
        return result;
      } catch (error) {
        if (!attempted) {
          const reason =
            error instanceof DraftPreconditionError
              ? error.reason
              : 'PREWRITE_FAILED';
          await input.store
            .stop(attemptId, 'CANCELLED', reason)
            .catch(() => {});
          if (error instanceof DraftPreconditionError)
            return { ...result, reason };
        }
        throw error;
      }
    },
  });
}
