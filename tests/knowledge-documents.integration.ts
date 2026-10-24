import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import type { Database } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import { createKnowledgeDocuments } from '@/db/knowledge-documents';
import { textPdf, wordDocx } from './fixtures/documents';

const url = process.env.AUTO_EMAIL_TEST_URL!;
const origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const secret = process.env.AUTO_EMAIL_TEST_SECRET_KEY!;
const service = createClient<Database>(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
type Owner = {
  id: string;
  client: ReturnType<typeof createAuthClient>;
  jar: Map<string, string>;
};
const owners: Owner[] = [];
const cookie = (index = 0) =>
  [...owners[index].jar].map(([k, v]) => `${k}=${v}`).join('; ');
const path = '/api/knowledge/documents';
function request(suffix = '', init: RequestInit = {}, index = 0) {
  return fetch(`${origin}${path}${suffix}`, {
    ...init,
    headers: { origin, cookie: cookie(index), ...init.headers },
    redirect: 'manual',
  });
}
async function upload(name: string, bytes: BlobPart, type: string, index = 0) {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type }), name);
  return request('', { method: 'POST', body: form }, index);
}
async function removeAll() {
  for (const owner of owners) {
    const rows = await service
      .from('source_documents')
      .select('id')
      .eq('user_id', owner.id);
    if (rows.data?.length)
      await service.storage
        .from('knowledge-documents')
        .remove(rows.data.map((d) => `${owner.id}/${d.id}`));
    await service.from('source_documents').delete().eq('user_id', owner.id);
  }
}

describe('MAIL-036 documentos, Storage y HTTP real', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const email = `knowledge-${crypto.randomUUID()}@example.invalid`,
        password = `Test-${crypto.randomUUID()}!`;
      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const jar = new Map<string, string>();
      const client = createAuthClient({
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const c of cookies) {
            if (c.options.maxAge === 0) jar.delete(c.name);
            else jar.set(c.name, c.value);
          }
        },
      });
      owners.push({ id: created.data.user!.id, client, jar });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
    }
  });
  afterAll(async () => {
    await removeAll();
    for (const owner of owners) await service.auth.admin.deleteUser(owner.id);
  });
  it('requiere sesión y rechaza CSRF', async () => {
    expect((await fetch(`${origin}${path}`)).status).toBe(401);
    expect(
      (
        await request('', {
          method: 'POST',
          headers: { origin: 'https://evil.invalid' },
        })
      ).status,
    ).toBe(400);
  });
  it('carga los tres formatos, conserva propietario y versión y permite descargar el original', async () => {
    for (const [name, bytes, type, expected] of [
      [
        'precios.txt',
        Buffer.from('Información vigente: 125 €.'),
        'text/plain',
        '125 €',
      ],
      ['tarifas.pdf', textPdf(), 'application/pdf', '125 EUR'],
      [
        'soporte.docx',
        await wordDocx(),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Procedimiento de soporte',
      ],
    ] as const) {
      const response = await upload(name, new Uint8Array(bytes), type);
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(201);
      const doc = body.document;
      expect(doc).toMatchObject({
        name,
        version: 1,
        status: 'READY',
        byte_size: bytes.length,
      });
      expect(doc.user_id).toBeUndefined();
      const text = await service
        .from('source_document_texts')
        .select('*')
        .eq('document_id', doc.id)
        .single();
      expect(text.data?.user_id).toBe(owners[0].id);
      expect(text.data?.text_content).toContain(expected);
      const download = await request(`/${doc.id}`);
      expect(download.status).toBe(200);
      expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
      expect(download.headers.get('content-disposition')).toContain(
        'attachment',
      );
    }
  });
  it('aísla metadatos, texto, originales, URLs firmadas y escrituras directas', async () => {
    const docs = (await (await request()).json()).documents;
    const id = docs[0].id;
    expect((await (await request('', {}, 1)).json()).documents).toEqual([]);
    expect((await request(`/${id}`, {}, 1)).status).toBe(404);
    expect((await request(`/${id}`, { method: 'DELETE' }, 1)).status).toBe(404);
    expect(
      (await owners[1].client.from('source_document_texts').select('*')).data,
    ).toEqual([]);
    const otherStorage = owners[1].client.storage.from('knowledge-documents');
    expect(
      (
        await owners[0].client.storage
          .from('knowledge-documents')
          .download(`${owners[0].id}/${id}`)
      ).error,
    ).toBeNull();
    expect(
      (await otherStorage.download(`${owners[0].id}/${id}`)).error,
    ).not.toBeNull();
    expect(
      (await otherStorage.createSignedUrl(`${owners[0].id}/${id}`, 60)).error,
    ).not.toBeNull();
    expect(
      (
        await owners[0].client.storage
          .from('knowledge-documents')
          .upload(`${owners[0].id}/unvalidated`, new Blob(['invalid']))
      ).error,
    ).not.toBeNull();
    const publicUrl = service.storage
      .from('knowledge-documents')
      .getPublicUrl(`${owners[0].id}/${id}`).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);
  });
  it('busca fragmentos con procedencia, consulta por secciones y aplica RLS al índice', async () => {
    const response = await fetch(`${origin}/api/knowledge/search?q=125`, {
      headers: { cookie: cookie() },
    });
    expect(response.status).toBe(200);
    const matches = (await response.json()).matches;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toMatchObject({
      version: 1,
      document_name: expect.any(String),
      chunk_id: expect.any(String),
      content: expect.stringContaining('125'),
    });
    const pdf = matches.find(
      (m: { document_name: string }) => m.document_name === 'tarifas.pdf',
    );
    expect(pdf.page_start).toBe(1);
    const chunks = await request(`/${pdf.document_id}/chunks?offset=0&limit=1`);
    expect(chunks.status).toBe(200);
    expect((await chunks.json()).chunks).toHaveLength(1);
    expect((await request(`/${pdf.document_id}/chunks`, {}, 1)).status).toBe(
      404,
    );
    expect(
      (await owners[1].client.from('knowledge_chunks').select('*')).data,
    ).toEqual([]);
    expect(
      (await owners[0].client.from('knowledge_chunks').select('*')).data!
        .length,
    ).toBeGreaterThan(0);
    const otherSearch = await fetch(`${origin}/api/knowledge/search?q=125`, {
      headers: { cookie: cookie(1) },
    });
    expect((await otherSearch.json()).matches).toEqual([]);
    expect((await fetch(`${origin}/api/knowledge/search?q=125`)).status).toBe(
      401,
    );
    expect(
      (
        await fetch(`${origin}/api/knowledge/search?q=125&userId=other`, {
          headers: { cookie: cookie() },
        })
      ).status,
    ).toBe(400);
  });
  it('reindexa de forma idempotente y protege el endpoint contra CSRF y recursos ajenos', async () => {
    const id = (await (await request()).json()).documents[0].id;
    const before = await service
      .from('knowledge_chunks')
      .select('id')
      .eq('document_id', id);
    expect(
      (
        await request(`/${id}/index`, {
          method: 'POST',
          headers: { origin: 'https://evil.invalid' },
        })
      ).status,
    ).toBe(400);
    expect((await request(`/${id}/index`, { method: 'POST' }, 1)).status).toBe(
      404,
    );
    expect((await request(`/${id}/index`, { method: 'POST' })).status).toBe(
      200,
    );
    expect(
      (
        await service
          .from('knowledge_chunks')
          .select('id')
          .eq('document_id', id)
      ).data,
    ).toEqual(before.data);
  });
  it('invalida una revisión anterior y publica solo los fragmentos del contenido actualizado', async () => {
    const created = await upload(
      'revision.txt',
      '# Tarifas\n\nCondición archivoobsoleto: 125 euros.',
      'text/plain',
    );
    expect(created.status).toBe(201);
    const id = (await created.json()).document.id;
    const bytes = Buffer.from(
      '# Procedimiento\n\nNuevo procedimiento azafran vigente.',
    );
    expect(
      (
        await service.storage
          .from('knowledge-documents')
          .upload(`${owners[0].id}/${id}`, bytes, {
            contentType: 'text/plain',
            upsert: true,
          })
      ).error,
    ).toBeNull();
    expect(
      (
        await service
          .from('source_documents')
          .update({
            version: 2,
            byte_size: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          })
          .eq('id', id)
      ).error,
    ).toBeNull();
    expect(
      (
        await service
          .from('source_document_texts')
          .update({ text_content: bytes.toString() })
          .eq('document_id', id)
      ).error,
    ).toBeNull();
    expect(
      (
        await service
          .from('knowledge_chunks')
          .select('id')
          .eq('document_id', id)
      ).data,
    ).toEqual([]);
    expect((await request(`/${id}/index`, { method: 'POST' })).status).toBe(
      200,
    );
    const docs = createKnowledgeDocuments(service, owners[0].id);
    expect(await docs.search('archivoobsoleto', 10, id)).toEqual([]);
    expect((await docs.search('azafran', 10, id))[0]).toMatchObject({
      version: 2,
      section: 'Procedimiento',
      document_name: 'revision.txt',
    });
    const index = await service
      .from('source_document_texts')
      .select('normalized_text')
      .eq('document_id', id)
      .single();
    expect(index.data?.normalized_text).toContain('azafran');
  });
  it('rechaza consultas y paginación fuera de límites', async () => {
    const docs = createKnowledgeDocuments(service, owners[0].id);
    await expect(docs.search('')).rejects.toThrow('INVALID_INPUT');
    await expect(docs.search('x'.repeat(301))).rejects.toThrow('INVALID_INPUT');
    await expect(docs.search('consulta', 21)).rejects.toThrow('INVALID_INPUT');
    const id = (await (await request()).json()).documents[0].id;
    expect((await request(`/${id}/chunks?limit=100`)).status).toBe(400);
    expect((await request(`/${id}/chunks?offset=-1`)).status).toBe(400);
  });
  it('indexa documentos creados antes de MAIL-037 a partir de su original privado', async () => {
    const bytes = Buffer.from(
      '# Manual\n\nCondición histórica verificable de soporte.',
    );
    const reserved = await service.rpc('reserve_source_document', {
      p_user_id: owners[0].id,
      p_name: 'anterior.txt',
      p_mime_type: 'text/plain',
      p_byte_size: bytes.length,
      p_sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(reserved.error).toBeNull();
    const id = reserved.data!.id;
    expect(
      (
        await service.storage
          .from('knowledge-documents')
          .upload(`${owners[0].id}/${id}`, bytes, { contentType: 'text/plain' })
      ).error,
    ).toBeNull();
    expect(
      (
        await service.rpc('complete_source_document', {
          p_user_id: owners[0].id,
          p_document_id: id,
          p_text: bytes.toString(),
        })
      ).error,
    ).toBeNull();
    expect((await request(`/${id}/chunks`)).status).toBe(404);
    expect((await request(`/${id}/index`, { method: 'POST' })).status).toBe(
      200,
    );
    expect(
      (
        await createKnowledgeDocuments(service, owners[0].id).search(
          'soporte',
          10,
          id,
        )
      )[0],
    ).toMatchObject({
      document_name: 'anterior.txt',
      section: 'Manual',
      version: 1,
    });
  });
  it('rechaza formatos falsos y conserva un estado seguro para fallos de procesamiento', async () => {
    expect(
      (await upload('mal.pdf', 'texto plano', 'application/pdf')).status,
    ).toBe(400);
    expect((await upload('mal.exe', 'texto plano', 'text/plain')).status).toBe(
      400,
    );
    const response = await upload(
      'corrupto.pdf',
      '%PDF-1.7\ninvalid',
      'application/pdf',
    );
    expect(response.status).toBe(400);
    const docs = (await (await request()).json()).documents;
    const failed = docs.find((d: { status: string }) => d.status === 'FAILED');
    expect(failed.error_code).toBe('INVALID_FORMAT');
    expect((await request(`/${failed.id}`)).status).toBe(404);
    expect((await request(`/${failed.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
  });
  it('reconcilia una respuesta perdida al completar sin borrar un original ya confirmado', async () => {
    const normalFetch = globalThis.fetch;
    const flaky = createClient<Database>(url, secret, {
      auth: { persistSession: false },
      global: {
        fetch: async (input, init) => {
          const result = await normalFetch(input, init);
          if (String(input).includes('/rpc/complete_indexed_source_document'))
            throw new Error('Lost response');
          return result;
        },
      },
    });
    const result = await createKnowledgeDocuments(flaky, owners[0].id).upload(
      new File(['Tarifa vigente'], 'incierto.txt', { type: 'text/plain' }),
    );
    expect(result.status).toBe('READY');
    expect((await request(`/${result.id}`)).status).toBe(200);
  });
  it('invalida texto incluso si Storage falla y permite reintentar la eliminación', async () => {
    const docs = (await (await request()).json()).documents;
    const id = docs[0].id;
    const normalFetch = globalThis.fetch;
    const failing = createClient<Database>(url, secret, {
      auth: { persistSession: false },
      global: {
        fetch: async (input, init) => {
          if (
            String(input).includes('/storage/v1/object/') &&
            init?.method === 'DELETE'
          )
            return new Response('{}', { status: 503 });
          return normalFetch(input, init);
        },
      },
    });
    await expect(
      createKnowledgeDocuments(failing, owners[0].id).remove(id),
    ).rejects.toThrow('UNAVAILABLE');
    expect(
      (
        await service
          .from('source_document_texts')
          .select('*')
          .eq('document_id', id)
      ).data,
    ).toEqual([]);
    expect((await request(`/${id}`)).status).toBe(404);
    expect((await request(`/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect(
      (await service.from('source_documents').select('*').eq('id', id)).data,
    ).toEqual([]);
    expect(
      (
        await service.storage
          .from('knowledge-documents')
          .download(`${owners[0].id}/${id}`)
      ).error,
    ).not.toBeNull();
  });
  it('serializa reservas y aplica la cuota incluso con solicitudes simultáneas', async () => {
    await removeAll();
    const inserted = await service.from('source_documents').insert(
      Array.from({ length: 9 }, (_, i) => ({
        user_id: owners[0].id,
        name: `fallo${i}.txt`,
        mime_type: 'text/plain',
        byte_size: 1,
        sha256: 'a'.repeat(64),
        status: 'FAILED',
        error_code: 'INVALID_FORMAT',
      })),
    );
    expect(inserted.error).toBeNull();
    const responses = await Promise.all([
      upload('uno.txt', 'dato uno', 'text/plain'),
      upload('dos.txt', 'dato dos', 'text/plain'),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await (await request()).json()).documents).toHaveLength(10);
  });
});
