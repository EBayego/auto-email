import type { GmailClient, TextGenerationClient } from '@/providers/contracts';
import type { SentSampleManifest } from '@/modules/identity/sent-sample';
import { withSavedSentSample } from '@/modules/identity/saved-sample';
import { analyzeWriting } from '@/modules/identity/analyze-writing';
import { WritingProfileError } from '@/modules/identity/writing-profile';
import type {
  createWritingProfileRepository,
  WritingProfileWarning,
} from '@/db/writing-profiles';

export async function generateWritingProfile(input: {
  gmail: Pick<GmailClient, 'getMessage'>;
  text: TextGenerationClient;
  manifest: SentSampleManifest;
  mailboxAddress: string;
  aliases?: readonly string[];
  model: string;
  repository: Pick<ReturnType<typeof createWritingProfileRepository>, 'save'>;
  now?: Date;
}) {
  let generated: Awaited<ReturnType<typeof analyzeWriting>> | undefined;
  let sampleSize = 0;
  await withSavedSentSample(
    input.gmail,
    input.manifest,
    { mailboxAddress: input.mailboxAddress, aliases: input.aliases },
    async (messages) => {
      sampleSize = messages.length;
      if (!sampleSize) throw new WritingProfileError('EMPTY_SAMPLE');
      generated = await analyzeWriting(input.text, messages);
    },
    input.now,
  );
  if (!generated) throw new WritingProfileError('EMPTY_SAMPLE');
  const warnings: WritingProfileWarning[] = [];
  if (sampleSize < 200) warnings.push('BELOW_RECOMMENDED_SIZE');
  if (sampleSize !== input.manifest.sourceMessages.length)
    warnings.push('SAMPLE_CHANGED');
  if (generated.truncatedMessages) warnings.push('INPUT_TRUNCATED');
  return input.repository.save({
    ...generated,
    model: input.model,
    sampleSize,
    warnings,
  });
}
