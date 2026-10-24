import type { PreparedReplyContext } from '@/modules/gmail/manual-selection';
import type {
  ResponsePolicyEvaluation,
  ResponsePolicySnapshot,
} from './settings';

export interface ResponsePolicyAccess {
  classify?(
    context: PreparedReplyContext,
  ): Promise<
    Pick<
      import('@/modules/classifier/contracts').EmailClassification,
      'intent' | 'riskFlags'
    >
  >;
  load(context: PreparedReplyContext): Promise<ResponsePolicySnapshot>;
  record(
    context: PreparedReplyContext,
    evaluation: ResponsePolicyEvaluation,
    evaluationId: string,
    revision: string,
  ): Promise<void>;
}
