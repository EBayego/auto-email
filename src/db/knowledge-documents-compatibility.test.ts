import { describe, it, expect, vi } from 'vitest';
import { createKnowledgeDocuments } from './knowledge-documents';
import type { DataClient } from './models';

function fixture(
  code = '42703',
  message = 'column source_documents.connector_id does not exist',
) {
  const order = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: { code, message } })
    .mockResolvedValueOnce({ data: [], error: null });
  const chain = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  const client = {
    from: vi.fn(() => chain),
    storage: { from: vi.fn(() => ({})) },
  } as unknown as DataClient;
  return {
    repository: createKnowledgeDocuments(
      client,
      '00000000-0000-4000-8000-000000000701',
    ),
    order,
  };
}
describe('compatibilidad antes de activar SharePoint', () => {
  it('mantiene el catálogo manual si aún no se ha aplicado la migración y la función está apagada', async () => {
    vi.stubEnv('SHAREPOINT_ENABLED', 'false');
    const f = fixture();
    await expect(f.repository.list()).resolves.toEqual([]);
    expect(f.order).toHaveBeenCalledTimes(2);
  });
  it('exige la migración cuando se habilita la función', async () => {
    vi.stubEnv('SHAREPOINT_ENABLED', 'true');
    const f = fixture();
    await expect(f.repository.list()).rejects.toThrow('UNAVAILABLE');
    expect(f.order).toHaveBeenCalledTimes(1);
  });
  it('no convierte un fallo de permisos o de otra columna en una lectura sin filtro', async () => {
    vi.stubEnv('SHAREPOINT_ENABLED', 'false');
    const f = fixture('42501', 'permission denied');
    await expect(f.repository.list()).rejects.toThrow('UNAVAILABLE');
    expect(f.order).toHaveBeenCalledTimes(1);
  });
});
