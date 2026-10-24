import type {
  GenerateReplyInput,
  ResponseGenerationResult,
  ResponseEvidence,
} from '@/modules/response/contracts';
import {
  assessEvidence,
  matchingAnswer,
} from '@/modules/knowledge/sufficiency';
import { knowledgeCurrency } from '@/modules/knowledge/provenance';
import { normalizeSourceTopic } from '@/modules/source-router/route-sources';
import {
  defaultResponsePolicySettings,
  normalizeResponsePolicySettings,
  responsePolicyVersion,
  policyContextSchema,
  type ResponsePolicyEvaluation,
  type ResponsePolicySettings,
} from './settings';
import { normalizeClassifierAddress } from '@/modules/classifier/rules';
import {
  responseInputHasInjection,
  responseOutputHasInjection,
} from '@/modules/security/prompt-injection';

type Reason = ResponsePolicyEvaluation['reasons'][number];
const normalize = (text: string) =>
  normalizeSourceTopic(text.replace(/\p{Cf}/gu, ''));
const globalPatterns: [Reason, RegExp][] = [
  [
    'PAYMENT_REQUIRES_REVIEW',
    /\b(?:iban|cuenta bancaria|bank account|transferencia bancaria|wire transfer|realiza el pago|realizar el pago|confirma el pago|confirmar el pago|pago realizado|payment confirmation|payment confirmed|pagar|abonaremos|we will pay)\b/u,
  ],
  [
    'CONTRACT_REQUIRES_REVIEW',
    /\b(?:firmar|firma|firmamos|acepta|aceptar|aceptamos|aprobar|aprobamos|accept|sign|approve)\b.{0,60}\b(?:contrato|contract|acuerdo|agreement|oferta|offer)\b|\b(?:compromiso contractual|asesoria juridica|legal advice)\b/u,
  ],
  [
    'DISCOUNT_REQUIRES_REVIEW',
    /\b(?:descuento|descuentos|rebaja|discount|discounts|rebate)\b/u,
  ],
  [
    'SENSITIVE_CATEGORY',
    /\b(?:diagnostico medico|medicacion|historia clinica|tratamiento medico|medical diagnosis|medical treatment|nomina|despido|salary|hiring decision|seleccion de personal)\b/u,
  ],
];
const deadline =
  /\b(?:plazo|plazos|fecha de entrega|entregaremos|entregare|entrega sera|recibiras|lo tendras|estara listo|deadline|turnaround|we will deliver|we will ship|ready by|delivery takes)\b/u;
const commitment =
  /\b(?:confirmo la reunion|confirmamos la reunion|reunion confirmada|estoy disponible|estamos disponibles|i am available|we are available|meeting confirmed|i confirm the meeting|we confirm the meeting|nos comprometemos|me comprometo|we will|i will|enviaremos|revisaremos)\b/u;
const transformation =
  /\b(?:resume|resumir|compara|comparar|corrige|corregir|traduce|traducir|summarize|translate|proofread)\b/u;
const targetText = (input: GenerateReplyInput) =>
  input.conversation.messages.find((m) => m.isTarget)?.text ?? '';
const categories = (input: GenerateReplyInput) => {
  const text = normalize(targetText(input));
  const result = new Set<string>(
    input.policyContext?.category ? [input.policyContext.category] : [],
  );
  for (const category of input.policyContext?.additionalCategories ?? [])
    result.add(category);
  if (/[?¿]/u.test(targetText(input))) result.add('REQUEST_INFORMATION');
  if (/\b(?:confirma|confirmar|confirm|confirmacion|confirmame)\b/u.test(text))
    result.add('CONFIRMATION');
  if (
    /\b(?:reunion|cita|meeting|appointment|disponibilidad|availability)\b/u.test(
      text,
    )
  )
    result.add('MEETING');
  if (/\b(?:contrato|contract|legal|juridico)\b/u.test(text))
    result.add('LEGAL_CONTRACT');
  if (
    /\b(?:pago|pagos|payment|payments|iban|transferencia|bank account)\b/u.test(
      text,
    )
  )
    result.add('FINANCIAL');
  return result;
};
const evaluation = (
  phase: ResponsePolicyEvaluation['phase'],
  reasons: Reason[],
): ResponsePolicyEvaluation => {
  const unique = [...new Set(reasons)];
  return {
    version: responsePolicyVersion,
    phase,
    action: !unique.length
      ? 'ALLOW_DRAFT'
      : unique.some((r) =>
            [
              'SENDER_BLOCKED',
              'CATEGORY_BLOCKED',
              'TOPIC_BLOCKED',
              'PROMPT_INJECTION',
            ].includes(r),
          )
        ? 'BLOCK'
        : 'REVIEW_REQUIRED',
    reasons: unique,
  };
};

function citedKnowledge(
  input: GenerateReplyInput,
  response: ResponseGenerationResult,
  e: ResponseEvidence,
) {
  if (!('knowledgeIndex' in e)) return undefined;
  const reference = response.knowledgeReferences?.find(
    (r) => r.knowledgeIndex === e.knowledgeIndex,
  );
  return reference
    ? input.knowledge?.find(
        (f) =>
          f.chunk_id === reference.chunkId &&
          f.document_id === reference.documentId &&
          f.source_id === reference.sourceId &&
          f.version === reference.version,
      )
    : undefined;
}
function validCitation(
  input: GenerateReplyInput,
  response: ResponseGenerationResult,
  e: ResponseEvidence,
) {
  if (
    !response.bodyText ||
    !normalize(response.bodyText).includes(normalize(e.claim))
  )
    return false;
  if ('knowledgeIndex' in e) {
    const fragment = citedKnowledge(input, response, e);
    return (
      !!fragment &&
      !['EXPIRED', 'NOT_YET_VALID'].includes(
        knowledgeCurrency(fragment, new Date().toISOString().slice(0, 10)),
      ) &&
      normalize(fragment.content).includes(normalize(e.quote))
    );
  }
  const messages = [
    ...(input.historicalContext ?? []).map((m) => ({ ...m, isTarget: false })),
    ...input.conversation.messages,
  ];
  const message = messages[e.messageIndex];
  return (
    !!message &&
    normalize(message.text).includes(normalize(e.quote)) &&
    ((message.speaker === 'owner' && input.allowEmailHistory === true) ||
      (message.isTarget && transformation.test(normalize(targetText(input)))))
  );
}

export interface ResponsePolicyEngine {
  preflight(
    input: GenerateReplyInput,
    options?: { checkSources?: boolean; checkCategories?: boolean },
  ): ResponsePolicyEvaluation;
  postflight(
    input: GenerateReplyInput,
    response: ResponseGenerationResult,
  ): ResponsePolicyEvaluation;
}
export function createResponsePolicyEngine(
  settings: ResponsePolicySettings = defaultResponsePolicySettings(),
): ResponsePolicyEngine {
  const rules = normalizeResponsePolicySettings(settings);
  const globalReasons = (text: string): Reason[] =>
    globalPatterns.flatMap(([reason, pattern]) =>
      pattern.test(normalize(text)) ? [reason] : [],
    );
  return Object.freeze({
    preflight(
      input: GenerateReplyInput,
      options: { checkSources?: boolean; checkCategories?: boolean } = {},
    ) {
      const reasons = globalReasons(targetText(input));
      if (responseInputHasInjection(input)) reasons.push('PROMPT_INJECTION');
      if (!policyContextSchema.safeParse(input.policyContext ?? {}).success)
        return evaluation('PREFLIGHT', ['POLICY_CONTEXT_REQUIRED']);
      const detected = categories(input);
      if (detected.has('FINANCIAL')) reasons.push('PAYMENT_REQUIRES_REVIEW');
      if (detected.has('LEGAL_CONTRACT'))
        reasons.push('CONTRACT_REQUIRES_REVIEW');
      if (
        input.policyContext?.riskFlags?.some((r) =>
          [
            'FINANCIAL',
            'LEGAL_CONTRACT',
            'SENSITIVE_DATA',
            'HUMAN_DECISION',
            'GROUP_RECIPIENTS',
            'ATTACHMENT_REQUIRED',
          ].includes(r),
        )
      )
        reasons.push('SENSITIVE_CATEGORY');
      if (input.policyContext?.riskFlags?.includes('PROMPT_INJECTION'))
        reasons.push('PROMPT_INJECTION');
      const sender = input.policyContext?.sender
        ? normalizeClassifierAddress(input.policyContext.sender)
        : undefined;
      if (
        !sender &&
        (rules.blockedSenders.length || rules.blockedDomains.length)
      )
        reasons.push('POLICY_CONTEXT_REQUIRED');
      if (
        sender &&
        (rules.blockedSenders.includes(sender) ||
          rules.blockedDomains.some(
            (d) =>
              sender.endsWith(`@${d}`) ||
              sender.slice(sender.lastIndexOf('@') + 1).endsWith(`.${d}`),
          ))
      )
        reasons.push('SENDER_BLOCKED');
      if (rules.blockedCategories.some((c) => detected.has(c)))
        reasons.push('CATEGORY_BLOCKED');
      if (
        options.checkCategories !== false &&
        rules.blockedCategories.length &&
        !input.policyContext?.category
      )
        reasons.push('POLICY_CONTEXT_REQUIRED');
      const text = ` ${normalize(`${input.conversation.subject ?? ''} ${targetText(input)}`)} `;
      if (
        rules.blockedTopics.some((topic) =>
          text.includes(` ${normalize(topic)} `),
        )
      )
        reasons.push('TOPIC_BLOCKED');
      if (options.checkSources !== false && rules.sourceRequirements.length) {
        const requested = assessEvidence({
          question: targetText(input),
          fragments: input.knowledge ?? [],
        });
        for (const rule of rules.sourceRequirements) {
          if (!requested.requirements.some((r) => r.kind === rule.kind))
            continue;
          const supported = assessEvidence({
            question: targetText(input),
            fragments: (input.knowledge ?? []).filter((f) =>
              rule.sourceIds.includes(f.source_id),
            ),
          });
          if (
            supported.requirements.some(
              (r) => r.kind === rule.kind && r.status !== 'SUPPORTED',
            )
          )
            reasons.push('REQUIRED_SOURCE_MISSING');
        }
      }
      return evaluation('PREFLIGHT', reasons);
    },
    postflight(input: GenerateReplyInput, response: ResponseGenerationResult) {
      if (
        responseInputHasInjection(input) ||
        responseOutputHasInjection(response) ||
        response.warnings.includes('PROMPT_INJECTION')
      )
        return evaluation('POSTFLIGHT', ['PROMPT_INJECTION']);
      if (!response.bodyText || !['READY', 'PARTIAL'].includes(response.status))
        return evaluation('POSTFLIGHT', []);
      const reasons = globalReasons(response.bodyText);
      const body = normalize(response.bodyText);
      if (
        rules.blockedTopics.some((topic) =>
          ` ${body} `.includes(` ${normalize(topic)} `),
        )
      )
        reasons.push('TOPIC_BLOCKED');
      if (/\b(?:contrato|contract|acuerdo contractual)\b/u.test(body))
        reasons.push('CONTRACT_REQUIRES_REVIEW');
      if (
        /\b(?:pago|pagos|payment|payments|iban|cuenta bancaria|bank account)\b/u.test(
          body,
        )
      )
        reasons.push('PAYMENT_REQUIRES_REVIEW');
      for (const clause of response.bodyText
        .split(/[.!?\n]+/u)
        .filter((c) => commitment.test(normalize(c)))) {
        if (
          !response.evidence.some(
            (e) =>
              'messageIndex' in e &&
              validCitation(input, response, e) &&
              (normalize(clause).includes(normalize(e.claim)) ||
                normalize(e.claim).includes(normalize(clause))),
          )
        )
          reasons.push('UNVERIFIED_COMMITMENT');
      }
      for (const clause of response.bodyText
        .split(/[.!?\n]+/u)
        .filter((c) => deadline.test(normalize(c)))) {
        if (
          !response.evidence.some(
            (e) =>
              validCitation(input, response, e) &&
              (normalize(clause).includes(normalize(e.claim)) ||
                normalize(e.claim).includes(normalize(clause))),
          )
        )
          reasons.push('UNVERIFIED_DEADLINE');
      }
      const requested = assessEvidence({
        question: targetText(input),
        fragments: input.knowledge ?? [],
      });
      for (const rule of rules.sourceRequirements) {
        const requirements = requested.requirements.filter(
          (r) => r.kind === rule.kind,
        );
        for (const requirement of requirements) {
          if (
            !response.evidence.some((e) => {
              const fragment = citedKnowledge(input, response, e);
              if (
                !fragment ||
                !rule.sourceIds.includes(fragment.source_id) ||
                !validCitation(input, response, e) ||
                !matchingAnswer(rule.kind, requirement.question, e.claim)
              )
                return false;
              return assessEvidence({
                question: requirement.question,
                fragments: [{ ...fragment, content: e.quote }],
              }).requirements.some(
                (r) => r.kind === rule.kind && r.status === 'SUPPORTED',
              );
            })
          )
            reasons.push('REQUIRED_SOURCE_MISSING');
        }
      }
      return evaluation('POSTFLIGHT', reasons);
    },
  });
}
