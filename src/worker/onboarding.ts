import { prepareSentSample } from '@/modules/identity/sent-sample';
import { analyzeWriting } from '@/modules/identity/analyze-writing';
import {
  analysisScopeSchema,
  OnboardingError,
} from '@/modules/identity/onboarding';
import { WritingProfileError } from '@/modules/identity/writing-profile';
import { GmailCredentialError } from '@/modules/gmail/credentials';
import { ProviderError } from '@/providers/errors';
import type { GmailClient, TextGenerationClient } from '@/providers/contracts';
import type { AnalysisJob, createOnboardingWorkerStore } from '@/db/onboarding';
import type { OwnedWorkItem } from './data-access';
import type { WritingProfileWarning } from '@/db/writing-profiles';

export type OnboardingEvent = {
  type: 'ONBOARDING_COMPLETED' | 'ONBOARDING_FAILED';
  reasonCode?: string;
};

export function analysisErrorCode(error: unknown) {
  if (error instanceof WritingProfileError)
    return error.code === 'EMPTY_SAMPLE' ? 'EMPTY_SAMPLE' : 'INVALID_PROFILE';
  if (error instanceof GmailCredentialError)
    return error.code === 'REAUTH_REQUIRED'
      ? 'REAUTH_REQUIRED'
      : error.code === 'PAUSED' || error.code === 'NOT_CONNECTED'
        ? 'NOT_CONNECTED'
        : 'PROVIDER_UNAVAILABLE';
  if (error instanceof ProviderError)
    return error.provider === 'google' &&
      [
        'AUTHENTICATION_FAILED',
        'INVALID_GRANT',
        'ACCESS_TOKEN_REJECTED',
        'PERMISSION_DENIED',
      ].includes(error.code)
      ? 'REAUTH_REQUIRED'
      : 'PROVIDER_UNAVAILABLE';
  if (error instanceof OnboardingError && error.code === 'CANCELLED')
    return 'CANCELLED';
  return 'UNAVAILABLE';
}
export async function runOnboardingAnalysis(input: {
  store: ReturnType<typeof createOnboardingWorkerStore>;
  clientsFor(
    work: OwnedWorkItem,
    assertActive: () => Promise<void>,
  ): Promise<{
    gmail: Pick<GmailClient, 'listMessages' | 'getMessage'>;
    text: TextGenerationClient;
    mailboxAddress: string;
    model: string;
  }>;
  signal?: AbortSignal;
  report?: (event: OnboardingEvent) => void;
}) {
  if (input.signal?.aborted) return { failed: false };
  const job: AnalysisJob | null = await input.store.claim();
  if (!job) return { failed: false };
  let phase: 'SAMPLING' | 'ANALYZING' = 'SAMPLING',
    scanned = 0,
    selected = 0;
  const assertActive = async () => {
    if (input.signal?.aborted) throw new OnboardingError('CANCELLED');
    await input.store.advance(job, phase, scanned, selected);
  };
  try {
    if (
      !job.gmail_account_id ||
      !job.lease_id ||
      job.consent_version !== 'mail051-v1'
    )
      throw new OnboardingError('CANCELLED');
    const scope = analysisScopeSchema.parse(job.scope);
    await assertActive();
    const clients = await input.clientsFor(
      { userId: job.user_id, gmailAccountId: job.gmail_account_id },
      assertActive,
    );
    let generated: Awaited<ReturnType<typeof analyzeWriting>> | undefined;
    const seen = new Set<string>();
    const manifest = await prepareSentSample(
      {
        async listMessages(options) {
          await assertActive();
          return clients.gmail.listMessages(options);
        },
        async getMessage(id, options) {
          await assertActive();
          const result = await clients.gmail.getMessage(id, options);
          if (options?.format === 'metadata') {
            seen.add(id);
            scanned = seen.size;
          }
          return result;
        },
      },
      {
        mailboxAddress: clients.mailboxAddress,
        after: new Date(scope.after),
        before: new Date(scope.before),
        targetSize: 200,
        maxCandidates: scope.maxCandidates,
        excludedAddresses: scope.excludedAddresses,
        excludedDomains: scope.excludedDomains,
      },
      async (messages) => {
        if (!messages.length) throw new WritingProfileError('EMPTY_SAMPLE');
        selected = messages.length;
        phase = 'ANALYZING';
        await assertActive();
        generated = await analyzeWriting(
          {
            generate: async (request) => {
              await assertActive();
              return clients.text.generate(request);
            },
          },
          messages,
        );
      },
    );
    scanned = manifest.statistics.scanned;
    await assertActive();
    if (!generated) throw new WritingProfileError('EMPTY_SAMPLE');
    const warnings: WritingProfileWarning[] = [];
    if (selected < 200) warnings.push('BELOW_RECOMMENDED_SIZE');
    if (generated.truncatedMessages) warnings.push('INPUT_TRUNCATED');
    await input.store.finish(job, {
      generation: {
        ...generated,
        model: clients.model,
        sampleSize: selected,
        sourceMessageIds: manifest.sourceMessages.map((message) => message.id),
        warnings,
      },
    });
    input.report?.({ type: 'ONBOARDING_COMPLETED' });
    return { failed: false };
  } catch (error) {
    const code = analysisErrorCode(error);
    try {
      await input.store.finish(job, { error: code });
    } catch {
      /* A cancelled or expired lease cannot publish a result. */
    }
    input.report?.({ type: 'ONBOARDING_FAILED', reasonCode: code });
    return { failed: code !== 'CANCELLED' };
  }
}
