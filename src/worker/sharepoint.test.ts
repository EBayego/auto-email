import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { syncSharePointConnector } from './sharepoint';
import {
  SharePointError,
  type SharePointConnector,
  type SharePointStore,
} from '@/modules/sharepoint/contracts';
import type { SharePointGraph } from '@/providers/sharepoint';
import { extractImportedDocument } from '@/modules/sharepoint/extraction';
import { SecretValue } from '@/config/env';
vi.mock('@/modules/sharepoint/extraction', () => ({
  extractImportedDocument: vi.fn(),
}));
const id = '00000000-0000-4000-8000-000000000601';
const config = {
  clientId: id,
  clientSecret: new SecretValue('fixture'),
  encryptionKey: new SecretValue(Buffer.alloc(32, 7).toString('base64')),
  tenants: [id],
  scope: 'Sites.Read.All' as const,
  redirectUri: 'http://localhost:3000/api/connectors/microsoft/callback',
  timeoutMs: 30000,
  ocr: null,
};
const base = {
  id,
  user_id: id,
  connection_id: id,
  source_id: id,
  title: 'Tarifas',
  site_id: 'site',
  drive_id: 'drive',
  root_item_id: 'folder',
  web_url: 'https://tenant.sharepoint.com/sites/test/docs',
  recursive: true,
  interval_minutes: 15,
  review_only: false,
  audience_kind: 'GENERAL',
  audience_key: '',
  status: 'ACTIVE',
  phase: 'DELTA',
  delta_link: null,
  next_link: null,
  full_scan: true,
  generation: 1,
  lease_id: id,
  lease_until: '2026-11-02T12:00:00Z',
  version: 1,
  next_sync_at: '2026-11-02T12:00:00Z',
  last_sync_at: null,
  error_code: null,
} as SharePointConnector;
const item = {
  item_id: 'file',
  name: 'tarifas.txt',
  etag: 'v1',
  size: 20,
  mime_type: 'text/plain',
  web_url: 'https://tenant.sharepoint.com/sites/test/tarifas.txt',
  modified_at: '2026-11-02T00:00:00Z',
  document_id: null,
};
function fixture() {
  const command = vi
    .fn()
    .mockImplementation(async (action: string) =>
      action === 'pending' ? [item] : true,
    );
  const graph = {
    page: vi.fn().mockResolvedValue({
      items: [],
      next: null,
      delta: 'https://graph.microsoft.com/v1.0/drives/drive/root/delta?token=1',
    }),
    assertInRoot: vi.fn().mockResolvedValue({
      id: 'file',
      eTag: 'v1',
      webUrl: item.web_url,
      name: item.name,
      file: { mimeType: 'text/plain' },
    }),
    download: vi.fn().mockResolvedValue(Buffer.from('Precio: 125 EUR.')),
    item: vi.fn().mockResolvedValue({ id: 'file', eTag: 'v1' }),
    close: vi.fn(),
  };
  return {
    command,
    graph,
    run: (phase: SharePointConnector['phase'] = 'DELTA') =>
      syncSharePointConnector(
        { ...base, phase },
        { command } as SharePointStore,
        graph as unknown as SharePointGraph,
        config,
      ),
  };
}
describe('sincronización SharePoint: recuperación y límites de trabajo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractImportedDocument).mockResolvedValue({
      text: 'Precio: 125 EUR.',
    });
  });
  it('persiste un máximo de tres páginas por ciclo y continúa sin indexar antes del final', async () => {
    const f = fixture();
    f.graph.page.mockResolvedValue({
      items: [],
      next: 'https://graph.microsoft.com/v1.0/drives/drive/root/delta?next=2',
      delta: null,
    } as never);
    await expect(f.run()).resolves.toEqual({ failed: false });
    expect(f.graph.page).toHaveBeenCalledTimes(3);
    expect(f.command.mock.calls.map((c) => c[0])).toEqual([
      'page',
      'page',
      'page',
      'release',
    ]);
    expect(f.graph.download).not.toHaveBeenCalled();
  });
  it('reinicia una exploración si el cursor ha caducado', async () => {
    const f = fixture();
    f.graph.page.mockRejectedValue(new SharePointError('CURSOR_EXPIRED'));
    await expect(f.run()).resolves.toEqual({ failed: false });
    expect(f.command.mock.calls.map((c) => c[0])).toEqual(['reset', 'release']);
  });
  it('respeta la demora del proveedor y conserva el trabajo tras throttling', async () => {
    const f = fixture();
    f.graph.page.mockRejectedValue(new SharePointError('THROTTLED', 120));
    await expect(f.run()).resolves.toEqual({ failed: true });
    expect(f.command).toHaveBeenLastCalledWith(
      'release',
      expect.objectContaining({ error: 'THROTTLED', retryAfter: 120 }),
    );
    expect(f.graph.download).not.toHaveBeenCalled();
  });
  it('reconcilia de nuevo si cambia el archivo mientras se está procesando', async () => {
    const f = fixture();
    f.graph.item.mockResolvedValue({ id: 'file', eTag: 'v2' });
    await expect(f.run('INDEX')).resolves.toEqual({ failed: true });
    expect(f.command.mock.calls.map((c) => c[0])).toContain('reset');
    expect(f.command.mock.calls.some((c) => c[0] === 'document_save')).toBe(
      false,
    );
  });
  it('muestra formatos omitidos sin presentarlos como indexados', async () => {
    const f = fixture();
    vi.mocked(extractImportedDocument).mockRejectedValue(
      new SharePointError('UNSUPPORTED_FORMAT'),
    );
    await expect(f.run('INDEX')).resolves.toEqual({ failed: false });
    expect(f.command).toHaveBeenCalledWith(
      'item_error',
      expect.objectContaining({ error: 'UNSUPPORTED_FORMAT', omitted: true }),
    );
    expect(f.command.mock.calls.some((c) => c[0] === 'document_save')).toBe(
      false,
    );
  });
  it('evita repetir extracción y OCR cuando solo cambian metadatos', async () => {
    const f = fixture();
    f.command.mockImplementation(async (action: string) =>
      action === 'pending'
        ? [{ ...item, document_id: id }]
        : action === 'cached_hash'
          ? {
              ready: true,
              hash: createHash('sha256')
                .update('Precio: 125 EUR.')
                .digest('hex'),
            }
          : true,
    );
    await expect(f.run('INDEX')).resolves.toEqual({ failed: false });
    expect(extractImportedDocument).not.toHaveBeenCalled();
    expect(f.command).toHaveBeenCalledWith(
      'document_unchanged',
      expect.objectContaining({ itemId: 'file' }),
    );
  });
});
