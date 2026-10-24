import { describe, expect, it, vi } from 'vitest';
import { main } from '../scripts/worker-sync';

describe('CLI del worker MAIL-029', () => {
  it('muestra ayuda sin credenciales ni acceso a servicios', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--help']);
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('npm run worker:sync'),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rechaza opciones y argumentos desconocidos', async () => {
    await expect(
      main(['--email', 'private@example.invalid']),
    ).rejects.toThrow();
    await expect(main(['anything'])).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
