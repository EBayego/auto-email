import type {
  GenerateReplyInput,
  GenerateReplyResult,
  ResponseWarning,
} from '@/modules/response/contracts';
import { finalizeReplyResult } from '@/modules/response/result';
import type { ResponsePolicyEvaluation } from './settings';

export function applyResponsePolicy(
  input: GenerateReplyInput,
  evaluations: ResponsePolicyEvaluation[],
  response?: GenerateReplyResult,
): GenerateReplyResult {
  const denied = evaluations.find((e) => e.action !== 'ALLOW_DRAFT');
  if (!denied && response)
    return { ...response, policyEvaluations: evaluations };
  const warnings = new Set<ResponseWarning>(response?.warnings ?? []);
  warnings.add('HUMAN_REVIEW_REQUIRED');
  warnings.add('POLICY_RESTRICTED');
  if (evaluations.some((e) => e.reasons.includes('PROMPT_INJECTION')))
    warnings.add('PROMPT_INJECTION');
  if (
    evaluations.some((e) =>
      e.reasons.some((r) => /REQUIRES_REVIEW|SENSITIVE_CATEGORY/.test(r)),
    )
  )
    warnings.add('HIGH_RISK');
  return finalizeReplyResult(
    {
      ...response,
      status: denied?.action === 'BLOCK' ? 'BLOCKED' : 'INSUFFICIENT_CONTEXT',
      bodyText: null,
      language: response?.language ?? 'und',
      evidence: [],
      knowledgeReferences: [],
      sourcesUsed: [],
      warnings: [...warnings],
      missingInformation:
        denied?.action === 'BLOCK'
          ? []
          : [
              ...new Set([
                ...(response?.factualValidation?.missingInformation ?? []),
                'Se necesita revisión de las políticas o autorización del titular.',
              ]),
            ].slice(0, 8),
      inputTokens: response?.inputTokens ?? 0,
      outputTokens: response?.outputTokens ?? 0,
      modelCalls: response?.modelCalls ?? 0,
      examplesUsed: response?.examplesUsed ?? 0,
      needsHumanInput: true,
      policyEvaluations: evaluations,
    },
    input.conversation.subject,
    [],
  );
}
