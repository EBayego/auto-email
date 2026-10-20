import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  main,
  parseStyleEvaluationArgs,
  reviewBlindStyleCase,
} from '../scripts/poc-evaluate-style';
import {
  evaluationFixture,
  syntheticRating,
} from './fixtures/style-evaluation';
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  account: vi.fn(),
  gmailFor: vi.fn(),
  sample: vi.fn(),
  loadCorpus: vi.fn(),
  saveCorpus: vi.fn(),
  saveReport: vi.fn(),
  loadReport: vi.fn(),
  remove: vi.fn(),
  prepare: vi.fn(),
  evaluate: vi.fn(),
  rules: vi.fn(),
  preferences: vi.fn(),
}));
vi.mock('@next/env', () => ({ default: { loadEnvConfig: vi.fn() } }));
vi.mock('@/config/env', async (original) => ({
  ...(await original<typeof import('@/config/env')>()),
  getServerConfig: mocks.config,
}));
vi.mock('@/db/service-client', () => ({
  createServiceDataClient: vi.fn(() => ({})),
}));
vi.mock('@/db/poc-account', () => ({ resolvePocAccount: mocks.account }));
vi.mock('@/db/style-relationships', () => ({
  createStyleRelationshipRepository: vi.fn(() => ({ list: mocks.rules })),
}));
vi.mock('@/db/style-preferences', () => ({
  createStylePreferenceRepository: vi.fn(() => ({ list: mocks.preferences })),
}));
vi.mock('@/worker/runtime', () => ({
  createWorkerRuntime: vi.fn(() => ({
    gmailFor: mocks.gmailFor,
    providers: { text: { generate: vi.fn() } },
  })),
}));
vi.mock('@/poc/sent-sample-store', () => ({
  createSentSampleStore: vi.fn(() => ({ load: mocks.sample })),
}));
vi.mock('@/poc/style-evaluation-store', () => ({
  createStyleEvaluationStore: vi.fn(() => ({
    loadCorpus: mocks.loadCorpus,
    saveCorpus: mocks.saveCorpus,
    saveReport: mocks.saveReport,
    loadReport: mocks.loadReport,
    remove: mocks.remove,
  })),
}));
vi.mock('@/poc/style-evaluation-corpus', () => ({
  prepareStyleEvaluationCorpus: mocks.prepare,
}));
vi.mock('@/poc/evaluate-style', () => ({
  evaluateHistoricalStyle: mocks.evaluate,
}));
const base = ['--email', 'owner@example.invalid'];
const reserved = () =>
  evaluationFixture().corpus.cases.flatMap((c) => [
    '--case',
    `${c.threadId}:${c.targetMessageId}:${c.replyMessageId}`,
  ]);
describe('poc:evaluate-style', () => {
  beforeEach(() => {
    const f = evaluationFixture();
    mocks.config.mockReturnValue({
      environment: 'development',
      providerMode: 'live',
      openai: { model: 'test-model' },
    });
    mocks.account.mockResolvedValue({
      work: {
        userId: f.identity.userId,
        gmailAccountId: f.identity.gmailAccountId,
      },
      account: { email: f.identity.mailboxAddress },
    });
    mocks.gmailFor.mockResolvedValue(f.gmail);
    mocks.sample.mockResolvedValue({ sourceMessages: [] });
    mocks.prepare.mockResolvedValue(f.corpus);
    mocks.loadCorpus.mockResolvedValue(f.corpus);
    mocks.rules.mockResolvedValue([]);
    mocks.preferences.mockResolvedValue([]);
    mocks.evaluate.mockResolvedValue({
      cases: [],
      analysisCalls: 0,
      summary: { humanReview: 'PENDING' },
      mvpPolicy: { evidenceStatus: 'PROVISIONAL_PENDING_BLIND_HUMAN_REVIEW' },
    });
    mocks.loadReport.mockResolvedValue({ summary: { humanReview: 'PENDING' } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  it('prepara referencias sin llamar al modelo y valida el formato de parejas reservadas', async () => {
    expect(
      parseStyleEvaluationArgs([...base, '--prepare', ...reserved()]),
    ).toMatchObject({
      action: 'prepare',
      cases: expect.any(Array),
      seed: 'mail028',
    });
    await main([...base, '--prepare', ...reserved()]);
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.saveCorpus).toHaveBeenCalledOnce();
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it('ejecuta una comparación controlada con el modelo configurado y guarda solo el informe', async () => {
    await main([...base, '--run', '--examples', '0']);
    expect(mocks.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        examples: 0,
        review: undefined,
        corpus: expect.any(Object),
      }),
    );
    expect(mocks.saveReport).toHaveBeenCalledOnce();
    expect(mocks.saveCorpus).not.toHaveBeenCalled();
  });
  it('consulta el informe o borra referencias sin acceder a Gmail ni al modelo', async () => {
    await main([...base, '--report']);
    await main([...base, '--remove']);
    expect(mocks.loadReport).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.gmailFor).not.toHaveBeenCalled();
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it('ejecuta una revisión automática sin terminal interactivo ni callback humano', async () => {
    await main([...base, '--run', '--auto-review']);
    expect(mocks.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        automaticReview: true,
        review: undefined,
        progress: expect.any(Function),
      }),
    );
    expect(mocks.saveReport).toHaveBeenCalledOnce();
  });
  it('carga preferencias únicamente cuando se solicita y conserva el experimento sin ellas como opción', async () => {
    const preferences = [{ key: 'warmth', value: 'warm' }];
    mocks.preferences.mockResolvedValue(preferences);
    await main([...base, '--run', '--auto-review', '--with-preferences']);
    expect(mocks.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ preferences }),
    );
    expect(mocks.preferences).toHaveBeenCalledOnce();
  });
  it('muestra ayuda sin cargar configuración', async () => {
    await main(['--help']);
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      base,
      [...base, '--run', '--report'],
      [...base, '--prepare'],
      [...base, '--run', '--case', 'a:b:c'],
      [...base, '--run', '--examples', '4'],
      [...base, '--report', '--review'],
      [...base, '--run', '--seed', 'bad'],
      [...base, '--user-id', 'other', '--run'],
      [...base, '--prepare', '--case', 'a:b:c:extra'],
      [...base, '--run', '--body', 'private'],
      [...base, '--report', '--auto-review'],
      [...base, '--run', '--auto-review', '--review'],
      [...base, '--report', '--with-preferences'],
    ].map((args) => ({ args })),
  )('rechaza $args antes de leer credenciales', async ({ args }) => {
    await expect(main(args)).rejects.toBeDefined();
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it('recoge cinco dimensiones y factores sin revelar configuración ni registrar textos libres', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce('bad')
      .mockResolvedValueOnce('4 4 4 4 4 s s')
      .mockResolvedValueOnce('length');
    const show = vi.fn();
    const rating = await reviewBlindStyleCase(
      {
        caseId: 'case-01',
        incoming: 'Entrada',
        conversation: [
          { speaker: 'participant_1', text: 'Entrada', isTarget: true },
        ],
        referenceReply: 'Referencia',
        candidates: [
          { label: 'A', status: 'READY', bodyText: 'Propuesta' },
          { label: 'B', status: 'BLOCKED', bodyText: null },
        ],
      },
      ask,
      show,
    );
    expect(rating).toEqual({ A: syntheticRating(4, { factors: ['length'] }) });
    expect(show.mock.calls.join('\n')).not.toMatch(
      /GENERAL|CONTEXTUAL|UNPERSONALIZED|profileFingerprint/,
    );
  });
});
