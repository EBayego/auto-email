import { createHash } from 'node:crypto';
import type { GmailClient, GmailThread } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { ConversationError } from '@/modules/gmail/conversation';
import { validateManualSelection } from '@/modules/gmail/manual-selection';
import { ResponseGenerationError } from '@/modules/response/contracts';
import { buildReplyMime } from '@/modules/gmail/reply-mime';
import { parseGmailMessage } from '@/modules/gmail/parser';
import { normalizeEmailText } from '@/modules/gmail/email-content';
import {
  generateReplyForThread,
  type ReplyGenerationReport,
} from './generate-reply';

export const validationOutcomes = [
  'READY',
  'NO_REPLY_REQUIRED',
  'INSUFFICIENT_CONTEXT',
  'BLOCKED',
  'REVIEW_REQUIRED',
  'ALREADY_ANSWERED',
  'EXISTING_DRAFT',
  'NO_CANDIDATE',
  'SUPERSEDED',
] as const;
export type ValidationOutcome = (typeof validationOutcomes)[number];
export type ValidationCase = {
  threadId: string;
  targetMessageId?: string;
  expected: ValidationOutcome;
};
type Finding = {
  category: 'CONTEXT' | 'STYLE' | 'INTEGRATION' | 'INSTRUCTIONS';
  code:
    | 'UNEXPECTED_OUTCOME'
    | 'THREAD_CHANGED'
    | 'MIME_MISMATCH'
    | 'EXECUTION_FAILED';
};
export type ValidationCaseResult = {
  threadId: string;
  targetMessageId: string | null;
  expected: ValidationOutcome;
  actual: ValidationOutcome | 'ERROR';
  passed: boolean;
  unchanged: boolean | null;
  draftCountBefore: number | null;
  draftCountAfter: number | null;
  sentCountBefore: number | null;
  sentCountAfter: number | null;
  mimeChecked: boolean;
  humanReview: 'REQUIRED' | 'NOT_APPLICABLE';
  findings: Finding[];
  errorCode:
    | 'PROVIDER_ERROR'
    | 'CONTEXT_ERROR'
    | 'INVALID_MODEL_OUTPUT'
    | 'EXECUTION_FAILED'
    | null;
  report: ReplyGenerationReport | null;
};
export class PocValidationError extends Error {
  constructor() {
    super('INVALID_INPUT');
    this.name = 'PocValidationError';
  }
}
export function validateCases(cases: readonly ValidationCase[]) {
  if (
    !Array.isArray(cases) ||
    cases.length < 10 ||
    cases.length > 20 ||
    new Set(cases.map((item) => item?.threadId)).size !== cases.length ||
    cases.some(
      (item) =>
        !item ||
        typeof item.threadId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,512}$/.test(item.threadId) ||
        (item.targetMessageId !== undefined &&
          (typeof item.targetMessageId !== 'string' ||
            !/^[A-Za-z0-9_-]{1,512}$/.test(item.targetMessageId))) ||
        !validationOutcomes.includes(item.expected),
    )
  )
    throw new PocValidationError();
}
function snapshot(thread: GmailThread) {
  return {
    // Attachment download tokens can rotate between two read-only requests.
    // Preserve their presence and all content/metadata, not the opaque token.
    hash: createHash('sha256')
      .update(
        JSON.stringify(thread, (key, value) => {
          if (key === 'attachmentId') return Boolean(value);
          if (key === 'labelIds' && Array.isArray(value))
            return [...value].sort();
          if (value && typeof value === 'object' && !Array.isArray(value))
            return Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((name) => [name, value[name]]),
            );
          return value;
        }),
      )
      .digest('hex'),
    drafts: thread.messages.filter((message) =>
      message.labelIds?.includes('DRAFT'),
    ).length,
    sent: thread.messages.filter((message) =>
      message.labelIds?.includes('SENT'),
    ).length,
  };
}
function outcome(report: ReplyGenerationReport): ValidationOutcome {
  if (report.generation) {
    if (
      report.generation.status === 'BLOCKED' &&
      report.generation.warnings.includes('NO_REPLY_REQUIRED')
    )
      return 'NO_REPLY_REQUIRED';
    return report.generation.status;
  }
  if (report.selection.status === 'FILTERED_OUT') return 'NO_REPLY_REQUIRED';
  if (report.selection.status === 'SELECTED') throw new PocValidationError();
  return report.selection.status;
}
export async function validateReplySamples(
  input: Omit<
    Parameters<typeof generateReplyForThread>[0],
    'selection' | 'gmail' | 'shouldGenerate'
  > & {
    gmail: Pick<GmailClient, 'getThread' | 'getMessage'>;
    selection: Omit<
      Parameters<typeof generateReplyForThread>[0]['selection'],
      'threadId' | 'targetMessageId'
    >;
    cases: readonly ValidationCase[];
    onCase?: (result: ValidationCaseResult) => void;
  },
) {
  validateCases(input.cases);
  if (!input.selection.style)
    throw new ResponseGenerationError('STYLE_PROFILE_REQUIRED');
  for (const item of input.cases)
    validateManualSelection({ ...input.selection, ...item });
  const cases: ValidationCaseResult[] = [];
  for (const item of input.cases) {
    const result: ValidationCaseResult = {
      threadId: item.threadId,
      targetMessageId: item.targetMessageId ?? null,
      expected: item.expected,
      actual: 'ERROR',
      passed: false,
      unchanged: null,
      draftCountBefore: null,
      draftCountAfter: null,
      sentCountBefore: null,
      sentCountAfter: null,
      mimeChecked: false,
      humanReview: 'NOT_APPLICABLE',
      findings: [],
      errorCode: null,
      report: null,
    };
    let before: ReturnType<typeof snapshot> | null = null;
    try {
      const thread = await input.gmail.getThread(item.threadId, {
        format: 'full',
      });
      if (thread.id !== item.threadId)
        throw new ConversationError('INVALID_THREAD');
      before = snapshot(thread);
      result.draftCountBefore = before.drafts;
      result.sentCountBefore = before.sent;
      // Expose read capabilities only. Even a full GmailClient supplied by the
      // operator cannot enable writes in this evaluation path.
      const gmail = Object.freeze({
        getThread: async () => thread,
        getMessage: input.gmail.getMessage.bind(input.gmail),
      });
      result.report = await generateReplyForThread({
        ...input,
        gmail,
        selection: { ...input.selection, ...item },
        consume: async (response, context) => {
          if (response.status === 'READY') {
            result.humanReview = 'REQUIRED';
            const mime = buildReplyMime({
              from: input.selection.mailboxAddress,
              target: context.replyTarget,
              bodyText: response.bodyText!,
              attemptId: '00000000-0000-4000-8000-000000000022',
              now: input.now,
            });
            const decoded = await parseGmailMessage({
              id: 'validation-only',
              threadId: item.threadId,
              labelIds: ['DRAFT'],
              raw: mime.raw,
            });
            result.mimeChecked =
              decoded.to.length === 1 &&
              decoded.to[0].address.toLowerCase() ===
                context.replyTarget.to.address.toLowerCase() &&
              decoded.cc.length === 0 &&
              decoded.bcc.length === 0 &&
              decoded.attachments.length === 0 &&
              (decoded.subject ?? '') === mime.subject &&
              decoded.inReplyTo.length === 1 &&
              decoded.inReplyTo[0] === context.replyTarget.inReplyTo &&
              JSON.stringify(decoded.references) ===
                JSON.stringify(mime.references) &&
              decoded.bodyText === normalizeEmailText(response.bodyText!);
            if (!result.mimeChecked)
              result.findings.push({
                category: 'INTEGRATION',
                code: 'MIME_MISMATCH',
              });
          }
          if (input.consume) await input.consume(response, context);
        },
      });
      result.targetMessageId = result.report.selection.targetMessageId;
      result.actual = outcome(result.report);
      if (result.actual !== item.expected)
        result.findings.push({
          category: result.report.generation?.warnings.includes(
            'LANGUAGE_MISMATCH',
          )
            ? 'STYLE'
            : 'INSTRUCTIONS',
          code: 'UNEXPECTED_OUTCOME',
        });
    } catch (error) {
      result.errorCode =
        error instanceof ProviderError
          ? 'PROVIDER_ERROR'
          : error instanceof ConversationError
            ? 'CONTEXT_ERROR'
            : error instanceof ResponseGenerationError
              ? 'INVALID_MODEL_OUTPUT'
              : 'EXECUTION_FAILED';
      result.findings.push({
        category:
          result.errorCode === 'CONTEXT_ERROR'
            ? 'CONTEXT'
            : result.errorCode === 'INVALID_MODEL_OUTPUT'
              ? 'INSTRUCTIONS'
              : 'INTEGRATION',
        code: 'EXECUTION_FAILED',
      });
    } finally {
      if (before) {
        try {
          const afterThread = await input.gmail.getThread(item.threadId, {
            format: 'full',
          });
          if (afterThread.id !== item.threadId) {
            result.findings.push({
              category: 'INTEGRATION',
              code: 'EXECUTION_FAILED',
            });
          } else {
            const after = snapshot(afterThread);
            result.unchanged = before.hash === after.hash;
            result.draftCountAfter = after.drafts;
            result.sentCountAfter = after.sent;
            if (!result.unchanged)
              result.findings.push({
                category: 'INTEGRATION',
                code: 'THREAD_CHANGED',
              });
          }
        } catch {
          result.findings.push({
            category: 'INTEGRATION',
            code: 'EXECUTION_FAILED',
          });
        }
      }
    }
    result.passed =
      result.actual === result.expected &&
      result.unchanged === true &&
      result.findings.length === 0;
    cases.push(result);
    input.onCase?.(result);
  }
  return {
    version: 1 as const,
    mode: 'READ_ONLY' as const,
    evaluated: cases.length,
    passed: cases.filter((item) => item.passed).length,
    failed: cases.filter((item) => !item.passed).length,
    unchanged: cases.filter((item) => item.unchanged === true).length,
    readyForHumanReview: cases.filter((item) => item.humanReview === 'REQUIRED')
      .length,
    inputTokens: cases.reduce(
      (n, item) => n + (item.report?.generation?.inputTokens ?? 0),
      0,
    ),
    outputTokens: cases.reduce(
      (n, item) => n + (item.report?.generation?.outputTokens ?? 0),
      0,
    ),
    modelCalls: cases.reduce(
      (n, item) => n + (item.report?.generation?.modelCalls ?? 0),
      0,
    ),
    findings: Object.fromEntries(
      ['CONTEXT', 'STYLE', 'INTEGRATION', 'INSTRUCTIONS'].map((category) => [
        category,
        cases
          .flatMap((item) => item.findings)
          .filter((finding) => finding.category === category).length,
      ]),
    ),
    cases,
  };
}
