import { createHash, randomUUID } from 'node:crypto';
import type { GmailClient } from '@/providers/contracts';
import type { ResponseGenerationResult } from '@/modules/response/contracts';
import { parseGeneratedResponse, record } from '@/modules/response/schema';
import {
  selectPendingEmail,
  validateManualSelection,
  type ManualSelectionInput,
  type PreparedReplyContext,
} from './manual-selection';
import { buildReplyMime } from './reply-mime';
import { parseGmailMessage } from './parser';
import { normalizeEmailText } from './email-content';
import {
  DraftWriteError,
  existingDraftResult,
  type DraftStore,
  type DraftWriteResult,
} from './draft-contracts';

const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const fingerprint = (context: PreparedReplyContext) =>
  createHash('sha256').update(JSON.stringify(context)).digest('hex');

export function createDraftWriter(input: {
  gmail: Pick<GmailClient, 'getThread' | 'getMessage' | 'createDraft'>;
  store: DraftStore;
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
      validateManualSelection(selection);
      if (
        !selection.style ||
        context.accountId !== selection.accountId ||
        context.threadId !== selection.threadId ||
        (selection.targetMessageId &&
          selection.targetMessageId !== context.targetMessageId)
      )
        throw new DraftWriteError('INVALID_INPUT');
      if (
        response.status !== 'READY' ||
        !response.bodyText ||
        response.modelCalls !== 2 ||
        response.warnings.some((warning) => warning !== 'HUMAN_REVIEW_REQUIRED')
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
      });
      if (!reservation.acquired) return existingDraftResult(reservation.record);
      let attempted = false;
      let result: DraftWriteResult = {
        status: 'CANCELLED',
        attemptId,
        draftId: null,
        draftMessageId: null,
        verified: false,
        reason: 'THREAD_CHANGED',
      };
      try {
        // The last Gmail read checks replies, manual drafts, new participants,
        // routing, headers and the exact context that OpenAI used.
        await selectPendingEmail(
          input.gmail,
          { ...selection, targetMessageId: context.targetMessageId },
          async (fresh) => {
            if (fingerprint(fresh) !== expected) return;
            attempted = true;
            let raw: unknown;
            try {
              raw = await input.gmail.createDraft({
                raw: mime.raw,
                threadId: context.threadId,
              });
            } catch {
              // A failed POST can have succeeded at Google. Never replay it.
              await input.store
                .stop(attemptId, 'UNCERTAIN', 'GMAIL_WRITE_UNCERTAIN')
                .catch(() => {});
              result = {
                ...result,
                status: 'RECONCILIATION_REQUIRED',
                reason: 'GMAIL_WRITE_UNCERTAIN',
              };
              return;
            }
            const draftId = record(raw) && safeId(raw.id) ? raw.id : null;
            const message =
              record(raw) && record(raw.message) ? raw.message : null;
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
              return;
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
              return;
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
                saved.to.length !== 1 ||
                saved.to[0].address.toLowerCase() !==
                  context.replyTarget.to.address.toLowerCase() ||
                saved.cc.length ||
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
                return;
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
          },
        );
        if (!attempted)
          await input.store.stop(attemptId, 'CANCELLED', 'THREAD_CHANGED');
        return result;
      } catch (error) {
        if (!attempted)
          await input.store
            .stop(attemptId, 'CANCELLED', 'PREWRITE_FAILED')
            .catch(() => {});
        throw error;
      }
    },
  });
}
