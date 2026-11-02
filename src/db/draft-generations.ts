import type { DataClient } from './models';
import type { Tables } from './database.types';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import type {
  DraftRecord,
  DraftReservation,
  DraftStore,
} from '@/modules/gmail/draft-contracts';
import { responsePromptVersion } from '@/modules/response/prompts';
import { DraftPreconditionError } from '@/modules/gmail/draft-contracts';
import { replySourcesSchema } from '@/modules/response/sources';
import { factualAuditSchema } from '@/modules/response/factual-validation';
import { draftIntentSchema } from '@/modules/gmail/draft-intent';
import { z } from 'zod';
import { responseWarnings } from '@/modules/response/contracts';
import { validMimeMessageId } from '@/modules/gmail/mime';

const columns =
  'id,user_id,gmail_account_id,thread_id,target_message_id,status,draft_id,draft_message_id,verified_at,sent_outcome';
const id = (value: string) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
export function createDraftGenerationRepository(
  client: DataClient,
  userId: string,
  accountId: string,
  job?: {
    id: string;
    leaseId: string;
    threadId: string;
    targetMessageId: string;
  },
): DraftStore {
  requireUuid(userId);
  requireUuid(accountId);
  if (job) {
    requireUuid(job.id);
    requireUuid(job.leaseId);
    if (!id(job.threadId) || !id(job.targetMessageId))
      throw new DataAccessError('INVALID_INPUT');
  }
  const authorize = async (finalizing = false) => {
    const owner = createOwnerRepositories(client, userId);
    const user = requireResource(await owner.users.get());
    if (!finalizing && user.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
    const account = requireResource(
      await owner.gmailAccounts.findById(accountId),
    );
    if (!finalizing && account.status !== 'CONNECTED')
      throw new DataAccessError('FORBIDDEN');
  };
  const checked = (
    row: Pick<
      Tables<'draft_generations'>,
      | 'id'
      | 'user_id'
      | 'gmail_account_id'
      | 'thread_id'
      | 'target_message_id'
      | 'status'
      | 'draft_id'
      | 'draft_message_id'
      | 'verified_at'
      | 'sent_outcome'
    > | null,
  ): DraftRecord | null => {
    if (!row) return null;
    if (
      row.user_id !== userId ||
      row.gmail_account_id !== accountId ||
      !['CREATING', 'CREATED', 'UNCERTAIN', 'CANCELLED'].includes(row.status)
    )
      throw new DataAccessError('UNAVAILABLE');
    return {
      id: row.id,
      threadId: row.thread_id,
      targetMessageId: row.target_message_id,
      status: row.status as DraftRecord['status'],
      draftId: row.draft_id,
      draftMessageId: row.draft_message_id,
      verified: row.verified_at !== null,
      ...(row.sent_outcome &&
      typeof row.sent_outcome === 'object' &&
      !Array.isArray(row.sent_outcome) &&
      row.sent_outcome.status === 'SENT'
        ? { sent: true }
        : {}),
    };
  };
  const scoped = () =>
    client
      .from('draft_generations')
      .select(columns)
      .eq('user_id', userId)
      .eq('gmail_account_id', accountId);
  const find = async (target: string) => {
    if (!id(target)) throw new DataAccessError('INVALID_INPUT');
    await authorize();
    const { data, error } = await scoped()
      .eq('target_message_id', target)
      .maybeSingle();
    if (error) throw new DataAccessError('UNAVAILABLE');
    const row = checked(data);
    if (row && row.targetMessageId !== target)
      throw new DataAccessError('UNAVAILABLE');
    if (row) return row;
    const archived = await client.rpc('find_archived_draft', {
      p_user_id: userId,
      p_account_id: accountId,
      p_target_message_id: target,
    });
    if (archived.error || !archived.data || archived.data.length > 1)
      throw new DataAccessError('UNAVAILABLE');
    const old = archived.data[0];
    if (!old) return null;
    requireUuid(old.id);
    return {
      id: old.id,
      threadId: old.thread_id,
      targetMessageId: target,
      status: 'UNCERTAIN' as const,
      draftId: null,
      draftMessageId: null,
      verified: false,
      ...(old.sent ? { sent: true } : {}),
    };
  };
  const update = async (
    attempt: string,
    values: Partial<Tables<'draft_generations'>>,
    state: string,
  ) => {
    requireUuid(attempt);
    // A pause forbids new writes, but cannot hide IDs already returned by Gmail
    // or prevent recording a known cancellation before the HTTP request.
    await authorize(true);
    const { data, error } = await client
      .from('draft_generations')
      .update(values)
      .eq('user_id', userId)
      .eq('gmail_account_id', accountId)
      .eq('id', attempt)
      .eq('status', state)
      .select(columns)
      .maybeSingle();
    if (error || requireResource(checked(data)).id !== attempt)
      throw new DataAccessError('UNAVAILABLE');
  };
  return Object.freeze<DraftStore>({
    find,
    async reserve(input: DraftReservation) {
      const sources = replySourcesSchema.safeParse(input.sourcesUsed ?? []);
      const warnings = z
        .array(z.enum(responseWarnings))
        .max(responseWarnings.length)
        .refine((items) => new Set(items).size === items.length)
        .safeParse(input.warnings ?? []);
      const intent = draftIntentSchema.optional().safeParse(input.intent);
      const factual = factualAuditSchema
        .optional()
        .safeParse(input.factualValidation);
      requireUuid(input.id);
      if (input.generationRunId) requireUuid(input.generationRunId);
      requireUuid(input.styleRevision);
      if (
        !sources.success ||
        !warnings.success ||
        !intent.success ||
        !factual.success ||
        factual.data?.status === 'REVIEW_REQUIRED' ||
        (input.policyRevision !== undefined &&
          !/^[a-f0-9]{32}$/.test(input.policyRevision)) ||
        (input.knowledgeRevision !== undefined &&
          !/^[a-f0-9]{32}$/.test(input.knowledgeRevision)) ||
        !id(input.threadId) ||
        !id(input.targetMessageId) ||
        (input.envelopeHash !== undefined &&
          !/^[a-f0-9]{64}$/.test(input.envelopeHash)) ||
        (job &&
          (input.threadId !== job.threadId ||
            input.targetMessageId !== job.targetMessageId)) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.model) ||
        ![input.inputTokens, input.outputTokens].every(
          (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647,
        )
      )
        throw new DataAccessError('INVALID_INPUT');
      await authorize();
      const { data, error } = await client
        .from('draft_generations')
        .insert({
          id: input.id,
          delivery_envelope_hash: input.envelopeHash,
          generation_run_id: input.generationRunId,
          user_id: userId,
          gmail_account_id: accountId,
          thread_id: input.threadId,
          target_message_id: input.targetMessageId,
          style_revision: input.styleRevision,
          model: input.model,
          prompt_version: responsePromptVersion,
          input_tokens: input.inputTokens,
          output_tokens: input.outputTokens,
          sources_used: sources.data,
          warnings: warnings.data,
          policy_revision: input.policyRevision,
          knowledge_revision: input.knowledgeRevision,
          factual_validation: factual.data,
          delivery_intent: intent.data,
          email_job_id: job?.id,
        })
        .select(columns)
        .single();
      if (!error) {
        const record = requireResource(checked(data));
        if (
          record.id !== input.id ||
          record.targetMessageId !== input.targetMessageId ||
          record.threadId !== input.threadId ||
          record.status !== 'CREATING'
        )
          throw new DataAccessError('UNAVAILABLE');
        return { acquired: true, record };
      }
      if (error.code !== '23505') throw new DataAccessError('UNAVAILABLE');
      // Both uniqueness constraints arbitrate concurrent processes in Postgres.
      let record = await find(input.targetMessageId);
      if (!record) {
        const result = await scoped()
          .eq('thread_id', input.threadId)
          .in('status', ['CREATING', 'UNCERTAIN'])
          .neq('sent_outcome->>status', 'SENT')
          .maybeSingle();
        if (result.error) throw new DataAccessError('UNAVAILABLE');
        record = checked(result.data);
      }
      if (!record || record.threadId !== input.threadId)
        throw new DataAccessError('UNAVAILABLE');
      return { acquired: false, record };
    },
    async beginWrite(attempt, threadId, targetMessageId) {
      requireUuid(attempt);
      if (
        !id(threadId) ||
        !id(targetMessageId) ||
        (job &&
          (threadId !== job.threadId ||
            targetMessageId !== job.targetMessageId))
      )
        throw new DataAccessError('INVALID_INPUT');
      const { data, error } = await client.rpc('begin_draft_write', {
        p_user_id: userId,
        p_account_id: accountId,
        p_attempt_id: attempt,
        p_thread_id: threadId,
        p_target_message_id: targetMessageId,
        p_job_id: job?.id,
        p_lease_id: job?.leaseId,
      });
      if (error?.message === 'DAILY_DRAFT_LIMIT')
        throw new DraftPreconditionError('DAILY_DRAFT_LIMIT');
      if (error || typeof data !== 'boolean')
        throw new DataAccessError('UNAVAILABLE');
      return data;
    },
    async created(attempt, draftId, messageId) {
      if (!id(draftId) || !id(messageId))
        throw new DataAccessError('INVALID_INPUT');
      await update(
        attempt,
        { status: 'CREATED', draft_id: draftId, draft_message_id: messageId },
        'CREATING',
      );
    },
    async verified(attempt, internetMessageId) {
      if (
        internetMessageId !== undefined &&
        !validMimeMessageId(internetMessageId)
      )
        throw new DataAccessError('INVALID_INPUT');
      await update(
        attempt,
        {
          verified_at: new Date().toISOString(),
          ...(internetMessageId
            ? { draft_internet_message_id: internetMessageId }
            : {}),
        },
        'CREATED',
      );
    },
    async stop(attempt, status, reason, identifiers) {
      if (
        !['UNCERTAIN', 'CANCELLED'].includes(status) ||
        ![
          'THREAD_CHANGED',
          'PREWRITE_FAILED',
          'DAILY_DRAFT_LIMIT',
          'GMAIL_WRITE_UNCERTAIN',
          'PERSISTENCE_FAILED',
          'VERIFICATION_FAILED',
        ].includes(reason) ||
        (status === 'CANCELLED' &&
          !['THREAD_CHANGED', 'PREWRITE_FAILED', 'DAILY_DRAFT_LIMIT'].includes(
            reason,
          )) ||
        (identifiers &&
          (status !== 'UNCERTAIN' ||
            [identifiers.draftId, identifiers.draftMessageId].some(
              (value) => value !== null && !id(value),
            )))
      )
        throw new DataAccessError('INVALID_INPUT');
      await update(
        attempt,
        {
          status,
          reason_code: reason,
          ...(identifiers
            ? {
                draft_id: identifiers.draftId,
                draft_message_id: identifiers.draftMessageId,
              }
            : {}),
        },
        'CREATING',
      );
    },
  });
}
