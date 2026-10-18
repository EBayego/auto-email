import { randomUUID } from 'node:crypto';
import { DataAccessError, requireResource, requireUuid } from './errors';
import type { DataClient } from './models';
import type { Tables } from './database.types';
import { createOwnerRepositories } from './repositories';
import {
  validateWritingProfile,
  WritingProfileError,
} from '@/modules/identity/writing-profile';
import { writingPromptVersion } from '@/modules/identity/analyze-writing';

export type WritingProfileWarning =
  'BELOW_RECOMMENDED_SIZE' | 'SAMPLE_CHANGED' | 'INPUT_TRUNCATED';
export type ProfileGeneration = {
  profile: unknown;
  model: string;
  sampleSize: number;
  inputTokens: number;
  outputTokens: number;
  warnings: readonly WritingProfileWarning[];
};
const columns =
  'id,user_id,gmail_account_id,revision,profile,model,prompt_version,sample_size,input_tokens,output_tokens,warnings,review_status,reviewed_at,created_at,updated_at';
const allowedWarnings: readonly string[] = [
  'BELOW_RECOMMENDED_SIZE',
  'SAMPLE_CHANGED',
  'INPUT_TRUNCATED',
];
const parsed = (row: Tables<'style_profiles'>) => ({
  ...row,
  profile: validateWritingProfile(row.profile),
});

export function createWritingProfileRepository(
  client: DataClient,
  userId: string,
  accountId: string,
) {
  requireUuid(userId);
  requireUuid(accountId);
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
    if (row && (row.user_id !== userId || row.gmail_account_id !== accountId))
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
        .maybeSingle();
      if (error) throw new DataAccessError('UNAVAILABLE');
      return checked(data);
    },
    async save(input: ProfileGeneration) {
      const profile = validateWritingProfile(input.profile);
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.model) ||
        !Number.isInteger(input.sampleSize) ||
        input.sampleSize < 1 ||
        input.sampleSize > 500 ||
        ![input.inputTokens, input.outputTokens].every(
          (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647,
        ) ||
        !Array.isArray(input.warnings) ||
        input.warnings.some((warning) => !allowedWarnings.includes(warning))
      )
        throw new DataAccessError('INVALID_INPUT');
      await authorize();
      const { data, error } = await client
        .from('style_profiles')
        .upsert(
          {
            user_id: userId,
            gmail_account_id: accountId,
            revision: randomUUID(),
            profile: { ...profile },
            model: input.model,
            prompt_version: writingPromptVersion,
            sample_size: input.sampleSize,
            input_tokens: input.inputTokens,
            output_tokens: input.outputTokens,
            warnings: [...new Set(input.warnings)],
            review_status: 'UNREVIEWED',
            reviewed_at: null,
          },
          { onConflict: 'gmail_account_id' },
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
