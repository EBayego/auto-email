import type { GmailClient, TextGenerationClient } from '@/providers/contracts';
import { createResponseGenerator } from '@/modules/response/generator';
import {
  createReplyOrchestrator,
  type ReplyGenerationReport,
  type ReplyOrchestrationInput,
  type ReplyOrchestratorDependencies,
} from '@/modules/response/orchestrator';
import type { SentSampleManifest } from '@/modules/identity/sent-sample';
import {
  createStyleExampleRetriever,
  type StyleExampleRetriever,
} from '@/modules/identity/style-example-retriever';
export type { ReplyGenerationReport } from '@/modules/response/orchestrator';

export async function generateReplyForThread(
  input: ReplyOrchestrationInput & {
    gmail: Pick<GmailClient, 'getThread' | 'getMessage' | 'listMessages'>;
    text: TextGenerationClient;
    sample?: SentSampleManifest | null;
    styleExampleRetriever?: StyleExampleRetriever;
    retrieveKnowledge?: ReplyOrchestratorDependencies['retrieveKnowledge'];
    policy?: ReplyOrchestratorDependencies['policy'];
    factualValidation?: ReplyOrchestratorDependencies['factualValidation'];
  },
): Promise<ReplyGenerationReport> {
  const orchestrator = createReplyOrchestrator({
    gmail: input.gmail,
    generator: createResponseGenerator(input.text),
    styleExamples:
      input.styleExampleRetriever ??
      createStyleExampleRetriever({
        gmail: input.gmail,
        sample: input.sample,
        identity: {
          accountId: input.selection.accountId,
          mailboxAddress: input.selection.mailboxAddress,
          aliases: input.selection.aliases,
        },
      }),
    retrieveKnowledge: input.retrieveKnowledge,
    policy: input.policy,
    factualValidation: input.factualValidation,
  });
  const { selection, generation } = await orchestrator.generate(input);
  return { selection, generation };
}
