import { vi } from 'vitest';
import type { GmailClient, TextGenerationClient } from '@/providers/contracts';
import { writingProfileFixture, profileWork } from './writing-profile';
import { sentEmail, sentMailbox, withHeaders } from './sent-emails';
import {
  type StyleEvaluationCorpus,
  type HumanStyleRating,
} from '@/modules/identity/style-evaluation';
import type { AutomaticStyleRating } from '@/modules/identity/style-evaluation-judge';

export const evaluationNow = new Date('2026-10-19T12:00:00Z');
export const evaluationIdentity = {
  ...profileWork,
  mailboxAddress: 'owner@example.invalid',
};
export function evaluationFixture() {
  const historical = Array.from({ length: 10 }, (_, i) => {
    const threadId = `held-thread-${i}`,
      targetId = `held-target-${i}`,
      replyId = `held-reply-${i}`;
    const target = withHeaders(
      sentEmail(
        200 + i,
        {
          id: targetId,
          threadId,
          labelIds: ['INBOX'],
          internalDate: String(
            new Date('2026-10-08T12:00:00Z').getTime() + i * 86400000,
          ),
        },
        'Hola, por favor confirma que has recibido este mensaje de correo. Gracias.',
      ),
      {
        From: 'contact@example.invalid',
        To: evaluationIdentity.mailboxAddress,
        'Message-ID': `<${targetId}@example.invalid>`,
        Subject: 'Confirmación',
      },
    );
    const reply = withHeaders(
      sentEmail(
        300 + i,
        {
          id: replyId,
          threadId,
          internalDate: String(Number(target.internalDate) + 3600000),
        },
        `Hola, he recibido el mensaje y agradezco que hayas compartido la información. REFERENCIARESERVADA ${i}`,
      ),
      {
        To: 'contact@example.invalid',
        'Message-ID': `<${replyId}@example.invalid>`,
        'In-Reply-To': `<${targetId}@example.invalid>`,
      },
    );
    return { id: threadId, messages: [target, reply] };
  });
  const training = Array.from({ length: 20 }, (_, i) =>
    withHeaders(
      sentEmail(
        i,
        {},
        `Hola, he revisado el formato del documento y la estructura del apartado ${i} queda clara para la siguiente conversación.`,
      ),
      {
        To: 'contact@example.invalid',
        'In-Reply-To': `<train-${i}@example.invalid>`,
      },
    ),
  );
  const mailbox = sentMailbox(training);
  const gmail = {
    ...mailbox,
    getThread: vi.fn<GmailClient['getThread']>(async (id) =>
      structuredClone(historical.find((t) => t.id === id)!),
    ),
    createDraft: vi.fn(),
    listMessages: vi
      .fn<GmailClient['listMessages']>()
      .mockResolvedValue({ messages: [] }),
  };
  let analyses = 0;
  const text = {
    generate: vi.fn<TextGenerationClient['generate']>(async (request) => {
      if (request.jsonSchema?.name === 'writing_profile_v2')
        return {
          text: JSON.stringify({
            ...writingProfileFixture(),
            formality: analyses++ ? 'high' : 'medium',
          }),
          inputTokens: 30,
          outputTokens: 20,
        };
      if (request.jsonSchema?.name === 'response_verification_v1')
        return {
          text: JSON.stringify({ verdict: 'SUPPORTED', issues: [] }),
          inputTokens: 10,
          outputTokens: 5,
        };
      if (request.jsonSchema?.name === 'style_evaluation_judge_v1') {
        const input = JSON.parse(request.input);
        return {
          text: JSON.stringify({
            ratings: input.candidates.map(
              (candidate: { label: string; bodyText: string }) => ({
                label: candidate.label,
                assessment: syntheticAutomaticRating(
                  candidate.bodyText.startsWith('Estimado')
                    ? 5
                    : candidate.bodyText.startsWith('Buenos')
                      ? 3
                      : 2,
                ),
              }),
            ),
          }),
          inputTokens: 40,
          outputTokens: 35,
        };
      }
      const input = JSON.parse(request.input);
      const bodyText =
        input.conversation.style?.formality === 'high'
          ? 'Estimado,\n\nConfirmo la recepción de tu mensaje y agradezco la información.\n\nAtentamente.'
          : input.conversation.style
            ? 'Buenos días,\n\nHe recibido tu mensaje. Gracias por escribirme.\n\nUn saludo.'
            : 'He recibido tu mensaje de correo. Gracias por escribirme.';
      return {
        text: JSON.stringify({
          status: 'READY',
          bodyText,
          language: 'es',
          missingInformation: [],
          evidence: [],
          warnings: [],
        }),
        inputTokens: 25,
        outputTokens: 15,
      };
    }),
  };
  const corpus: StyleEvaluationCorpus = {
    version: 1,
    ...profileWork,
    seed: 'synthetic-mail028',
    createdAt: evaluationNow.toISOString(),
    expiresAt: '2027-01-01T00:00:00Z',
    cases: historical.map((thread) => ({
      threadId: thread.id,
      targetMessageId: thread.messages[0].id,
      replyMessageId: thread.messages[1].id,
    })),
    training: {
      after: '2025-10-19T12:00:00Z',
      before: evaluationNow.toISOString(),
      targetSize: 200,
      sourceMessages: training.map(({ id, threadId }) => ({ id, threadId })),
    },
  };
  return {
    gmail,
    text,
    corpus,
    identity: evaluationIdentity,
    now: evaluationNow,
    model: 'synthetic-test-model',
    historical,
    training,
  };
}
export const syntheticRating = (
  score: number,
  extra: Partial<HumanStyleRating> = {},
): HumanStyleRating => ({
  scores: {
    greeting: score,
    formality: score,
    vocabulary: score,
    length: score,
    language: score,
  },
  acceptable: score >= 3,
  safe: true,
  factors: [],
  ...extra,
});
export const syntheticAutomaticRating = (
  score: number,
  extra: Partial<AutomaticStyleRating> = {},
): AutomaticStyleRating => ({
  ...syntheticRating(score),
  additionalScores: { closing: score, warmth: score, helpfulness: score },
  confidence: 'high',
  ...extra,
});
