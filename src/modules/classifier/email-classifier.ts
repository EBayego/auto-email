import { EmailParseError } from '@/modules/gmail/email';
import { ProviderError } from '@/providers/errors';
import { parseGmailMessage } from '@/modules/gmail/parser';
import {
  classifierLimits,
  EmailClassificationError,
  type ClassifierDependencies,
  type ClassifyEmailInput,
  type EmailClassifier,
  type ClassificationReason,
  type EmailClassification,
} from './contracts';
import {
  classificationResult,
  classifierMetadataHeaders,
  inspectClassifierMetadata,
  normalizeClassifierAddress,
  normalizeClassifierExclusions,
} from './rules';
import { classificationJsonSchema, parseModelClassification } from './schema';
import { classifierInstructions, classifierPromptVersion } from './prompts';
import { hasPromptInjection } from '@/modules/security/prompt-injection';

export type {
  EmailClassifier,
  EmailClassification,
  ClassifyEmailInput,
  ClassifierExclusions,
} from './contracts';
export { EmailClassificationError } from './contracts';

export function createEmailClassifier({
  gmail,
  text,
  propagateProviderErrors = false,
}: ClassifierDependencies): EmailClassifier {
  return Object.freeze({
    async classify(input: ClassifyEmailInput) {
      if (!input || !/^[A-Za-z0-9_-]{1,512}$/.test(input.messageId ?? ''))
        throw new EmailClassificationError('INVALID_INPUT');
      const mailbox = normalizeClassifierAddress(input.mailboxAddress);
      const exclusions = normalizeClassifierExclusions(input.exclusions);
      const metadata = await gmail.getMessage(input.messageId, {
        format: 'metadata',
        metadataHeaders: classifierMetadataHeaders,
      });
      if (metadata.id !== input.messageId)
        return classificationResult('UNCERTAIN', ['MESSAGE_CHANGED']);
      try {
        const inspected = inspectClassifierMetadata(
          metadata,
          mailbox,
          exclusions,
        );
        if (inspected.result) return inspected.result;
        const full = await gmail.getMessage(input.messageId, {
          format: 'full',
        });
        if (full.id !== metadata.id || full.threadId !== metadata.threadId)
          return classificationResult('UNCERTAIN', ['MESSAGE_CHANGED']);
        const current = inspectClassifierMetadata(full, mailbox, exclusions);
        if (current.result) return current.result;
        const email = await parseGmailMessage(full);
        if (
          email.bodyStatus === 'incomplete' ||
          email.warnings.includes('AMBIGUOUS_QUOTE')
        )
          return classificationResult('UNCERTAIN', ['INCOMPLETE_CONTENT']);
        if (!email.authoredText.trim())
          return classificationResult('UNCERTAIN', ['EMPTY_CONTENT']);
        if (
          (email.subject?.length ?? 0) > classifierLimits.subjectCharacters ||
          email.authoredText.length > classifierLimits.bodyCharacters
        )
          return classificationResult('UNCERTAIN', ['CONTENT_LIMIT_EXCEEDED']);
        if (hasPromptInjection(`${email.subject ?? ''}\n${email.authoredText}`))
          return classificationResult('UNCERTAIN', ['PROMPT_INJECTION'], {
            riskFlags: ['PROMPT_INJECTION'],
          });
        let usage = { modelCalls: 1, inputTokens: 0, outputTokens: 0 };
        try {
          const generated = await text.generate({
            instructions: classifierInstructions,
            input: JSON.stringify({
              version: classifierPromptVersion,
              subject: email.subject,
              text: email.authoredText,
              hasAttachments: email.attachments.some(
                (attachment) => !attachment.inline,
              ),
              signals: {
                hasUnsubscribe: current.hasUnsubscribe,
                automated: current.automated,
              },
            }),
            jsonSchema: {
              name: 'email_classification',
              schema: classificationJsonSchema,
            },
          });
          if (
            ![generated.inputTokens, generated.outputTokens].every(
              (n) => Number.isSafeInteger(n) && n >= 0,
            ) ||
            (generated.attempts !== undefined &&
              (!Number.isInteger(generated.attempts) ||
                generated.attempts < 1 ||
                generated.attempts > 10))
          )
            return classificationResult(
              'UNCERTAIN',
              ['INVALID_MODEL_RESPONSE'],
              { source: 'MODEL', ...usage },
            );
          usage = {
            modelCalls: generated.attempts ?? 1,
            inputTokens: generated.inputTokens,
            outputTokens: generated.outputTokens,
          };
          const classified = parseModelClassification(generated.text);
          if (!classified)
            return classificationResult(
              'UNCERTAIN',
              ['INVALID_MODEL_RESPONSE'],
              { source: 'MODEL', ...usage },
            );
          const reasons: ClassificationReason[] = [...classified.reasons];
          const risks = new Set(classified.riskFlags);
          if (classified.intent === 'FINANCIAL') risks.add('FINANCIAL');
          if (classified.intent === 'LEGAL_CONTRACT')
            risks.add('LEGAL_CONTRACT');
          if (
            classified.needsAttachment ||
            reasons.includes('ATTACHMENT_REQUIRED')
          ) {
            risks.add('ATTACHMENT_REQUIRED');
            reasons.push('ATTACHMENT_REQUIRED');
          }
          if (reasons.includes('PROMPT_INJECTION'))
            risks.add('PROMPT_INJECTION');
          if (risks.has('PROMPT_INJECTION')) reasons.push('PROMPT_INJECTION');
          let decision: EmailClassification['decision'] = classified.decision;
          if (classified.confidence === 'LOW') {
            decision = 'UNCERTAIN';
            reasons.push('LOW_CONFIDENCE');
          }
          if (
            classified.intent === 'UNKNOWN' &&
            decision === 'REPLY_REQUIRED'
          ) {
            decision = 'UNCERTAIN';
            reasons.push('AMBIGUOUS_INTENT');
          }
          if (
            risks.size ||
            reasons.some((reason) =>
              [
                'INSUFFICIENT_CONTEXT',
                'AMBIGUOUS_INTENT',
                'HIGH_RISK',
              ].includes(reason),
            )
          ) {
            decision = 'UNCERTAIN';
            if (risks.size) reasons.push('HIGH_RISK');
          }
          return classificationResult(decision, reasons, {
            intent: classified.intent,
            riskFlags: [...risks],
            needsAttachment:
              classified.needsAttachment || risks.has('ATTACHMENT_REQUIRED'),
            source: 'MODEL',
            ...usage,
          });
        } catch (error) {
          if (propagateProviderErrors && error instanceof ProviderError)
            throw error;
          return classificationResult('UNCERTAIN', ['MODEL_UNAVAILABLE'], {
            source: 'MODEL',
            ...usage,
          });
        }
      } catch (error) {
        if (!(error instanceof EmailParseError)) throw error;
        return classificationResult('UNCERTAIN', ['INVALID_MESSAGE']);
      }
    },
  });
}
