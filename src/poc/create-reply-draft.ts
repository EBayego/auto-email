import type { GmailClient } from '@/providers/contracts';
import { createDraftWriter } from '@/modules/gmail/draft-writer';
import {
  existingDraftResult,
  type DraftStore,
  type DraftWriteResult,
} from '@/modules/gmail/draft-contracts';
import { generateReplyForThread } from './generate-reply';

export async function createReplyDraftForThread(
  input: Omit<
    Parameters<typeof generateReplyForThread>[0],
    'consume' | 'gmail'
  > & {
    gmail: Pick<
      GmailClient,
      'getThread' | 'getMessage' | 'listMessages' | 'createDraft'
    >;
    store: DraftStore;
    model: string;
  },
) {
  let draft: DraftWriteResult | null = null;
  const report = await generateReplyForThread({
    ...input,
    shouldGenerate: async (context) => {
      const existing = await input.store.find(context.targetMessageId);
      if (!existing) return true;
      draft = existingDraftResult(existing);
      return false;
    },
    consume: async (response, context) => {
      if (response.status !== 'READY') return;
      draft = await createDraftWriter(input).create({
        selection: input.selection,
        context,
        response,
        model: input.model,
        now: input.now,
      });
    },
  });
  if (!draft && report.selection.targetMessageId) {
    const existing = await input.store.find(report.selection.targetMessageId);
    if (existing) draft = existingDraftResult(existing);
  }
  return { ...report, draft };
}
