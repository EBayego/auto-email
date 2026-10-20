import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createStyleEvaluationStore } from './style-evaluation-store';
import {
  evaluationFixture,
  syntheticRating,
} from '../../tests/fixtures/style-evaluation';
import { evaluateHistoricalStyle } from './evaluate-style';

const root = resolve('.cache');
let directory: string;
describe('conservación de referencias y resultados de evaluación', () => {
  beforeEach(async () => {
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, 'style-eval-test-'));
  });
  afterEach(async () => {
    if (!resolve(directory).startsWith(root + sep))
      throw Error('Invalid test path');
    await rm(directory, { recursive: true, force: true });
  });
  it('conserva notas y procedencia automáticas sin guardarlas como humanas ni escribir textos del juez', async () => {
    const f = evaluationFixture(),
      store = createStyleEvaluationStore(directory);
    await store.saveCorpus(f.identity, f.corpus, f.now);
    const report = await evaluateHistoricalStyle({
      ...f,
      examples: 0,
      automaticReview: true,
    });
    await store.saveReport(f.identity, report, f.now);
    const loaded = await store.loadReport(f.identity, f.now);
    expect(loaded.automaticEvaluator).toMatchObject({
      model: f.model,
      modelCalls: 10,
      calibration: 'NOT_HUMAN_CALIBRATED',
    });
    expect(loaded.summary).toMatchObject({
      humanReview: 'PENDING',
      automatic: { status: 'COMPLETE', pairedCases: 10 },
    });
    expect(loaded.cases[0].variants[0].human).toBeNull();
    expect(
      loaded.cases[0].variants[0].automatic?.additionalScores,
    ).toBeDefined();
    const reportFile = (await readdir(directory)).find((name) =>
      name.endsWith('.report.json'),
    )!;
    expect(await readFile(join(directory, reportFile), 'utf8')).not.toMatch(
      /REFERENCIARESERVADA|contact@example|referenceReply|bodyText/,
    );
    (
      report.cases[0].variants[0].automatic as unknown as Record<
        string,
        unknown
      >
    ).notes = 'private-copy';
    await expect(
      store.saveReport(f.identity, report, f.now),
    ).rejects.toMatchObject({ code: 'INVALID_AUTOMATIC_REVIEW' });
    expect(await readFile(join(directory, reportFile), 'utf8')).not.toContain(
      'private-copy',
    );
  });
  it('conserva la condición experimental y las preferencias estructuradas para no comparar ejecuciones distintas como iguales', async () => {
    const f = evaluationFixture(),
      store = createStyleEvaluationStore(directory);
    await store.saveCorpus(f.identity, f.corpus, f.now);
    const report = await evaluateHistoricalStyle({
      ...f,
      examples: 0,
      preferences: [
        {
          scope: { kind: 'GENERAL', key: '' },
          preference: { key: 'warmth', value: 'warm' },
          origin: 'EXPLICIT',
          revision: '00000000-0000-4000-8000-000000000001',
        },
      ],
    });
    await store.saveReport(f.identity, report, f.now);
    const loaded = await store.loadReport(f.identity, f.now);
    expect(loaded.personalizationPreferences).toBe(
      'EXPLICIT_IN_PERSONALIZED_VARIANTS',
    );
    expect(loaded.preferenceFingerprint).toBe(report.preferenceFingerprint);
    expect(loaded.cases[0].appliedPreferences).toEqual([
      { key: 'warmth', value: 'warm' },
    ]);
    expect(loaded.cases[0].variants[0].warnings).toContain(
      'HUMAN_REVIEW_REQUIRED',
    );
  });
  it('guarda referencias, métricas y notas sin permitir que se filtren correos o propuestas', async () => {
    const f = evaluationFixture(),
      store = createStyleEvaluationStore(directory);
    await store.saveCorpus(f.identity, f.corpus, f.now);
    const report = await evaluateHistoricalStyle({
      ...f,
      examples: 0,
      review: async (item) =>
        Object.fromEntries(
          item.candidates.map((c) => [c.label, syntheticRating(4)]),
        ),
    });
    await store.saveReport(
      f.identity,
      {
        ...report,
        bodyText: 'private-candidate',
        prompt: 'private-prompt',
      } as typeof report,
      f.now,
    );
    const loaded = await store.loadReport(f.identity, f.now);
    expect(loaded.summary.humanReview).toBe('COMPLETE');
    const contents = (
      await Promise.all(
        (await readdir(directory)).map((name) =>
          readFile(join(directory, name), 'utf8'),
        ),
      )
    ).join('\n');
    expect(contents).not.toMatch(
      /private-candidate|private-prompt|REFERENCIARESERVADA|contact@example|He recibido tu mensaje/,
    );
    expect(await store.loadCorpus(f.identity, f.now)).toEqual(f.corpus);
  });
  it('no mezcla propietarios aunque se sustituya el contenido del fichero', async () => {
    const f = evaluationFixture(),
      store = createStyleEvaluationStore(directory);
    await store.saveCorpus(f.identity, f.corpus, f.now);
    const filename = (await readdir(directory))[0];
    await writeFile(
      join(directory, filename),
      JSON.stringify({
        ...f.corpus,
        userId: '00000000-0000-4000-8000-000000000099',
      }),
    );
    await expect(store.loadCorpus(f.identity, f.now)).rejects.toMatchObject({
      code: 'ACCOUNT_MISMATCH',
    });
  });
  it('elimina conjunto e informe caducados también cuando se consulta el informe', async () => {
    const f = evaluationFixture(),
      store = createStyleEvaluationStore(directory);
    await store.saveCorpus(f.identity, f.corpus, f.now);
    const report = await evaluateHistoricalStyle({ ...f, examples: 0 });
    await store.saveReport(f.identity, report, f.now);
    await expect(
      store.loadReport(f.identity, new Date('2027-01-02')),
    ).rejects.toMatchObject({ code: 'EXPIRED_EVALUATION' });
    expect(await readdir(directory)).toEqual([]);
  });
  it('invalida el informe anterior cuando cambia el conjunto y permite borrar todos los artefactos', async () => {
    const f = evaluationFixture(),
      store = createStyleEvaluationStore(directory);
    await store.saveCorpus(f.identity, f.corpus, f.now);
    await store.saveReport(
      f.identity,
      await evaluateHistoricalStyle({ ...f, examples: 0 }),
      f.now,
    );
    await store.saveCorpus(f.identity, { ...f.corpus, seed: 'changed' }, f.now);
    expect(
      (await readdir(directory)).every((name) => name.endsWith('.corpus.json')),
    ).toBe(true);
    await store.remove(f.identity);
    expect(await readdir(directory)).toEqual([]);
  });
  it('rechaza un informe de otro conjunto sin escribir datos parciales', async () => {
    const f = evaluationFixture(),
      store = createStyleEvaluationStore(directory);
    await store.saveCorpus(f.identity, f.corpus, f.now);
    const report = await evaluateHistoricalStyle({ ...f, examples: 0 });
    await expect(
      store.saveReport(
        f.identity,
        { ...report, corpusFingerprint: 'a'.repeat(64) },
        f.now,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_EVALUATION' });
    expect(
      (await readdir(directory)).filter((name) =>
        name.endsWith('.report.json'),
      ),
    ).toEqual([]);
  });
});
