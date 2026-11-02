import { describe, expect, it, vi } from 'vitest';
import { main } from '../scripts/security-maintenance';
describe('MAIL-062 operaciones de seguridad explícitas', () => {
  it('explica contención y restauración sin pedir credenciales ni tocar servicios', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--help']);
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('No abrir el tráfico'),
    );
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('registro EXTERNO'),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('no permite contener, restaurar o liberar por accidente', async () => {
    await expect(main(['--action', 'restore'])).rejects.toThrow(
      'CONFIRMATION_REQUIRED',
    );
    await expect(main(['--action', 'unknown', '--confirmed'])).rejects.toThrow(
      'INVALID_ACTION',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
