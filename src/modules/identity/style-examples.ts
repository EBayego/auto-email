import type { GmailClient } from '@/providers/contracts';
import { SentSampleError, type SentSampleManifest } from './sent-sample';
import { withSavedSentSample } from './saved-sample';

export async function loadStyleExamples(
  client: Pick<GmailClient, 'getMessage'>,
  manifest: SentSampleManifest | null,
  identity: { mailboxAddress: string; aliases?: readonly string[] },
  limit = 3,
  now = new Date(),
): Promise<{ text: string }[]> {
  if (!Number.isInteger(limit) || limit < 0 || limit > 3)
    throw new SentSampleError('INVALID_INPUT');
  if (!limit || !manifest?.sourceMessages.length) return [];
  const examples: { text: string }[] = [];
  const subset = {
    ...manifest,
    sourceMessages: manifest.sourceMessages.slice(0, limit),
  };
  await withSavedSentSample(
    client,
    subset,
    identity,
    async (messages) => {
      for (const message of messages) {
        const text = message.authoredText;
        examples.push({
          text:
            text.length <= 2000
              ? text
              : text.slice(0, 980) +
                '\n[fragmento omitido]\n' +
                text.slice(-980),
        });
      }
    },
    now,
  );
  return examples;
}
