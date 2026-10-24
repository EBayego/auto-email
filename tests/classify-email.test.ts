import { describe, expect, it, vi } from 'vitest';
import { main, parseClassifyArgs } from '../scripts/classify-email';

describe('CLI MAIL-030', () => {
  it('muestra ayuda sin credenciales ni acceso a servicios', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--help']);
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('mail:classify'),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('permite exclusiones adicionales y guardar reglas de usuario por separado', () => {
    expect(
      parseClassifyArgs([
        '--email',
        'OWNER@example.invalid',
        '--message-id',
        'm1',
        '--exclude-domain',
        'NEWS.invalid',
      ]),
    ).toMatchObject({
      action: 'classify',
      email: 'owner@example.invalid',
      messageId: 'm1',
      exclusions: { excludedDomains: ['news.invalid'] },
    });
    expect(
      parseClassifyArgs([
        '--email',
        'owner@example.invalid',
        '--save-exclusions',
      ]),
    ).toMatchObject({
      action: 'configure',
      exclusions: { excludedAddresses: [], excludedDomains: [] },
    });
  });
  it.each(
    [
      [],
      ['--email', 'owner@example.invalid'],
      ['--email', 'owner@example.invalid', '--message-id', '../bad'],
      [
        '--email',
        'owner@example.invalid',
        '--save-exclusions',
        '--message-id',
        'm1',
      ],
      ['--send'],
      ['positional'],
    ].map((args) => ({ args })),
  )('rechaza opciones inválidas ($args)', ({ args }) =>
    expect(() => parseClassifyArgs(args)).toThrow(),
  );
});
