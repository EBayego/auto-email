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
import { loadStyleExamples } from '@/modules/identity/style-examples';
import { WritingProfileError } from '@/modules/identity/writing-profile';

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
  gmail: Pick<GmailClient, 'getThread' | 'getMessage'>;
  text: TextGenerationClient;
  selection: ManualSelectionInput;
  sample?: SentSampleManifest | null;
  styleExamplesLimit?: number;
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
      let examples: { text: string }[] = [];
      try {
        examples = await loadStyleExamples(
          input.gmail,
          input.sample ?? null,
          {
            mailboxAddress: input.selection.mailboxAddress,
            aliases: input.selection.aliases,
          },
          limit,
          input.now,
        );
      } catch (error) {
        // Missing/expired references are optional. Credential and provider failures
        // still stop the operation rather than bypassing an authorization problem.
        if (!(
          error instanceof WritingProfileError &&
          error.code === 'SAMPLE_REQUIRED'
        ))
          throw error;
      }
      try {
        const response = await createResponseGenerator(input.text).generate({
          conversation: context.modelInput,
          styleExamples: examples,
          userInstructions: input.userInstructions,
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
