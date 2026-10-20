import { randomUUID } from 'node:crypto';
import { DataAccessError, requireResource, requireUuid } from './errors';
import type { DataClient } from './models';
import type { Tables } from './database.types';
import { createOwnerRepositories } from './repositories';
import {
  validateWritingProfile,
  validateCurrentWritingProfile,
  WritingProfileError,
} from '@/modules/identity/writing-profile';
import { writingPromptVersion } from '@/modules/identity/analyze-writing';
import {
  normalizeStyleScope,
  sufficientContext,
  type StyleScope,
  type ContextEvidence,
} from '@/modules/identity/contextual-style';

export type WritingProfileWarning =
  'BELOW_RECOMMENDED_SIZE' | 'SAMPLE_CHANGED' | 'INPUT_TRUNCATED';
export type ProfileGeneration = {
  profile: unknown;
  model: string;
  sampleSize: number;
  inputTokens: number;
  outputTokens: number;
  warnings: readonly WritingProfileWarning[];
  sourceMessageIds: readonly string[];
  context?: {
    parentRevision: string;
    evidence: ContextEvidence;
    ruleRevisions?: readonly string[];
  };
};
const columns =
  'id,user_id,gmail_account_id,scope_kind,scope_key,parent_revision,context_evidence,relationship_rule_revisions,generated_at,revision,version,origin,source_message_ids,profile,model,prompt_version,sample_size,input_tokens,output_tokens,warnings,review_status,reviewed_at,created_at,updated_at';
const allowedWarnings: readonly string[] = [
  'BELOW_RECOMMENDED_SIZE',
  'SAMPLE_CHANGED',
  'INPUT_TRUNCATED',
];
function validSources(
  value: unknown,
  size: number,
  allowEmpty = false,
): value is string[] {
  return (
    Array.isArray(value) &&
    (value.length === size || (allowEmpty && value.length === 0)) &&
    value.length <= 500 &&
    value.every(
      (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(id),
    ) &&
    new Set(value).size === value.length
  );
}
const parsed = (row: Tables<'style_profiles'>) => {
  const profile = validateWritingProfile(row.profile);
  const scope = normalizeStyleScope({
    kind: row.scope_kind,
    key: row.scope_key,
  });
  if (
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    row.origin !== 'SENT_HISTORY' ||
    !validSources(
      row.source_message_ids,
      row.sample_size,
      profile.schema_version === 1,
    ) ||
    !Number.isFinite(Date.parse(row.generated_at)) ||
    (scope.kind !== 'GENERAL' &&
      (!row.parent_revision ||
        !sufficientContext(
          scope,
          row.sample_size,
          row.context_evidence as ContextEvidence,
        )))
  )
    throw new DataAccessError('UNAVAILABLE');
  return { ...row, profile };
};

export function createWritingProfileRepository(
  client: DataClient,
  userId: string,
  accountId: string,
  inputScope: StyleScope = { kind: 'GENERAL', key: '' },
) {
  requireUuid(userId);
  requireUuid(accountId);
  const scope = normalizeStyleScope(inputScope);
  const authorize = async () => {
    const owners = createOwnerRepositories(client, userId);
    if ((await owners.users.get())?.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
    const account = requireResource(
      await owners.gmailAccounts.findById(accountId),
    );
    if (account.status !== 'CONNECTED') throw new DataAccessError('FORBIDDEN');
  };
  const checked = (row: Tables<'style_profiles'> | null) => {
    if (
      row &&
      (row.user_id !== userId ||
        row.gmail_account_id !== accountId ||
        row.scope_kind !== scope.kind ||
        row.scope_key !== scope.key)
    )
      throw new DataAccessError('UNAVAILABLE');
    return row ? parsed(row) : null;
  };
  return Object.freeze({
    async get() {
      await authorize();
      const { data, error } = await client
        .from('style_profiles')
        .select(columns)
        .eq('user_id', userId)
        .eq('gmail_account_id', accountId)
        .eq('scope_kind', scope.kind)
        .eq('scope_key', scope.key)
        .maybeSingle();
      if (error) throw new DataAccessError('UNAVAILABLE');
      return checked(data);
    },
    async save(input: ProfileGeneration) {
      const profile = validateCurrentWritingProfile(input.profile);
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.model) ||
        !Number.isInteger(input.sampleSize) ||
        input.sampleSize < 1 ||
        input.sampleSize > 500 ||
        ![input.inputTokens, input.outputTokens].every(
          (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647,
        ) ||
        !Array.isArray(input.warnings) ||
        input.warnings.some((warning) => !allowedWarnings.includes(warning)) ||
        !validSources(input.sourceMessageIds, input.sampleSize)
      )
        throw new DataAccessError('INVALID_INPUT');
      await authorize();
      if (scope.kind !== 'GENERAL') {
        requireUuid(input.context?.parentRevision ?? '');
        const revisions = input.context?.ruleRevisions ?? [];
        if (scope.kind === 'RELATIONSHIP') {
          if (
            !revisions.length ||
            revisions.length > 200 ||
            new Set(revisions).size !== revisions.length
          )
            throw new DataAccessError('INVALID_INPUT');
          for (const revision of revisions) requireUuid(revision);
        } else if (revisions.length) throw new DataAccessError('INVALID_INPUT');
        if (
          !input.context ||
          !sufficientContext(scope, input.sampleSize, input.context.evidence)
        )
          throw new DataAccessError('INVALID_INPUT');
        const general = await createWritingProfileRepository(
          client,
          userId,
          accountId,
        ).get();
        if (!general || general.revision !== input.context.parentRevision)
          throw new WritingProfileError('STALE_REVIEW');
      } else if (input.context) throw new DataAccessError('INVALID_INPUT');
      const { data, error } = await client
        .from('style_profiles')
        .upsert(
          {
            user_id: userId,
            gmail_account_id: accountId,
            scope_kind: scope.kind,
            scope_key: scope.key,
            parent_revision: input.context?.parentRevision ?? null,
            context_evidence: input.context
              ? { ...input.context.evidence }
              : {},
            relationship_rule_revisions: [
              ...(input.context?.ruleRevisions ?? []),
            ].sort(),
            revision: randomUUID(),
            profile: { ...profile },
            origin: 'SENT_HISTORY',
            source_message_ids: [...input.sourceMessageIds],
            model: input.model,
            prompt_version: writingPromptVersion,
            sample_size: input.sampleSize,
            input_tokens: input.inputTokens,
            output_tokens: input.outputTokens,
            warnings: [...new Set(input.warnings)],
            review_status: 'UNREVIEWED',
            reviewed_at: null,
          },
          { onConflict: 'gmail_account_id,scope_kind,scope_key' },
        )
        .select(columns)
        .single();
      if (error) throw new DataAccessError('UNAVAILABLE');
      return requireResource(checked(data));
    },
    async confirm(revision: string) {
      requireUuid(revision);
      await authorize();
      const { data, error } = await client
        .from('style_profiles')
        .update({
          review_status: 'CONFIRMED',
          reviewed_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('gmail_account_id', accountId)
        .eq('scope_kind', scope.kind)
        .eq('scope_key', scope.key)
        .eq('revision', revision)
        .select(columns)
        .maybeSingle();
      if (error) throw new DataAccessError('UNAVAILABLE');
      const row = checked(data);
      if (!row) throw new WritingProfileError('STALE_REVIEW');
      return row;
    },
  });
}
