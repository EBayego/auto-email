import type { ReplySource } from '@/modules/response/sources';

export type DraftState = 'CREATING' | 'CREATED' | 'UNCERTAIN' | 'CANCELLED';
export type DraftReason =
  | 'THREAD_CHANGED'
  | 'PREWRITE_FAILED'
  | 'DAILY_DRAFT_LIMIT'
  | 'GMAIL_WRITE_UNCERTAIN'
  | 'PERSISTENCE_FAILED'
  | 'VERIFICATION_FAILED';
export type DraftRecord = {
  id: string;
  threadId: string;
  targetMessageId: string;
  status: DraftState;
  draftId: string | null;
  draftMessageId: string | null;
  verified: boolean;
};
export type DraftReservation = {
  id: string;
  threadId: string;
  targetMessageId: string;
  styleRevision: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  sourcesUsed?: ReplySource[];
  policyRevision?: string;
  knowledgeRevision?: string;
  factualValidation?: import('@/modules/response/factual-validation').FactualAudit;
  intent?: import('./draft-intent').DraftIntent;
};
export interface DraftStore {
  find(targetMessageId: string): Promise<DraftRecord | null>;
  reserve(
    input: DraftReservation,
  ): Promise<{ acquired: boolean; record: DraftRecord }>;
  beginWrite(
    id: string,
    threadId: string,
    targetMessageId: string,
  ): Promise<boolean>;
  created(id: string, draftId: string, messageId: string): Promise<void>;
  verified(id: string): Promise<void>;
  stop(
    id: string,
    status: 'UNCERTAIN' | 'CANCELLED',
    reason: DraftReason,
    identifiers?: { draftId: string | null; draftMessageId: string | null },
  ): Promise<void>;
}
export type DraftWriteResult = {
  status:
    | 'CREATED'
    | 'CREATED_UNVERIFIED'
    | 'ALREADY_CREATED'
    | 'RECONCILIATION_REQUIRED'
    | 'CANCELLED';
  attemptId: string;
  draftId: string | null;
  draftMessageId: string | null;
  verified: boolean;
  reason?: DraftReason;
};
export class DraftWriteError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'RESPONSE_NOT_READY') {
    super(code);
    this.name = 'DraftWriteError';
  }
}
export class DraftPreconditionError extends Error {
  constructor(
    public readonly reason:
      'THREAD_CHANGED' | 'PREWRITE_FAILED' | 'DAILY_DRAFT_LIMIT',
  ) {
    super(reason);
    this.name = 'DraftPreconditionError';
  }
}
export function existingDraftResult(record: DraftRecord): DraftWriteResult {
  return {
    status:
      record.status === 'CREATED'
        ? 'ALREADY_CREATED'
        : record.status === 'CANCELLED'
          ? 'CANCELLED'
          : 'RECONCILIATION_REQUIRED',
    attemptId: record.id,
    draftId: record.draftId,
    draftMessageId: record.draftMessageId,
    verified: record.verified,
  };
}
