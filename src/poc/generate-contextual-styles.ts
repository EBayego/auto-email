import type { GmailClient, TextGenerationClient } from '@/providers/contracts';
import type { SentSampleManifest } from '@/modules/identity/sent-sample';
import { withSavedSentSample } from '@/modules/identity/saved-sample';
import { analyzeWriting } from '@/modules/identity/analyze-writing';
import {
  groupContextualSamples,
  styleVariations,
  ContextualStyleError,
  type RelationshipRule,
  type StyleScope,
} from '@/modules/identity/contextual-style';
import type { WritingProfile } from '@/modules/identity/writing-profile';
import type { ProfileGeneration } from '@/db/writing-profiles';

export async function generateContextualStyles(input: {
  gmail: Pick<GmailClient, 'getMessage'>;
  text: TextGenerationClient;
  manifest: SentSampleManifest;
  mailboxAddress: string;
  aliases?: readonly string[];
  model: string;
  general: { revision: string; profile: WritingProfile };
  rules: readonly RelationshipRule[];
  ruleRevisions?: readonly string[];
  save: (
    scope: StyleScope,
    generation: ProfileGeneration,
  ) => Promise<{ revision: string; version: number }>;
  now?: Date;
}) {
  if (!input.general)
    throw new ContextualStyleError('GENERAL_PROFILE_REQUIRED');
  const report: {
    generated: number;
    eligibleMessages: number;
    profiles: {
      kind: StyleScope['kind'];
      revision: string;
      version: number;
      sampleSize: number;
      variations: ReturnType<typeof styleVariations>;
    }[];
  } = { generated: 0, eligibleMessages: 0, profiles: [] };
  await withSavedSentSample(
    input.gmail,
    input.manifest,
    { mailboxAddress: input.mailboxAddress, aliases: input.aliases },
    async (messages) => {
      report.eligibleMessages = messages.length;
      const groups = groupContextualSamples(messages, input.rules);
      try {
        for (const group of groups) {
          const generated = await analyzeWriting(input.text, group.messages);
          const saved = await input.save(group.scope, {
            ...generated,
            model: input.model,
            sampleSize: group.messages.length,
            sourceMessageIds: group.messages.map((m) => m.id),
            warnings: generated.truncatedMessages ? ['INPUT_TRUNCATED'] : [],
            context: {
              parentRevision: input.general.revision,
              evidence: group.evidence,
              ...(group.scope.kind === 'RELATIONSHIP'
                ? { ruleRevisions: input.ruleRevisions ?? [] }
                : {}),
            },
          });
          report.profiles.push({
            kind: group.scope.kind,
            revision: saved.revision,
            version: saved.version,
            sampleSize: group.messages.length,
            variations: styleVariations(
              input.general.profile,
              generated.profile,
            ),
          });
          report.generated++;
        }
      } finally {
        for (const group of groups) group.messages.length = 0;
      }
    },
    input.now,
    { includeRecipientContext: true },
  );
  return report;
}
