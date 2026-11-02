import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { buildDocumentIndex } from '@/modules/knowledge/document-index';

// Real PostgreSQL execution in memory. The auth/storage services are represented
// only by their SQL boundary; the document/source migrations themselves are real.
const owner = '00000000-0000-4000-8000-000000000201';
const other = '00000000-0000-4000-8000-000000000202';
const tenant = '00000000-0000-4000-8000-000000000203';
let db: PGlite;
let connection: string;
let connector: string;
let source: string;
let lease: string;
let document: string;
async function command<T = unknown>(
  action: string,
  input: Record<string, unknown> = {},
  user: string | null = owner,
) {
  const result = await db.query<{ value: T }>(
    'select public.sharepoint_command($1,$2,$3::jsonb) as value',
    [user, action, JSON.stringify(input)],
  );
  return result.rows[0].value;
}
const migration = (name: string) =>
  readFile(`supabase/migrations/${name}`, 'utf8');
describe('SharePoint: migración, RPC, RLS e índice en PostgreSQL', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.users(id uuid primary key,status text not null default 'ACTIVE');
      create function public.touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      grant select on public.users to authenticated;
      insert into public.users(id) values('${owner}'),('${other}');
    `);
    await db.exec(
      await migration('20261021195132_mail036_knowledge_documents.sql'),
    );
    await db.exec(
      await migration('20261021214653_mail037_knowledge_chunks.sql'),
    );
    await db.exec(
      await migration('20261023174121_mail038_knowledge_sources.sql'),
    );
    const provenance = await migration(
      '20261023215536_mail040_knowledge_provenance.sql',
    );
    await db.exec(
      provenance.slice(
        0,
        provenance.lastIndexOf('alter table public.draft_generations'),
      ),
    );
    await db.exec(
      "alter table public.source_documents add column audience_kind text not null default 'GENERAL',add column audience_key text not null default '';",
    );
    const privacy = await migration(
      '20261031193000_mail061_privacy_authorizations.sql',
    );
    await db.exec(
      privacy.slice(
        0,
        privacy.indexOf('create function public.grant_privacy_authorization'),
      ),
    );
    await db.query(
      "insert into public.privacy_authorizations(user_id,notice_version,notice_hash,notice_text) select id,'mail061-v1',repeat('a',64),repeat('synthetic test notice ',10) from public.users",
    );
    await db.exec(await migration('20261102120000_sharepoint_connectors.sql'));
  }, 60000);
  afterAll(async () => {
    await db?.close();
  });
  it('crea conexiones y carpetas con fuente y ámbito propios', async () => {
    const saved = await command<{ id: string }>('connection_save', {
      tenant,
      account: 'fixture-account',
      username: 'test@example.invalid',
      cache: 'encrypted-fixture',
    });
    connection = saved.id;
    const created = await command<{ id: string; sourceId: string }>('create', {
      connectionId: connection,
      title: 'Tarifas',
      siteId: 'site',
      driveId: 'drive',
      rootId: 'folder',
      ancestors: ['root'],
      webUrl: 'https://tenant.sharepoint.com/sites/test/folder',
      recursive: true,
      intervalMinutes: 15,
      audience: { kind: 'GENERAL', key: '' },
      reviewOnly: false,
    });
    connector = created.id;
    source = created.sourceId;
    const listing = await command<{
      connections: Record<string, unknown>[];
      connectors: Record<string, unknown>[];
    }>('list');
    expect(listing.connections[0]).not.toHaveProperty('cache');
    expect(listing.connectors[0]).not.toHaveProperty('lease_id');
    expect(listing.connectors[0]).not.toHaveProperty('delta_link');
    expect(listing.connectors[0].source_id).toBe(source);
  });
  it('rechaza carpetas solapadas y modificaciones de otro propietario', async () => {
    await expect(command('pause', { id: connector }, other)).rejects.toThrow(
      'CONNECTOR_NOT_FOUND',
    );
    await expect(
      command('create', {
        connectionId: connection,
        title: 'Solapada',
        siteId: 'site',
        driveId: 'drive',
        rootId: 'child',
        ancestors: ['folder', 'root'],
        webUrl: 'https://tenant.sharepoint.com/sites/test/child',
        recursive: true,
        intervalMinutes: 15,
        audience: { kind: 'GENERAL', key: '' },
        reviewOnly: false,
      }),
    ).rejects.toThrow('OVERLAPPING_ROOTS');
  });
  it('consume OAuth una sola vez y no permite usar el estado de otro propietario', async () => {
    await command('oauth_put', {
      hash: 'state-hash',
      secret: 'encrypted-verifier',
    });
    await expect(
      command('oauth_take', { hash: 'state-hash' }, other),
    ).rejects.toThrow('INVALID_OAUTH_STATE');
    expect(await command('oauth_take', { hash: 'state-hash' })).toBe(
      'encrypted-verifier',
    );
    await expect(command('oauth_take', { hash: 'state-hash' })).rejects.toThrow(
      'INVALID_OAUTH_STATE',
    );
    await command('token_acquire', { id: connection, lease: owner });
    await expect(
      command('token_acquire', { id: connection, lease: other }),
    ).rejects.toThrow('TOKEN_BUSY');
    await expect(
      command('token_save', { id: connection, lease: other, cache: 'wrong' }),
    ).rejects.toThrow('TOKEN_BUSY');
    await command('token_release', { id: connection, lease: owner });
  });
  it('persiste páginas, relaciones y trabajos antes del cursor', async () => {
    expect(
      await command('claim', { noticeHash: 'b'.repeat(64) }, null),
    ).toBeNull();
    const work = await command<{ lease_id: string }>('claim', {}, null);
    lease = work.lease_id;
    const items = [
      { id: 'root', folder: {} },
      { id: 'folder', folder: {}, parentReference: { id: 'root' } },
      {
        id: 'file',
        name: 'tarifas.txt',
        eTag: 'v1',
        size: 17,
        file: { mimeType: 'text/plain' },
        webUrl: 'https://tenant.sharepoint.com/sites/test/tarifas.txt',
        parentReference: { id: 'folder' },
      },
    ];
    await command('page', {
      id: connector,
      lease,
      items,
      next: null,
      delta: 'https://graph.microsoft.com/v1.0/drives/drive/root/delta?token=1',
    });
    const pending = await command<{ item_id: string }[]>('pending', {
      id: connector,
      lease,
    });
    expect(pending.map((i) => i.item_id)).toEqual(['file']);
    await expect(
      command('pending', { id: connector, lease: other }),
    ).rejects.toThrow('CONNECTOR_LEASE_LOST');
  });
  it('activa texto e índice atómicamente y mantiene separada la búsqueda manual', async () => {
    const text = 'Precio: 125 EUR.';
    await command('document_save', {
      id: connector,
      lease,
      itemId: 'file',
      name: 'tarifas.txt',
      mime: 'text/plain',
      size: 17,
      hash: 'a'.repeat(64),
      url: 'https://tenant.sharepoint.com/sites/test/tarifas.txt',
      modifiedAt: '2026-11-02T00:00:00Z',
      text,
      index: buildDocumentIndex({ text }),
    });
    const result = await db.query<{ id: string; has_file: boolean }>(
      'select id,has_file from public.source_documents where connector_id=$1',
      [connector],
    );
    document = result.rows[0].id;
    expect(result.rows[0].has_file).toBe(false);
    const chunks = await db.query(
      'select * from public.knowledge_chunks where document_id=$1',
      [document],
    );
    expect(chunks.rows).toHaveLength(1);
    const manual = await db.query(
      'select * from public.search_knowledge_chunks($1,$2)',
      [owner, '125'],
    );
    expect(manual.rows).toHaveLength(0);
    const cfg = await db.query<{
      value: { revision: string; sources: { connectorId: string }[] };
    }>('select public.get_knowledge_source_configuration($1) as value', [
      owner,
    ]);
    expect(cfg.rows[0].value.sources[0].connectorId).toBe(connector);
    const evidence = await db.query(
      'select * from public.search_knowledge_context_chunks($1,$2,$3::uuid[],$4)',
      [owner, '125', [source], cfg.rows[0].value.revision],
    );
    expect(evidence.rows).toHaveLength(1);
  });
  it('no permite sacar un documento de su fuente mediante otras RPC', async () => {
    await expect(
      db.query(
        'update public.source_documents set source_id=null where id=$1',
        [document],
      ),
    ).rejects.toThrow('INVALID_CONNECTOR_DOCUMENT');
  });
  it('mantiene la cuota manual independiente de los documentos importados', async () => {
    await db.exec('begin');
    try {
      await db.query(
        "insert into public.source_documents(user_id,name,mime_type,byte_size,sha256,status,error_code) select $1,'manual-'||n||'.txt','text/plain',1,repeat('b',64),'FAILED','INVALID_FORMAT' from generate_series(1,9) n",
        [owner],
      );
      const tenth = await db.query(
        'select (public.reserve_source_document($1,$2,$3,1,$4)).id as id',
        [owner, 'manual-10.txt', 'text/plain', 'b'.repeat(64)],
      );
      expect(tenth.rows).toHaveLength(1);
      await expect(
        db.query('select public.reserve_source_document($1,$2,$3,1,$4)', [
          owner,
          'manual-11.txt',
          'text/plain',
          'b'.repeat(64),
        ]),
      ).rejects.toThrow('DOCUMENT_LIMIT');
    } finally {
      await db.exec('rollback');
    }
  });
  it('no permite asignar documentos manuales a una fuente de conector', async () => {
    await db.exec('begin');
    try {
      const manual = await db.query<{ id: string }>(
        'select (public.reserve_source_document($1,$2,$3,1,$4)).id as id',
        [owner, 'manual.txt', 'text/plain', 'b'.repeat(64)],
      );
      await expect(
        db.query('select public.assign_document_source($1,$2,$3)', [
          owner,
          manual.rows[0].id,
          source,
        ]),
      ).rejects.toThrow('INVALID_CONNECTOR_DOCUMENT');
    } finally {
      await db.exec('rollback');
    }
  });
  it('limita excepciones de audiencia y el presupuesto OCR de forma atómica', async () => {
    await command('file_audience', {
      id: connector,
      itemId: 'file',
      audience: { kind: 'RECIPIENT', key: 'cliente@example.invalid' },
    });
    expect(
      (
        await db.query<{ audience_key: string }>(
          'select audience_key from public.source_documents where id=$1',
          [document],
        )
      ).rows[0].audience_key,
    ).toBe('cliente@example.invalid');
    await expect(
      command('configure', {
        id: connector,
        recursive: true,
        intervalMinutes: 15,
        audience: { kind: 'DOMAIN', key: 'another.invalid' },
        reviewOnly: false,
      }),
    ).rejects.toThrow('AUDIENCE_CONFLICT');
    await command('ocr_reserve', { pages: 101, limit: 150 });
    await expect(
      command('ocr_reserve', { pages: 101, limit: 150 }),
    ).rejects.toThrow('OCR_DAILY_BUDGET');
    const data = await command<{ connections: Record<string, unknown>[] }>(
      'export',
    );
    expect(data.connections[0]).not.toHaveProperty('cache');
  });
  it('RLS impide leer directamente el texto y las credenciales importadas', async () => {
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`,
    );
    try {
      expect(
        (await db.query('select * from public.source_documents')).rows,
      ).toHaveLength(0);
      expect(
        (await db.query('select * from public.source_document_texts')).rows,
      ).toHaveLength(0);
      expect(
        (await db.query('select * from public.knowledge_chunks')).rows,
      ).toHaveLength(0);
      await expect(
        db.query('select * from public.microsoft_connections'),
      ).rejects.toThrow('permission denied');
      await expect(command('list')).rejects.toThrow('permission denied');
    } finally {
      await db.exec('reset role');
    }
  });
  it('retira descendientes de carpetas movidas fuera del ámbito', async () => {
    await command('release', { id: connector, lease });
    await command('sync', { id: connector });
    const work = await command<{ lease_id: string }>('claim', {}, null);
    lease = work.lease_id;
    await command('page', {
      id: connector,
      lease,
      items: [{ id: 'file', eTag: 'v1', parentReference: { id: 'root' } }],
      next: null,
      delta: 'https://graph.microsoft.com/v1.0/drives/drive/root/delta?token=2',
    });
    expect(
      (
        await db.query('select id from public.source_documents where id=$1', [
          document,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          'select id from public.knowledge_chunks where document_id=$1',
          [document],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it('retirar privacidad cancela trabajos y bloquea accesos antes de cada petición', async () => {
    await db.exec('begin');
    try {
      await db.query(
        'update public.privacy_authorizations set withdrawn_at=clock_timestamp() where user_id=$1',
        [owner],
      );
      expect(
        (
          await db.query<{ status: string; cache: string }>(
            'select status,cache from public.microsoft_connections where id=$1',
            [connection],
          )
        ).rows[0],
      ).toEqual({ status: 'REAUTH_REQUIRED', cache: '' });
      expect(
        (
          await db.query<{ status: string }>(
            'select status from public.knowledge_connectors where id=$1',
            [connector],
          )
        ).rows[0].status,
      ).toBe('PAUSED');
      await expect(command('assert_read', { id: connection })).rejects.toThrow(
        'PRIVACY_CONSENT_REQUIRED',
      );
    } finally {
      await db.exec('rollback');
    }
  });
  it('invalida credenciales e índices al retirar la cuenta', async () => {
    await command('disconnect', { id: connection });
    expect(
      (await db.query('select id from public.knowledge_connectors')).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('select id from public.microsoft_connections')).rows,
    ).toHaveLength(0);
    const listing = await command<{ connectors: unknown[] }>('list');
    expect(listing.connectors).toHaveLength(0);
  });
});
