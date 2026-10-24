import {
  ResponseGenerationError,
  type GenerateReplyResult,
  type ResponseGenerationResult,
} from './contracts';
import { replySourcesSchema, type ReplySource } from './sources';

export function finalizeReplyResult(
  response: ResponseGenerationResult,
  subject: string | null,
  historicalReferences: readonly string[],
): GenerateReplyResult {
  const sources: ReplySource[] = response.evidence.map((evidence) => {
    if ('messageIndex' in evidence) {
      const referenceId = historicalReferences[evidence.messageIndex];
      return referenceId
        ? { kind: 'HISTORICAL_MESSAGE', referenceId }
        : {
            kind: 'THREAD_MESSAGE',
            messageIndex: evidence.messageIndex - historicalReferences.length,
          };
    }
    const reference = response.knowledgeReferences?.find(
      (r) => r.knowledgeIndex === evidence.knowledgeIndex,
    );
    if (!reference) throw new ResponseGenerationError('INVALID_RESPONSE');
    return {
      kind: 'KNOWLEDGE_FRAGMENT',
      sourceId: reference.sourceId,
      documentId: reference.documentId,
      version: reference.version,
      chunkId: reference.chunkId,
    };
  });
  const unique = [
    ...new Map(sources.map((s) => [JSON.stringify(s), s])).values(),
  ];
  const checked = replySourcesSchema.safeParse(unique);
  if (!checked.success) throw new ResponseGenerationError('INVALID_RESPONSE');
  return {
    ...response,
    schemaVersion: 1,
    email:
      response.status === 'READY' || response.status === 'PARTIAL'
        ? { subject, bodyText: response.bodyText! }
        : null,
    evaluation: {
      language: response.language,
      needsHumanReview: true,
      needsHumanInput: response.needsHumanInput === true,
      missingInformation: [...response.missingInformation],
      evidence: response.evidence.map((e) => ({ ...e })),
      warnings: [...response.warnings],
    },
    sourcesUsed: checked.data,
  };
}
