import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/providers/errors';
import { draftFixture } from '../../tests/fixtures/drafts';
import { createEmailFixtures } from '../../tests/fixtures/emails';
import {
  validateCases,
  validateReplySamples,
  type ValidationCase,
} from './validate-replies';

function fixture() {
  const input = draftFixture();
  const cases: ValidationCase[] = Array.from({ length: 10 }, (_, i) => ({
    threadId: `thread-${i}`,
    expected: 'READY',
  }));
  input.gmail.getThread.mockImplementation(async (id) => {
    const thread = structuredClone(input.thread);
    return {
      ...thread,
      id,
      messages: thread.messages.map((message) => ({
        ...message,
        threadId: id,
      })),
    };
  });
  return { ...input, cases };
}
describe('validación manual de una muestra con Gmail de solo lectura', () => {
  it('compara diez resultados, comprueba su MIME en memoria y no escribe en Gmail', async () => {
    const input = fixture();
    const result = await validateReplySamples(input);
    expect(result).toMatchObject({
      mode: 'READ_ONLY',
      evaluated: 10,
      passed: 10,
      failed: 0,
      unchanged: 10,
      readyForHumanReview: 10,
      modelCalls: 20,
    });
    expect(
      result.cases.every(
        (item) => item.mimeChecked && item.humanReview === 'REQUIRED',
      ),
    ).toBe(true);
    expect(input.gmail.getThread).toHaveBeenCalledTimes(20);
    expect(input.gmail.createDraft).not.toHaveBeenCalled();
    expect(input.store.reserve).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /he recibido|podemos reunirnos|bodyText|subject|contact@example|hash/,
    );
  });
  it('una respuesta READY no aprueba una expectativa de abstención ni implica una evaluación humana', async () => {
    const input = fixture();
    input.cases.forEach((item) => {
      item.expected = 'NO_REPLY_REQUIRED';
    });
    const result = await validateReplySamples(input);
    expect(result.failed).toBe(10);
    expect(result.findings.INSTRUCTIONS).toBe(10);
    expect(result.cases[0].findings).toContainEqual({
      category: 'INSTRUCTIONS',
      code: 'UNEXPECTED_OUTCOME',
    });
    expect(result.cases[0]).not.toHaveProperty('qualityScore');
  });
  it('un filtro y un bloqueo por NO_REPLY_REQUIRED cumplen la misma expectativa funcional', async () => {
    const input = fixture();
    input.cases.forEach((item) => {
      item.expected = 'NO_REPLY_REQUIRED';
    });
    input.text.generate.mockResolvedValue({
      text: JSON.stringify({
        status: 'BLOCKED',
        bodyText: null,
        language: 'es',
        missingInformation: [],
        evidence: [],
        warnings: ['NO_REPLY_REQUIRED'],
      }),
      inputTokens: 20,
      outputTokens: 10,
    });
    const result = await validateReplySamples(input);
    expect(result.passed).toBe(10);
    expect(result.modelCalls).toBe(10);
    expect(result.readyForHumanReview).toBe(0);
    expect(result.cases[0].mimeChecked).toBe(false);
  });
  it('detecta cambios en un borrador previo aunque no cambien los recuentos', async () => {
    const input = fixture();
    input.cases.forEach((item) => {
      item.expected = 'EXISTING_DRAFT';
    });
    const reads = new Map<string, number>();
    input.gmail.getThread.mockImplementation(async (id) => {
      const count = reads.get(id) ?? 0;
      reads.set(id, count + 1);
      const thread = createEmailFixtures().manualDraft;
      const messages = thread.messages.map((message) => ({
        ...message,
        threadId: id,
      }));
      if (count > 0)
        messages[1].payload.body.data = Buffer.from(
          'Cambio externo al borrador.',
        ).toString('base64url');
      return { id, messages };
    });
    const result = await validateReplySamples(input);
    expect(result.unchanged).toBe(0);
    expect(result.findings.INTEGRATION).toBe(10);
    expect(result.cases[0]).toMatchObject({
      draftCountBefore: 1,
      draftCountAfter: 1,
      unchanged: false,
      passed: false,
    });
    expect(input.text.generate).not.toHaveBeenCalled();
    expect(input.gmail.createDraft).not.toHaveBeenCalled();
  });
  it('no confunde tokens de adjuntos renovados o el orden de las etiquetas con cambios de Gmail', async () => {
    const input = fixture();
    input.cases.forEach((item) => {
      item.expected = 'REVIEW_REQUIRED';
    });
    let n = 0;
    input.gmail.getThread.mockImplementation(async (id) => {
      const thread = createEmailFixtures().attachment;
      thread.messages[0].threadId = id;
      thread.messages[0].payload.parts![1].body.attachmentId = `ephemeral-token-${++n}`;
      thread.messages[0].labelIds =
        n % 2 ? ['UNREAD', 'INBOX'] : ['INBOX', 'UNREAD'];
      return { ...thread, id };
    });
    const result = await validateReplySamples(input);
    expect(result).toMatchObject({ passed: 10, unchanged: 10, modelCalls: 0 });
    expect(result.findings.INTEGRATION).toBe(0);
  });
  it('registra un error del modelo sin ocultarlo y sigue comparando el resto de casos', async () => {
    const input = fixture();
    input.text.generate.mockResolvedValueOnce({
      text: 'private-invalid-output',
      inputTokens: 0,
      outputTokens: 0,
    });
    const result = await validateReplySamples(input);
    expect(result).toMatchObject({
      evaluated: 10,
      passed: 9,
      failed: 1,
      unchanged: 10,
    });
    expect(result.cases[0]).toMatchObject({
      actual: 'ERROR',
      errorCode: 'INVALID_MODEL_OUTPUT',
    });
    expect(JSON.stringify(result)).not.toContain('private-invalid-output');
  });
  it('comprueba también el hilo después de una excepción del operador sin filtrar su texto', async () => {
    const input = fixture();
    const result = await validateReplySamples({
      ...input,
      consume: async () => {
        throw new Error('private-email-body');
      },
    });
    expect(result.failed).toBe(10);
    expect(result.unchanged).toBe(10);
    expect(JSON.stringify(result)).not.toContain('private-email-body');
  });
  it('una lectura final fallida no se declara inmutable ni aprobada', async () => {
    const input = fixture();
    const read = input.gmail.getThread.getMockImplementation()!;
    let n = 0;
    input.gmail.getThread.mockImplementation(async (...args) => {
      if (++n === 2) throw new ProviderError('google', 'UNAVAILABLE');
      return read(...args);
    });
    const result = await validateReplySamples(input);
    expect(result.cases[0]).toMatchObject({
      actual: 'READY',
      unchanged: null,
      passed: false,
    });
    expect(result.findings.INTEGRATION).toBe(1);
  });
  it('rechaza una respuesta que no corresponde al hilo solicitado', async () => {
    const input = fixture();
    input.gmail.getThread.mockResolvedValue(input.thread);
    const result = await validateReplySamples(input);
    expect(result.cases[0]).toMatchObject({
      actual: 'ERROR',
      errorCode: 'CONTEXT_ERROR',
      unchanged: null,
    });
    expect(input.text.generate).not.toHaveBeenCalled();
  });
  it.each([0, 9, 21])(
    'rechaza muestras de %i conversaciones antes de leer Gmail',
    async (count) => {
      const input = fixture();
      await expect(
        validateReplySamples({
          ...input,
          cases: Array.from({ length: count }, (_, i) => ({
            threadId: `thread-${i}`,
            expected: 'READY',
          })),
        }),
      ).rejects.toThrow('INVALID_INPUT');
      expect(input.gmail.getThread).not.toHaveBeenCalled();
    },
  );
  it('rechaza duplicados, IDs inválidos y expectativas libres', () => {
    for (const extra of [
      { threadId: 'thread-1' },
      { threadId: undefined },
      { threadId: '../other' },
      { expected: 'private-body' },
      { targetMessageId: 'bad:id' },
    ]) {
      const input = fixture();
      Object.assign(input.cases[0], extra);
      expect(() => validateCases(input.cases)).toThrow('INVALID_INPUT');
    }
  });
  it('exige un perfil antes de acceder a Gmail', async () => {
    const input = fixture();
    await expect(
      validateReplySamples({
        ...input,
        selection: { ...input.selection, style: undefined },
      }),
    ).rejects.toThrow('STYLE_PROFILE_REQUIRED');
    expect(input.gmail.getThread).not.toHaveBeenCalled();
  });
  it('entrega solo informes minimizados al callback de progreso', async () => {
    const input = fixture();
    const onCase = vi.fn();
    await validateReplySamples({ ...input, onCase });
    expect(onCase).toHaveBeenCalledTimes(10);
    expect(JSON.stringify(onCase.mock.calls)).not.toMatch(
      /he recibido|bodyText|subject/,
    );
  });
});
