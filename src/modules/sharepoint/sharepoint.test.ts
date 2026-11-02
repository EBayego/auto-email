import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import {
  createSharePointGraph,
  graphUrl,
  sharePointWebUrl,
  boundedBody,
} from '@/providers/sharepoint';
import { verifySharePointEvidence } from './service';
import { importedFormat, extractImportedDocument } from './extraction';
import { sealMicrosoft, openMicrosoft } from './crypto';
import { SecretValue } from '@/config/env';
import { readSharePointConfig } from '@/config/sharepoint';
import {
  connectorOperationSchema,
  sharePointLimits,
  type SharePointStore,
} from './contracts';
import { syncSharePointConnector } from '@/worker/sharepoint';

const id = '00000000-0000-4000-8000-000000000101';
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
const connector = {
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
  audience_kind: 'GENERAL' as const,
  audience_key: '',
  status: 'ACTIVE' as const,
  phase: 'DELTA' as const,
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
};
const item = {
  item_id: 'file',
  parent_id: 'folder',
  name: 'tarifas.txt',
  etag: 'v1',
  size: 17,
  mime_type: 'text/plain',
  web_url: 'https://tenant.sharepoint.com/sites/test/tarifas.txt',
  modified_at: '2026-11-02T00:00:00Z',
  is_folder: false,
  status: 'PENDING',
  document_id: null,
  in_scope: true,
  error_code: null,
};
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers });

describe('SharePoint: configuración y límites de acceso', () => {
  it('queda desactivado sin configuración y exige tenant, secreto y clave al habilitar', () => {
    expect(readSharePointConfig({})).toBeNull();
    expect(() => readSharePointConfig({ SHAREPOINT_ENABLED: 'true' })).toThrow(
      'MICROSOFT_ALLOWED_TENANTS',
    );
    expect(
      readSharePointConfig({
        SHAREPOINT_ENABLED: 'true',
        APP_URL: 'http://localhost:3000',
        MICROSOFT_CLIENT_ID: id,
        MICROSOFT_CLIENT_SECRET: 'fixture',
        MICROSOFT_TOKEN_ENCRYPTION_KEY: config.encryptionKey.reveal(),
        MICROSOFT_ALLOWED_TENANTS: id,
      })?.scope,
    ).toBe('Sites.Read.All');
  });
  it('rechaza secretos públicos y endpoints OCR arbitrarios', () => {
    expect(() =>
      readSharePointConfig({ NEXT_PUBLIC_MICROSOFT_CLIENT_SECRET: 'secret' }),
    ).toThrow();
    expect(() =>
      readSharePointConfig({
        SHAREPOINT_ENABLED: 'true',
        SHAREPOINT_OCR_ENDPOINT: 'https://evil.invalid',
        SHAREPOINT_OCR_KEY: 'fixture',
      }),
    ).toThrow();
  });
  it('liga el cifrado a usuario, tenant e identidad', () => {
    const encrypted = sealMicrosoft(
      'cache',
      config.encryptionKey,
      `${id}:tenant:identity`,
    );
    expect(encrypted).not.toContain('cache');
    expect(
      openMicrosoft(encrypted, config.encryptionKey, `${id}:tenant:identity`),
    ).toBe('cache');
    expect(() =>
      openMicrosoft(encrypted, config.encryptionKey, 'other'),
    ).toThrow('CREDENTIAL_UNAVAILABLE');
  });
  it('solo permite URLs Graph v1 y SharePoint HTTPS sin credenciales', () => {
    expect(graphUrl('/drives/drive/root/delta')).toContain(
      'graph.microsoft.com/v1.0/',
    );
    for (const url of [
      'https://evil.invalid/v1.0/me',
      'https://graph.microsoft.com@evil.invalid/v1.0/me',
      'https://graph.microsoft.com/beta/me',
    ])
      expect(() => graphUrl(url)).toThrow();
    expect(() => sharePointWebUrl('javascript:alert(1)')).toThrow();
    expect(() =>
      sharePointWebUrl('https://tenant.sharepoint.com.evil.invalid/doc'),
    ).toThrow();
  });
  it('valida audiencia, periodicidad y prohíbe identidades en las operaciones públicas', () => {
    expect(
      connectorOperationSchema.safeParse({
        action: 'sync',
        id,
        userId: 'other',
      }).success,
    ).toBe(false);
    expect(
      connectorOperationSchema.safeParse({
        action: 'configure',
        id,
        recursive: true,
        intervalMinutes: 1,
        audience: { kind: 'GENERAL', key: '' },
        reviewOnly: true,
      }).success,
    ).toBe(false);
  });
});
describe('SharePoint Graph', () => {
  it('comprueba todos los antecesores por ID, incluida la raíz', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      return json(
        path.endsWith('/file')
          ? {
              id: 'file',
              file: {},
              eTag: 'v1',
              parentReference: { id: 'child' },
            }
          : path.endsWith('/child')
            ? { id: 'child', folder: {}, parentReference: { id: 'folder' } }
            : { id: 'folder', folder: {} },
      );
    });
    const graph = createSharePointGraph(async () => 'fixture', fetcher);
    await expect(
      graph.assertInRoot('drive', 'folder', 'file', true),
    ).resolves.toMatchObject({ id: 'file' });
    await expect(
      graph.assertInRoot('drive', 'folder', 'file', false),
    ).rejects.toThrow('OUTSIDE_SCOPE');
    expect(
      fetcher.mock.calls.every(([, init]) => init?.redirect === 'error'),
    ).toBe(true);
  });
  it('rechaza ciclos, accesos directos y raíces sin acceso', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({ id: 'file', file: {}, parentReference: { id: 'file' } }),
      );
    await expect(
      createSharePointGraph(async () => 'x', fetcher).assertInRoot(
        'drive',
        'folder',
        'file',
        true,
      ),
    ).rejects.toThrow('OUTSIDE_SCOPE');
    fetcher.mockResolvedValue(
      json({
        id: 'file',
        file: {},
        remoteItem: {},
        parentReference: { id: 'folder' },
      }),
    );
    await expect(
      createSharePointGraph(async () => 'x', fetcher).assertInRoot(
        'drive',
        'folder',
        'file',
        true,
      ),
    ).rejects.toThrow('OUTSIDE_SCOPE');
  });
  it('no reenvía el bearer a la URL temporal de descarga', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://tenant.sharepoint.com/download/file' },
        }),
      )
      .mockResolvedValueOnce(new Response('data'));
    const result = await createSharePointGraph(
      async () => 'fixture',
      fetcher,
    ).download('drive', 'file');
    expect(Buffer.from(result).toString()).toBe('data');
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({
      Authorization: 'Bearer fixture',
    });
    expect(fetcher.mock.calls[1][1]?.headers).toBeUndefined();
    expect(fetcher.mock.calls[1][1]?.redirect).toBe('error');
  });
  it('rechaza descargas a otra máquina y cursores maliciosos', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/private' },
      }),
    );
    await expect(
      createSharePointGraph(async () => 'x', fetcher).download('drive', 'file'),
    ).rejects.toThrow('INVALID_DOWNLOAD_URL');
    fetcher.mockResolvedValue(
      json({ value: [], '@odata.nextLink': 'https://evil.invalid/' }),
    );
    await expect(
      createSharePointGraph(async () => 'x', fetcher).page(
        '/drives/drive/root/delta',
      ),
    ).rejects.toThrow('INVALID_GRAPH_URL');
  });
  it.each([
    [403, 'ACCESS_DENIED'],
    [401, 'REAUTH_REQUIRED'],
    [410, 'CURSOR_EXPIRED'],
    [429, 'THROTTLED'],
  ])('categoriza HTTP %s sin filtrar el cuerpo', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('private-provider-error', {
        status: Number(status),
        headers: { 'retry-after': '120' },
      }),
    );
    await expect(
      createSharePointGraph(async () => 'x', fetcher).item('drive', 'file'),
    ).rejects.toMatchObject({ code, retryAfter: 120 });
  });
  it('limita también los cuerpos sin content-length', async () => {
    await expect(boundedBody(new Response('12345'), 4)).rejects.toThrow(
      'FILE_TOO_LARGE',
    );
  });
});
describe('SharePoint: extracción', () => {
  it('lee CSV con comillas y conserva cabeceras y valores', async () => {
    const out = await extractImportedDocument(
      Buffer.from('Producto;Precio\n"Plan; A";125\n'),
      'tarifas.csv',
    );
    expect(out.text).toContain('Producto: Plan; A');
    expect(out.text).toContain('Precio: 125');
  });
  it('extrae HTML sin ejecutar scripts ni resolver recursos', async () => {
    const out = await extractImportedDocument(
      Buffer.from(
        '<h1>Tarifas</h1><script>secret()</script><p>Precio: 125 EUR.</p>',
      ),
      'tarifas.html',
    );
    expect(out.text).toContain('125 EUR');
    expect(out.text).not.toContain('secret()');
  });
  it('extrae Excel con hoja, coordenadas y fórmulas sin ejecutar', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/workbook.xml',
      '<workbook><sheets><sheet name="Tarifas" r:id="r1"/></sheets></workbook>',
    );
    zip.file(
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    zip.file('xl/sharedStrings.xml', '<sst><si><t>Precio</t></si></sst>');
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2"><f>100+25</f><v>125</v></c><c r="B2"><f>EXEC()</f></c></row></sheetData></worksheet>',
    );
    const out = await extractImportedDocument(
      await zip.generateAsync({ type: 'uint8array' }),
      'tarifas.xlsx',
    );
    expect(out.text).toContain('Hoja: Tarifas');
    expect(out.text).toContain('Precio (A2): 125');
    expect(out.text).toContain('fórmula sin valor guardado');
    expect(out.text).not.toContain('EXEC()');
  });
  it('conserva diapositivas y notas de PowerPoint', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld><a:p><a:r><a:t>Precio: 125 EUR.</a:t></a:r></a:p></p:sld>',
    );
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      '<Relationships><Relationship Type="x/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    );
    zip.file(
      'ppt/notesSlides/notesSlide1.xml',
      '<p:notes><a:p><a:r><a:t>Válido hasta diciembre.</a:t></a:r></a:p></p:notes>',
    );
    const out = await extractImportedDocument(
      await zip.generateAsync({ type: 'uint8array' }),
      'tarifas.pptx',
    );
    expect(out.text).toContain('Diapositiva 1');
    expect(out.text).toContain('125 EUR');
    expect(out.text).toContain('Válido hasta diciembre');
  });
  it('rechaza XML con entidades y formatos que no puede leer', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/workbook.xml',
      '<!DOCTYPE workbook [<!ENTITY x SYSTEM "file:///private">]><workbook/>',
    );
    await expect(
      extractImportedDocument(
        await zip.generateAsync({ type: 'uint8array' }),
        'bad.xlsx',
      ),
    ).rejects.toThrow('UNSAFE_FILE');
    expect(() => importedFormat('data.xlsm')).toThrow('UNSUPPORTED_FORMAT');
    await expect(
      extractImportedDocument(Buffer.from('image'), 'scan.png'),
    ).rejects.toThrow('OCR_NOT_CONFIGURED');
  });
});
describe('SharePoint: evidencia y trabajo duradero', () => {
  const meta = {
    ...item,
    document_id: id,
    status: 'READY',
    connector,
    connection_version: 1,
    connection_status: 'CONNECTED',
    document_version: 1,
  };
  it('verifica versión remota y vuelve a comprobar la conexión local', async () => {
    const command = vi.fn().mockResolvedValue([meta]);
    const assertInRoot = vi
      .fn()
      .mockResolvedValue({ eTag: 'v1', webUrl: item.web_url });
    const store = { command } as SharePointStore;
    const graph = { assertInRoot } as unknown as ReturnType<
      typeof createSharePointGraph
    >;
    await verifySharePointEvidence(store, () => graph, [
      { document_id: id, version: 1, connector_id: id },
    ]);
    expect(command).toHaveBeenCalledTimes(2);
    expect(assertInRoot).toHaveBeenCalledWith('drive', 'folder', 'file', true);
  });
  it('rechaza versiones distintas, desconexiones y pérdida de referencias', async () => {
    const store = {
      command: vi.fn().mockResolvedValue([meta]),
    } as SharePointStore;
    const graph = {
      assertInRoot: vi
        .fn()
        .mockResolvedValue({ eTag: 'v2', webUrl: item.web_url }),
    } as unknown as ReturnType<typeof createSharePointGraph>;
    await expect(
      verifySharePointEvidence(store, () => graph, [
        { document_id: id, version: 1, connector_id: id },
      ]),
    ).rejects.toThrow('EVIDENCE_CHANGED');
    vi.mocked(store.command).mockResolvedValue([]);
    await expect(
      verifySharePointEvidence(store, () => graph, [
        { document_id: id, version: 1, connector_id: id },
      ]),
    ).rejects.toThrow('EVIDENCE_UNAVAILABLE');
    vi.mocked(store.command)
      .mockResolvedValueOnce([meta])
      .mockResolvedValueOnce([{ ...meta, connection_version: 2 }]);
    vi.mocked(graph.assertInRoot).mockResolvedValue({
      id: 'file',
      eTag: 'v1',
      webUrl: item.web_url,
    });
    await expect(
      verifySharePointEvidence(
        store,
        () => graph,
        [{ document_id: id, version: 1, connector_id: id }],
        { forDraft: true },
      ),
    ).rejects.toThrow('PREWRITE_EVIDENCE_CHANGED');
  });
  it('persiste páginas antes de indexar y no avanza un fallo', async () => {
    const command = vi
      .fn()
      .mockImplementation(async (action: string) =>
        action === 'pending' ? [item] : true,
      );
    const graph = {
      page: vi.fn().mockResolvedValue({
        items: [
          { id: 'folder', folder: {} },
          { id: 'file', file: {}, eTag: 'v1' },
        ],
        next: null,
        delta:
          'https://graph.microsoft.com/v1.0/drives/drive/root/delta?token=x',
      }),
      assertInRoot: vi
        .fn()
        .mockResolvedValue({ eTag: 'v1', webUrl: item.web_url }),
      download: vi.fn().mockResolvedValue(Buffer.from('Precio: 125 EUR.')),
      item: vi.fn().mockResolvedValue({ eTag: 'v1' }),
    } as unknown as ReturnType<typeof createSharePointGraph>;
    await expect(
      syncSharePointConnector(
        { ...connector },
        { command } as SharePointStore,
        graph,
        config,
      ),
    ).resolves.toEqual({ failed: false });
    expect(command.mock.calls.map((c) => c[0])).toEqual([
      'page',
      'pending',
      'document_save',
      'release',
    ]);
    expect(command.mock.calls[2][1]).toMatchObject({
      itemId: 'file',
      text: 'Precio: 125 EUR.',
    });
    expect(sharePointLimits.maxFiles).toBeGreaterThan(10);
  });
});
