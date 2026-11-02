import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createSharePointService } from './service';
import { SecretValue } from '@/config/env';
import type { SharePointStore } from './contracts';

vi.mock('./auth', () => ({
  createMicrosoftAuth: () => ({ token: async () => 'fixture-token' }),
}));
const id = '00000000-0000-4000-8000-000000000501';
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
const response = (body: unknown) => new Response(JSON.stringify(body));
const create = {
  action: 'create',
  connectionId: id,
  title: 'Tarifas',
  siteId: 'site',
  driveId: 'drive',
  rootId: 'folder',
  recursive: true,
  intervalMinutes: 15,
  audience: { kind: 'DOMAIN', key: 'client.invalid' },
  reviewOnly: true,
};
describe('selección y gestión de carpetas SharePoint', () => {
  const command = vi.fn();
  const fetcher = vi.fn<typeof fetch>();
  const service = () =>
    createSharePointService(
      config,
      { command } as SharePointStore,
      id,
      fetcher,
    );
  beforeEach(() => {
    vi.clearAllMocks();
    command.mockResolvedValue(true);
  });
  it('resuelve un sitio y todas las páginas de bibliotecas', async () => {
    fetcher
      .mockResolvedValueOnce(
        response({
          id: 'site',
          displayName: 'Comercial',
          webUrl: 'https://tenant.sharepoint.com/sites/test',
        }),
      )
      .mockResolvedValueOnce(
        response({
          value: [{ id: 'drive', name: 'Documentos' }],
          '@odata.nextLink':
            'https://graph.microsoft.com/v1.0/sites/site/drives?next=2',
        }),
      )
      .mockResolvedValueOnce(
        response({ value: [{ id: 'drive2', name: 'Archivo' }] }),
      );
    const found = await service().browse({
      connectionId: id,
      siteUrl: 'https://tenant.sharepoint.com/sites/test',
    });
    expect(found.drives?.map((d) => d.id)).toEqual(['drive', 'drive2']);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('navega por carpetas y excluye accesos directos y archivos', async () => {
    fetcher
      .mockResolvedValueOnce(response({ value: [{ id: 'drive' }] }))
      .mockResolvedValueOnce(response({ id: 'folder', folder: {} }))
      .mockResolvedValueOnce(
        response({
          value: [
            { id: 'child', name: 'Tarifas', folder: {} },
            { id: 'file', file: {} },
            { id: 'shortcut', folder: {}, remoteItem: {} },
          ],
        }),
      );
    const result = await service().browse({
      connectionId: id,
      siteId: 'site',
      driveId: 'drive',
      itemId: 'folder',
    });
    expect(result.folders?.map((f) => f.id)).toEqual(['child']);
  });
  it('rechaza un drive de otro sitio antes de consultar sus archivos', async () => {
    fetcher.mockResolvedValue(response({ value: [{ id: 'allowed-drive' }] }));
    await expect(
      service().browse({
        connectionId: id,
        siteId: 'site',
        driveId: 'other-drive',
      }),
    ).rejects.toThrow('OUTSIDE_SCOPE');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('no admite enlaces a archivos, orígenes arbitrarios ni cursores de otra carpeta', async () => {
    await expect(
      service().browse({
        connectionId: id,
        siteUrl: 'https://evil.invalid/sites/test',
      }),
    ).rejects.toThrow('INVALID_SHAREPOINT_URL');
    await expect(
      service().browse({
        connectionId: id,
        siteUrl: 'https://tenant.sharepoint.com/sites/test/docs/file.pdf',
      }),
    ).rejects.toThrow('SITE_URL_REQUIRED');
    fetcher
      .mockResolvedValueOnce(response({ value: [{ id: 'drive' }] }))
      .mockResolvedValueOnce(response({ id: 'folder', folder: {} }));
    await expect(
      service().browse({
        connectionId: id,
        siteId: 'site',
        driveId: 'drive',
        itemId: 'folder',
        next: 'https://graph.microsoft.com/v1.0/drives/other/items/other/children',
      }),
    ).rejects.toThrow('INVALID_GRAPH_URL');
  });
  it('comprueba la raíz y registra antecesores antes de crear la fuente', async () => {
    fetcher
      .mockResolvedValueOnce(response({ value: [{ id: 'drive' }] }))
      .mockResolvedValueOnce(
        response({
          id: 'folder',
          folder: {},
          webUrl: 'https://tenant.sharepoint.com/sites/test/docs',
          parentReference: { id: 'root' },
        }),
      )
      .mockResolvedValueOnce(response({ id: 'root', folder: {} }));
    await service().operate(create);
    expect(command).toHaveBeenCalledWith(
      'create',
      expect.objectContaining({
        ancestors: ['root'],
        reviewOnly: true,
        webUrl: 'https://tenant.sharepoint.com/sites/test/docs',
      }),
    );
  });
  it('no crea fuentes para archivos ni accesos directos', async () => {
    fetcher
      .mockResolvedValueOnce(response({ value: [{ id: 'drive' }] }))
      .mockResolvedValueOnce(
        response({
          id: 'folder',
          file: {},
          webUrl: 'https://tenant.sharepoint.com/sites/test/doc',
        }),
      );
    await expect(service().operate(create)).rejects.toThrow('FOLDER_REQUIRED');
    expect(command.mock.calls.some((call) => call[0] === 'create')).toBe(false);
  });
  it('rechaza ciclos en los antecesores y nunca guarda una raíz incompleta', async () => {
    fetcher
      .mockResolvedValueOnce(response({ value: [{ id: 'drive' }] }))
      .mockImplementation(async () =>
        response({
          id: 'folder',
          folder: {},
          webUrl: 'https://tenant.sharepoint.com/sites/test/docs',
          parentReference: { id: 'folder' },
        }),
      );
    await expect(service().operate(create)).rejects.toThrow('OUTSIDE_SCOPE');
    expect(command.mock.calls.some((call) => call[0] === 'create')).toBe(false);
  });
  it('valida identidades, acciones y paginación antes de mutar datos', async () => {
    const s = service();
    await expect(s.operate({ ...create, userId: 'other' })).rejects.toThrow();
    await expect(s.operate({ action: 'token_save', id })).rejects.toThrow();
    expect(() => s.items(id, -100)).toThrow('INVALID_INPUT');
    await s.operate({ action: 'pause', id });
    expect(command).toHaveBeenCalledWith('pause', { action: 'pause', id });
  });
});
