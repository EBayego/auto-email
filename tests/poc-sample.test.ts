import { describe, expect, it, vi } from 'vitest';
import { main, parseSampleArgs } from '../scripts/poc-sample';
import { sampleNow, sampleOwner } from './fixtures/sent-emails';

describe('comando manual MAIL-017', () => {
  it('valida tamaño, fechas UTC y exclusiones repetibles', () => {
    expect(
      parseSampleArgs(
        [
          '--email',
          sampleOwner,
          '--size',
          '300',
          '--after',
          '2026-01-01',
          '--before',
          '2026-10-01',
          '--exclude-label',
          'CATEGORY_PROMOTIONS',
          '--exclude-label',
          'Label_123',
          '--exclude-domain',
          'private.invalid',
          '--exclude-address',
          'private@example.invalid',
        ],
        sampleNow,
      ),
    ).toMatchObject({
      action: 'sample',
      options: {
        targetSize: 300,
        after: new Date('2026-01-01T00:00:00Z'),
        before: new Date('2026-10-01T00:00:00Z'),
        excludedLabelIds: ['CATEGORY_PROMOTIONS', 'Label_123'],
        excludedDomains: ['private.invalid'],
      },
    });
  });
  it.each(
    [
      [],
      ['--email', 'bad'],
      ['--email', sampleOwner, '--size', '501'],
      ['--email', sampleOwner, '--after', '2026-02-30'],
      ['--email', sampleOwner, '--before', '2026-13-01'],
      ['--email', sampleOwner, '--unknown'],
      ['--purge', '--email', sampleOwner],
    ].map((args) => ({ args })),
  )('rechaza $args', ({ args }) => {
    expect(() => parseSampleArgs(args, sampleNow)).toThrow();
  });
  it('permite pedir ayuda o purgar sin cargar credenciales', async () => {
    expect(parseSampleArgs(['--purge'])).toEqual({ action: 'purge' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--help']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('MAIL-017'));
  });
});
