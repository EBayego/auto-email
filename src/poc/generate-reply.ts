import type { GmailClient, TextGenerationClient } from '@/providers/contracts';
import {
  selectPendingEmail,
  type ManualSelectionInput,
  type ManualSelectionReport,
  type PreparedReplyContext,
} from '@/modules/gmail/manual-selection';
import {
  createResponseGenerator,
  ResponseGenerationError,
  type ResponseGenerationResult,
} from '@/modules/response/generator';
import { responsePromptVersion } from '@/modules/response/prompts';
import type { SentSampleManifest } from '@/modules/identity/sent-sample';
import {
  createStyleExampleRetriever,
  type StyleExampleRetriever,
} from '@/modules/identity/style-example-retriever';

export type ReplyGenerationReport = {
  selection: ManualSelectionReport;
  generation: {
    status: ResponseGenerationResult['status'];
    language: string;
    warnings: ResponseGenerationResult['warnings'];
    missingInformationCount: number;
    evidenceCount: number;
    bodyCharacters: number;
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
    examplesUsed: number;
    promptVersion: string;
    styleExamplesUnavailable: boolean;
  } | null;
};
export async function generateReplyForThread(input: {
  gmail: Pick<GmailClient, 'getThread' | 'getMessage' | 'listMessages'>;
  text: TextGenerationClient;
  selection: ManualSelectionInput;
  sample?: SentSampleManifest | null;
  styleExamplesLimit?: number;
  styleExampleRetriever?: StyleExampleRetriever;
  userInstructions?: readonly string[];
  now?: Date;
  shouldGenerate?: (context: PreparedReplyContext) => Promise<boolean>;
  consume?: (
    response: ResponseGenerationResult,
    context: PreparedReplyContext,
  ) => Promise<void>;
}): Promise<ReplyGenerationReport> {
  if (!input.selection.style)
    throw new ResponseGenerationError('STYLE_PROFILE_REQUIRED');
  const limit = input.styleExamplesLimit ?? 3;
  if (!Number.isInteger(limit) || limit < 0 || limit > 3)
    throw new ResponseGenerationError('INVALID_INPUT');
  let generation: ReplyGenerationReport['generation'] = null;
  const selection = await selectPendingEmail(
    input.gmail,
    input.selection,
    async (context) => {
      if (input.shouldGenerate && !(await input.shouldGenerate(context)))
        return;
      const retriever =
        input.styleExampleRetriever ??
        createStyleExampleRetriever({
          gmail: input.gmail,
          sample: input.sample,
          identity: {
            accountId: context.accountId,
            mailboxAddress: input.selection.mailboxAddress,
            aliases: input.selection.aliases,
          },
        });
      const examples = limit
        ? await retriever.retrieve({
            accountId: context.accountId,
            recipient: context.replyTarget.to.address,
            threadId: context.threadId,
            subject: context.modelInput.subject,
            text: context.modelInput.messages.find(
              (message) => message.isTarget,
            )!.text,
            before: context.styleExampleBefore
              ? new Date(context.styleExampleBefore)
              : input.now,
            profile: context.modelInput.style,
            preferredMessageIds: context.styleExampleMessageIds,
            language: context.stylePreferences?.preferences.find(
              (p) => p.key === 'language' && p.value !== 'recipient',
            )?.value,
            limit,
            now: input.now,
          })
        : [];
      try {
        const response = await createResponseGenerator(input.text).generate({
          conversation: context.modelInput,
          styleExamples: examples,
          userInstructions: input.userInstructions,
          stylePreferences: context.stylePreferences?.preferences,
        });
        generation = {
          status: response.status,
          language: response.language,
          warnings: response.warnings,
          missingInformationCount: response.missingInformation.length,
          evidenceCount: response.evidence.length,
          bodyCharacters: response.bodyText?.length ?? 0,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          modelCalls: response.modelCalls,
          examplesUsed: response.examplesUsed,
          promptVersion: responsePromptVersion,
          styleExamplesUnavailable: limit > 0 && examples.length === 0,
        };
        if (input.consume) await input.consume(response, context);
      } finally {
        examples.length = 0;
      }
    },
  );
  return { selection, generation };
}
