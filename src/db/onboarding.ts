import type { DataClient } from './models';
import { DataAccessError, requireUuid } from './errors';
import {
  OnboardingError,
  analysisScopeSchema,
  type OnboardingRecord,
  type OnboardingOperation,
} from '@/modules/identity/onboarding';
import type { Tables } from './database.types';
import type { ProfileGeneration } from './writing-profiles';
import { validateCurrentWritingProfile } from '@/modules/identity/writing-profile';
import { writingPromptVersion } from '@/modules/identity/analyze-writing';
import {
  assertPrivacyAuthorized,
  enforcePrivacyConfiguration,
} from './privacy';

const publicColumns =
  'consent_revision,consent_version,consented_at,scope,status,scanned,selected,profile_revision,error_code,lease_expires_at,started_at,finished_at';
const known = [
  'CONSENT_REQUIRED',
  'STALE_CONSENT',
  'ANALYSIS_BUSY',
  'NOT_CONNECTED',
  'INVALID_INPUT',
  'FORBIDDEN',
];
function failure(error: { message?: string } | null) {
  if (!error) return;
  const code = known.find((value) => error.message === value);
  if (code === 'FORBIDDEN') throw new DataAccessError('FORBIDDEN');
  throw new OnboardingError((code ?? 'UNAVAILABLE') as OnboardingError['code']);
}
export function createUserOnboardingRepository(
  reader: DataClient,
  writer: DataClient,
  userId: string,
) {
  requireUuid(userId);
  return Object.freeze({
    async get(): Promise<OnboardingRecord | null> {
      const { data, error } = await reader
        .from('gmail_onboarding')
        .select(publicColumns)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new DataAccessError('UNAVAILABLE');
      if (!data) return null;
      const scope = analysisScopeSchema.safeParse(data.scope);
      if (!scope.success) throw new DataAccessError('UNAVAILABLE');
      const expired =
        ['SAMPLING', 'ANALYZING'].includes(data.status) &&
        Date.parse(data.lease_expires_at ?? '') <= Date.now();
      return {
        ...data,
        scope: scope.data,
        ...(expired
          ? { status: 'FAILED', error_code: 'ANALYSIS_INTERRUPTED' }
          : {}),
      };
    },
    async apply(operation: OnboardingOperation) {
      if (operation.action === 'start')
        await assertPrivacyAuthorized(writer, userId);
      const { data, error } =
        operation.action === 'consent'
          ? await writer.rpc('save_onboarding_consent', {
              p_user_id: userId,
              p_scope: operation.scope,
              p_version: operation.version,
              p_consented: operation.consent,
            })
          : await writer.rpc('control_onboarding_analysis', {
              p_user_id: userId,
              p_revision: operation.revision,
              p_action: operation.action === 'start' ? 'START' : 'CANCEL',
            });
      failure(error);
      if (!data) throw new OnboardingError('UNAVAILABLE');
    },
  });
}
export type AnalysisJob = Tables<'gmail_onboarding'>;
export function createOnboardingWorkerStore(client: DataClient) {
  return Object.freeze({
    async claim(): Promise<AnalysisJob | null> {
      await enforcePrivacyConfiguration(client);
      const { data, error } = await client.rpc('claim_onboarding_analysis');
      failure(error);
      return data?.[0] ?? null;
    },
    async advance(
      job: AnalysisJob,
      phase: 'SAMPLING' | 'ANALYZING',
      scanned: number,
      selected: number,
    ) {
      // Repeating this checkpoint with the same lease and counters is safe.
      // The database rechecks consent, account state and lease expiry each time.
      for (let attempt = 0; ; attempt++) {
        const { data, error, status } = await client.rpc(
          'advance_onboarding_analysis',
          {
            p_user_id: job.user_id,
            p_lease_id: job.lease_id!,
            p_phase: phase,
            p_scanned: scanned,
            p_selected: selected,
          },
        );
        const transient =
          error &&
          (status === 0 ||
            status === 429 ||
            status >= 500 ||
            ['40001', '40P01', '57014', 'PGRST003'].includes(error.code));
        if (transient && attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 250 * (attempt + 1)),
          );
          continue;
        }
        failure(error);
        if (!data) throw new OnboardingError('CANCELLED');
        break;
      }
    },
    async finish(
      job: AnalysisJob,
      result: { error: string } | { generation: ProfileGeneration },
    ) {
      const generation = 'generation' in result ? result.generation : null;
      const { data, error } = await client.rpc('finish_onboarding_analysis', {
        p_user_id: job.user_id,
        p_lease_id: job.lease_id!,
        ...('error' in result ? { p_error: result.error } : {}),
        ...(generation
          ? {
              p_generation: {
                profile: {
                  ...validateCurrentWritingProfile(generation.profile),
                },
                model: generation.model,
                promptVersion: writingPromptVersion,
                sampleSize: generation.sampleSize,
                inputTokens: generation.inputTokens,
                outputTokens: generation.outputTokens,
                warnings: [...generation.warnings],
                sourceMessageIds: [...generation.sourceMessageIds],
              },
            }
          : {}),
      });
      failure(error);
      if (!data) throw new OnboardingError('CANCELLED');
    },
  });
}
