import type { GmailClient } from '@/providers/contracts';
import {
  prepareSentSample,
  type SentSampleManifest,
  type StyleSampleMessage,
} from './sent-sample';
import { WritingProfileError } from './writing-profile';

export async function withSavedSentSample(
  client: Pick<GmailClient, 'getMessage'>,
  manifest: SentSampleManifest,
  identity: { mailboxAddress: string; aliases?: readonly string[] },
  consume: (messages: readonly StyleSampleMessage[]) => Promise<void>,
  now = new Date(),
  options: { includeRecipientContext?: boolean } = {},
) {
  const seen = new Set<string>();
  if (
    manifest.version !== 1 ||
    !Number.isFinite(Date.parse(manifest.expiresAt)) ||
    Date.parse(manifest.expiresAt) <= now.getTime() ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    Date.parse(manifest.createdAt) > now.getTime() ||
    !manifest.sourceMessages.length ||
    manifest.sourceMessages.length > 500 ||
    manifest.sourceMessages.some((ref) => {
      if (
        !/^[A-Za-z0-9_-]{1,512}$/.test(ref.id) ||
        !/^[A-Za-z0-9_-]{1,512}$/.test(ref.threadId) ||
        seen.has(ref.id)
      )
        return true;
      seen.add(ref.id);
      return false;
    })
  )
    throw new WritingProfileError('SAMPLE_REQUIRED');
  let listingWindow: number | undefined;
  // Supply only the recorded references. The existing sampler revalidates SENT,
  // authorship, dates and bodies without listing any other part of the mailbox.
  const savedClient: Pick<GmailClient, 'listMessages' | 'getMessage'> = {
    getMessage: (id, options) => {
      if (!seen.has(id)) throw new WritingProfileError('SAMPLE_REQUIRED');
      return client.getMessage(id, options);
    },
    async listMessages(options = {}) {
      listingWindow ??= options.after!.getTime();
      if (options.after!.getTime() !== listingWindow) return { messages: [] };
      const start = Number(options.pageToken ?? 0);
      const end = start + (options.maxResults ?? 25);
      return {
        messages: manifest.sourceMessages.slice(start, end),
        ...(end < manifest.sourceMessages.length
          ? { nextPageToken: String(end) }
          : {}),
      };
    },
  };
  return prepareSentSample(
    savedClient,
    {
      ...identity,
      includeRecipientContext: options.includeRecipientContext,
      after: new Date(manifest.window.after),
      before: new Date(manifest.window.before),
      targetSize: manifest.targetSize,
    },
    consume,
    now,
  );
}
