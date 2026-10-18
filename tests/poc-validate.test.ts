import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftFixture } from './fixtures/drafts';
import { profileWork, writingProfileRow } from './fixtures/writing-profile';
import { main, parseValidationArgs } from '../scripts/poc-validate';
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  account: vi.fn(),
  style: vi.fn(),
  gmailFor: vi.fn(),
  generate: vi.fn(),
  load: vi.fn(),
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
vi.mock('@/db/writing-profiles', () => ({
  createWritingProfileRepository: vi.fn(() => ({ get: mocks.style })),
}));
vi.mock('@/poc/sent-sample-store', () => ({
  createSentSampleStore: vi.fn(() => ({ load: mocks.load })),
}));
vi.mock('@/worker/runtime', () => ({
  createWorkerRuntime: vi.fn(() => ({
    gmailFor: mocks.gmailFor,
    providers: { text: { generate: mocks.generate } },
  })),
}));
const cases = () =>
  Array.from({ length: 10 }, (_, i) => ['--case', `thread-${i}:READY`]).flat();
const args = () => ['--email', 'owner@example.invalid', ...cases()];
const previousExitCode = process.exitCode;
describe('comando reproducible de validación con expectativas del operador', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fixture = draftFixture();
    fixture.gmail.getThread.mockImplementation(async (id) => ({
      ...fixture.thread,
      id,
      messages: fixture.thread.messages.map((message) => ({
        ...message,
        threadId: id,
      })),
    }));
    mocks.config.mockReturnValue({
      environment: 'development',
      providerMode: 'live',
    });
    mocks.account.mockResolvedValue({
      work: profileWork,
      account: { email: 'owner@example.invalid' },
    });
    mocks.style.mockResolvedValue({
      ...writingProfileRow(),
      review_status: 'CONFIRMED',
    });
    mocks.gmailFor.mockResolvedValue(fixture.gmail);
    mocks.generate.mockImplementation(fixture.text.generate);
    mocks.load.mockResolvedValue(null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.exitCode = previousExitCode;
  });
  it('acepta 10 hilos distintos y permite fijar el mensaje objetivo sin cambiar el resultado esperado', () => {
    const input = args();
    input[input.indexOf('thread-0:READY')] = 'thread-0:target-0:READY';
    expect(
      parseValidationArgs([...input, '--style-examples', '0']),
    ).toMatchObject({
      action: 'validate',
      examples: 0,
      cases: [
        {
          threadId: 'thread-0',
          targetMessageId: 'target-0',
          expected: 'READY',
        },
        ...Array.from({ length: 9 }, (_, i) => ({
          threadId: `thread-${i + 1}`,
          expected: 'READY',
        })),
      ],
    });
  });
  it.each(
    [
      [],
      ['--email', 'owner@example.invalid', '--case', 'thread:READY'],
      ['--email', 'bad', ...cases()],
      [...args(), '--case', 'thread-0:READY'],
      [...args(), '--case', 'thread-other:PRIVATE_TEXT'],
      [...args(), '--style-examples', '4'],
      [...args(), '--send'],
      [...args(), '--create-drafts'],
      [...args(), '--user-id', 'other'],
      [
        '--email',
        'owner@example.invalid',
        ...cases().map((value) =>
          value === 'thread-0:READY' ? 'thread:target:extra:READY' : value,
        ),
      ],
    ].map((args) => ({ args })),
  )('rechaza $args antes de leer secretos', async ({ args }) => {
    await expect(main(args)).rejects.toBeDefined();
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.gmailFor).not.toHaveBeenCalled();
  });
  it('genera el informe sin imprimir correos y solo lee Gmail para la cuenta autorizada', async () => {
    const report = await main(args());
    expect(report).toMatchObject({
      evaluated: 10,
      passed: 10,
      unchanged: 10,
      readyForHumanReview: 10,
    });
    expect(mocks.gmailFor).toHaveBeenCalledExactlyOnceWith(profileWork);
    const gmail = await mocks.gmailFor.mock.results[0].value;
    expect(gmail.createDraft).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(10);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toMatch(
      /he recibido|bodyText|contact@example/,
    );
  });
  it('imprime contenido únicamente al solicitar --preview expresamente', async () => {
    await main([...args(), '--preview']);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).toContain(
      'he recibido',
    );
  });
  it('un resultado inesperado devuelve un informe fallido y exit code 1 sin escribir', async () => {
    const input = args().map((value) =>
      value === 'thread-0:READY' ? 'thread-0:NO_REPLY_REQUIRED' : value,
    );
    expect(await main(input)).toMatchObject({ passed: 9, failed: 1 });
    expect(process.exitCode).toBe(1);
    const gmail = await mocks.gmailFor.mock.results[0].value;
    expect(gmail.createDraft).not.toHaveBeenCalled();
  });
  it('requiere el perfil confirmado antes de Gmail y OpenAI', async () => {
    mocks.style.mockResolvedValue({
      ...writingProfileRow(),
      review_status: 'UNREVIEWED',
    });
    await expect(main(args())).rejects.toMatchObject({
      code: 'STYLE_PROFILE_REQUIRED',
    });
    expect(mocks.gmailFor).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('solo se ejecuta en desarrollo con proveedores live', async () => {
    mocks.config.mockReturnValue({
      environment: 'production',
      providerMode: 'live',
    });
    await expect(main(args())).rejects.toThrow('LOCAL_LIVE_ONLY');
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it('la ayuda no necesita credenciales ni conversaciones', async () => {
    await main(['--help']);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('MAIL-022'),
    );
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
