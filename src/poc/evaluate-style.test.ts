import { describe, expect, it, vi } from 'vitest';
import {
  evaluationFixture,
  syntheticRating,
} from '../../tests/fixtures/style-evaluation';
import { evaluateHistoricalStyle, type BlindStyleCase } from './evaluate-style';
import {
  loadHistoricalStyleCase,
  prepareStyleEvaluationCorpus,
} from './style-evaluation-corpus';
import { prepareSentSample } from '@/modules/identity/sent-sample';
import { withHeaders, sentMailbox } from '../../tests/fixtures/sent-emails';
import { ProviderError } from '@/providers/errors';

describe('MAIL-028 comparación histórica sin contaminación', () => {
  it('aplica preferencias explícitas solo a los brazos personalizados y registra la condición del experimento', async () => {
    const f = evaluationFixture();
    const preferences = [
      {
        scope: { kind: 'GENERAL', key: '' },
        preference: { key: 'warmth', value: 'warm' },
        revision: '00000000-0000-4000-8000-000000000001',
        origin: 'EXPLICIT',
      },
      {
        scope: { kind: 'GENERAL', key: '' },
        preference: { key: 'help_offer', value: 'natural' },
        revision: '00000000-0000-4000-8000-000000000002',
        origin: 'EXPLICIT',
      },
    ] as const;
    const report = await evaluateHistoricalStyle({
      ...f,
      examples: 0,
      preferences,
    });
    const requests = f.text.generate.mock.calls
      .filter(
        ([request]) => request.jsonSchema?.name === 'generated_response_v1',
      )
      .map(([request]) => JSON.parse(request.input));
    expect(
      requests
        .filter((request) => request.conversation.style)
        .every((request) => request.stylePreferences.length === 2),
    ).toBe(true);
    expect(
      requests
        .filter((request) => !request.conversation.style)
        .every((request) => request.stylePreferences.length === 0),
    ).toBe(true);
    expect(report.personalizationPreferences).toBe(
      'EXPLICIT_IN_PERSONALIZED_VARIANTS',
    );
    expect(report.cases[0].appliedPreferences).toEqual(
      expect.arrayContaining([
        { key: 'warmth', value: 'warm' },
        { key: 'help_offer', value: 'natural' },
      ]),
    );
    expect(JSON.stringify(requests)).not.toContain('REFERENCIARESERVADA');
  });
  it('evalúa automáticamente sin preguntas, sin filtrar referencias al generador y sin inventar validación humana', async () => {
    const f = evaluationFixture();
    const progress = vi.fn();
    const report = await evaluateHistoricalStyle({
      ...f,
      examples: 0,
      automaticReview: true,
      progress,
    });
    expect(report.automaticEvaluator).toMatchObject({
      modelCalls: 10,
      model: f.model,
      calibration: 'NOT_HUMAN_CALIBRATED',
    });
    expect(report.summary).toMatchObject({
      humanReview: 'PENDING',
      pairedCases: 0,
      automatic: {
        status: 'COMPLETE',
        pairedCases: 10,
        recommendation: 'CONTEXTUAL',
        automaticallyChangesMvp: false,
      },
    });
    expect(
      report.cases.every(
        (item) =>
          !item.humanReviewPerformed &&
          item.variants.every((v) => !v.human && v.automatic),
      ),
    ).toBe(true);
    expect(
      JSON.stringify(
        f.text.generate.mock.calls.filter(
          ([request]) =>
            request.jsonSchema?.name !== 'style_evaluation_judge_v1',
        ),
      ),
    ).not.toContain('REFERENCIARESERVADA');
    expect(JSON.stringify(report)).not.toMatch(
      /REFERENCIARESERVADA|contact@example/,
    );
    expect(progress).toHaveBeenLastCalledWith({
      completedCases: 10,
      totalCases: 10,
    });
    expect(f.gmail.createDraft).not.toHaveBeenCalled();
  });
  it('rechaza mezclar modos automáticos y humanos antes de consultar el historial', async () => {
    const f = evaluationFixture();
    await expect(
      evaluateHistoricalStyle({ ...f, automaticReview: true, review: vi.fn() }),
    ).rejects.toMatchObject({ code: 'INVALID_EVALUATION' });
    expect(f.gmail.getThread).not.toHaveBeenCalled();
  });
  it('prepara un conjunto de referencias reservado y separa hilos completos sin llamar al modelo', async () => {
    const f = evaluationFixture();
    const sample = await prepareSentSample(
      sentMailbox(f.training),
      { mailboxAddress: f.identity.mailboxAddress },
      undefined,
      f.now,
    );
    sample.sourceMessages.push({
      id: f.corpus.cases[0].replyMessageId,
      threadId: f.corpus.cases[0].threadId,
    });
    const corpus = await prepareStyleEvaluationCorpus({
      gmail: f.gmail,
      identity: f.identity,
      sample,
      cases: f.corpus.cases,
      seed: f.corpus.seed,
      now: f.now,
    });
    expect(corpus.training.sourceMessages).toHaveLength(20);
    expect(
      corpus.training.sourceMessages.some(
        (ref) => ref.threadId === f.corpus.cases[0].threadId,
      ),
    ).toBe(false);
    expect(JSON.stringify(corpus)).not.toContain('REFERENCIARESERVADA');
    expect(f.text.generate).not.toHaveBeenCalled();
  });
  it('compara los tres brazos, regenera perfiles aislados y mantiene pendientes los juicios humanos', async () => {
    const f = evaluationFixture();
    const report = await evaluateHistoricalStyle({ ...f, examples: 0 });
    expect(report.cases).toHaveLength(10);
    expect(report.trainingMessages).toBe(20);
    expect(report.analysisCalls).toBeGreaterThanOrEqual(2);
    expect(report.summary).toMatchObject({
      humanReview: 'PENDING',
      pairedCases: 0,
      recommendation: 'PENDING_HUMAN_REVIEW',
      automaticallyChangesMvp: false,
    });
    expect(
      report.cases.every(
        (item) =>
          item.variants.length === 3 &&
          item.variants.every(
            (v) => v.status === 'READY' && v.modelCalls === 2,
          ),
      ),
    ).toBe(true);
    expect(report.cases[0].variants.map((v) => v.effectiveScope)).toEqual([
      'NONE',
      'GENERAL',
      'RECIPIENT',
    ]);
    expect(JSON.stringify(f.text.generate.mock.calls)).not.toContain(
      'REFERENCIARESERVADA',
    );
    expect(JSON.stringify(report)).not.toMatch(
      /REFERENCIARESERVADA|contact@example|Confirmo la recepción|Hola, he recibido/,
    );
    expect(f.gmail.createDraft).not.toHaveBeenCalled();
  });
  it('excluye todos los hilos reservados también al recuperar ejemplos y no lista el buzón para ejemplos', async () => {
    const f = evaluationFixture();
    const report = await evaluateHistoricalStyle(f);
    expect(
      report.cases.some((item) =>
        item.variants.some((v) => v.examplesUsed > 0),
      ),
    ).toBe(true);
    const heldIds = f.corpus.cases.flatMap((item) => [
      item.replyMessageId,
      item.targetMessageId,
    ]);
    expect(
      f.gmail.getMessage.mock.calls.some(([id]) => heldIds.includes(id)),
    ).toBe(false);
    expect(f.gmail.listMessages).not.toHaveBeenCalled();
    expect(JSON.stringify(f.text.generate.mock.calls)).not.toContain(
      'REFERENCIARESERVADA',
    );
  });
  it('presenta respuestas ciegas sin perfiles ni modos y conserva solo notas y métricas', async () => {
    const f = evaluationFixture();
    const shown: BlindStyleCase[] = [];
    const review = vi.fn(async (item: BlindStyleCase) => {
      expect(Object.keys(item).sort()).toEqual([
        'candidates',
        'caseId',
        'conversation',
        'incoming',
        'referenceReply',
      ]);
      expect(Object.keys(item.candidates[0]).sort()).toEqual([
        'bodyText',
        'label',
        'status',
      ]);
      expect(item.referenceReply).toContain('REFERENCIARESERVADA');
      shown.push(item);
      return Object.fromEntries(
        item.candidates.map((c) => [
          c.label,
          syntheticRating(
            c.bodyText?.startsWith('Estimado')
              ? 5
              : c.bodyText?.startsWith('Buenos')
                ? 3
                : 2,
          ),
        ]),
      );
    });
    const report = await evaluateHistoricalStyle({ ...f, examples: 0, review });
    expect(report.summary).toMatchObject({
      humanReview: 'COMPLETE',
      pairedCases: 10,
      genuineContextPairs: 10,
      recommendation: 'CONTEXTUAL',
    });
    expect(
      shown.every(
        (item) =>
          item.referenceReply === '' &&
          item.incoming === '' &&
          item.candidates.length === 0,
      ),
    ).toBe(true);
    expect(review).toHaveBeenCalledTimes(10);
  });
  it('muestra el fallback general y no declara probada la superioridad contextual sin perfiles particulares', async () => {
    const f = evaluationFixture();
    // A shared public mail domain and many individual recipients give no reliable group.
    f.training.forEach((message, i) => {
      f.training[i] = withHeaders(message, { To: `different${i}@gmail.com` });
    });
    // sentMailbox closes over the original array, so changed entries are revalidated.
    const report = await evaluateHistoricalStyle({
      ...f,
      examples: 0,
      review: async (item) =>
        Object.fromEntries(
          item.candidates.map((c) => [
            c.label,
            syntheticRating(c.bodyText?.startsWith('Buenos') ? 4 : 2),
          ]),
        ),
    });
    expect(
      report.cases.every(
        (item) => item.variants[2].effectiveScope === 'GENERAL',
      ),
    ).toBe(true);
    expect(report.summary.genuineContextPairs).toBe(0);
    expect(report.summary.recommendation).toBe('GENERAL');
  });
  it('rechaza un perfil de entrenamiento que contenga un hilo reservado antes del modelo', async () => {
    const f = evaluationFixture();
    f.corpus.training.sourceMessages[0].threadId = f.corpus.cases[0].threadId;
    await expect(evaluateHistoricalStyle(f)).rejects.toMatchObject({
      code: 'CONTAMINATED_HOLDOUT',
    });
    expect(f.gmail.getThread).not.toHaveBeenCalled();
    expect(f.text.generate).not.toHaveBeenCalled();
  });
  it('detecta referencias engañosas que Gmail resuelve hacia un hilo reservado', async () => {
    const f = evaluationFixture();
    const read = f.gmail.getMessage.getMockImplementation()!;
    f.gmail.getMessage.mockImplementation(async (...args) => ({
      ...(await read(...args)),
      threadId: f.corpus.cases[0].threadId,
    }));
    await expect(evaluateHistoricalStyle(f)).rejects.toMatchObject({
      code: 'CONTAMINATED_HOLDOUT',
    });
    expect(f.text.generate).not.toHaveBeenCalled();
  });
  it('no infiere perfiles con mensajes posteriores al primer objetivo reservado', async () => {
    const f = evaluationFixture();
    f.training.forEach((message) => {
      (message as { internalDate: string }).internalDate = String(
        new Date('2026-10-18').getTime(),
      );
    });
    await expect(evaluateHistoricalStyle(f)).rejects.toMatchObject({
      code: 'TRAINING_REQUIRED',
    });
    expect(f.text.generate).not.toHaveBeenCalled();
  });
  it('elimina la respuesta y mensajes posteriores del contexto aun cuando el hilo ya esté archivado', async () => {
    const f = evaluationFixture();
    const ref = f.corpus.cases[0];
    f.historical[0].messages[0] = {
      ...f.historical[0].messages[0],
      labelIds: [],
    };
    const item = await loadHistoricalStyleCase(f.gmail, ref, f.identity, f.now);
    expect(item.thread.messages.map((m) => m.id)).toEqual([
      ref.targetMessageId,
    ]);
    expect(item.thread.messages[0].labelIds).toContain('INBOX');
    expect(f.historical[0].messages[0].labelIds).toEqual([]);
  });
  it('rechaza una respuesta ajena o que no responde al objetivo', async () => {
    const f = evaluationFixture();
    f.historical[0].messages[1] = withHeaders(f.historical[0].messages[1], {
      From: 'other@example.invalid',
    });
    await expect(evaluateHistoricalStyle(f)).rejects.toMatchObject({
      code: 'INVALID_HISTORICAL_PAIR',
    });
    expect(f.text.generate).not.toHaveBeenCalled();
  });
  it('no admite revisiones parciales ni puntuaciones fuera de escala', async () => {
    const f = evaluationFixture();
    let item: BlindStyleCase | undefined;
    await expect(
      evaluateHistoricalStyle({
        ...f,
        examples: 0,
        review: async (c) => {
          item = c;
          return { A: syntheticRating(5) };
        },
      }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_REVIEW' });
    expect(item?.candidates).toEqual([]);
    expect(item?.referenceReply).toBe('');
  });
  it('propaga errores de autorización y del modelo sin escribir ni guardar texto parcial', async () => {
    const f = evaluationFixture();
    f.text.generate.mockRejectedValue(
      new ProviderError('openai', 'UNAVAILABLE'),
    );
    await expect(evaluateHistoricalStyle(f)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(f.gmail.createDraft).not.toHaveBeenCalled();
  });
});
