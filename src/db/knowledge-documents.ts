import { createHash } from 'node:crypto';
import { documentAudienceSchema } from '@/modules/knowledge/audience';
import type { DataClient } from './models';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { extractDocumentContent } from '@/modules/knowledge/extract-document';
import { buildDocumentIndex } from '@/modules/knowledge/document-index';
import type { Json } from './database.types';
import {
  DocumentError,
  validateDocument,
  validateDocumentBytes,
  documentMimeTypes,
  type DocumentMetadata,
  documentValiditySchema,
} from '@/modules/knowledge/documents';

const bucket = 'knowledge-documents';
const columns =
  'id,name,mime_type,byte_size,version,status,error_code,text_length,uploaded_at,updated_at,indexed_at,chunk_count,indexer_version,source_id,content_updated_at,valid_from,valid_until,audience_kind,audience_key' as const;

export function createKnowledgeDocuments(
  client: DataClient,
  userId: string,
  extract: typeof extractDocumentContent = extractDocumentContent,
) {
  requireUuid(userId);
  const storage = client.storage.from(bucket);
  const objectKey = (id: string) => `${userId}/${id}`;
  async function find(id: string) {
    requireUuid(id);
    const { data, error } = await client
      .from('source_documents')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new DataAccessError('UNAVAILABLE');
    return requireResource(data);
  }
  return Object.freeze({
    async setAudience(id: string, input: unknown) {
      requireUuid(id);
      const parsed = documentAudienceSchema.safeParse(input);
      if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
      const result = await client.rpc('set_document_audience', {
        p_user_id: userId,
        p_document_id: id,
        p_kind: parsed.data.kind,
        p_key: parsed.data.key,
      });
      if (result.error) throw new DataAccessError('UNAVAILABLE');
      if (!result.data) throw new DataAccessError('NOT_FOUND');
    },
    async setValidity(id: string, input: unknown) {
      requireUuid(id);
      const parsed = documentValiditySchema.safeParse(input);
      if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
      const result = await client.rpc('set_document_validity', {
        p_user_id: userId,
        p_document_id: id,
        p_valid_from: parsed.data.validFrom ?? undefined,
        p_valid_until: parsed.data.validUntil ?? undefined,
      });
      if (result.error) throw new DataAccessError('UNAVAILABLE');
      if (!result.data) throw new DataAccessError('NOT_FOUND');
    },
    async list(): Promise<DocumentMetadata[]> {
      const { data, error } = await client
        .from('source_documents')
        .select(columns)
        .eq('user_id', userId)
        .order('uploaded_at', { ascending: false });
      if (error) throw new DataAccessError('UNAVAILABLE');
      return (data ?? []) as DocumentMetadata[];
    },
    async upload(file: File): Promise<DocumentMetadata> {
      const format = validateDocument(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length !== file.size) throw new DocumentError('INVALID_FILE');
      validateDocumentBytes(bytes, format);
      const reservation = await client.rpc('reserve_source_document', {
        p_user_id: userId,
        p_name: file.name,
        p_mime_type: documentMimeTypes[format],
        p_byte_size: bytes.length,
        p_sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      if (reservation.error) {
        if (
          reservation.error.message === 'DOCUMENT_LIMIT' ||
          reservation.error.message === 'DOCUMENT_BUSY'
        )
          throw new DocumentError(reservation.error.message);
        throw new DataAccessError('UNAVAILABLE');
      }
      const row = requireResource(reservation.data);
      let uploaded = false;
      try {
        const extracted = await extract(bytes, format);
        const index = buildDocumentIndex(extracted);
        const text = extracted.text;
        const result = await storage.upload(objectKey(row.id), bytes, {
          contentType: documentMimeTypes[format],
          upsert: false,
        });
        if (result.error) throw new DocumentError('UPLOAD_FAILED');
        uploaded = true;
        const completed = await client.rpc('complete_indexed_source_document', {
          p_user_id: userId,
          p_document_id: row.id,
          p_text: text,
          p_index: index as unknown as Json,
        });
        if (completed.error || !completed.data)
          throw new DocumentError('PROCESSING_FAILED');
        const { data, error } = await client
          .from('source_documents')
          .select(columns)
          .eq('id', row.id)
          .eq('user_id', userId)
          .single();
        if (error) throw new DataAccessError('UNAVAILABLE');
        return data as DocumentMetadata;
      } catch (error) {
        const code =
          error instanceof DocumentError ? error.code : 'PROCESSING_FAILED';
        // Lock the row before compensating: a timed-out RPC may still be committing.
        // If it reached READY, this conditional update waits for it and changes nothing.
        const failed = await client
          .from('source_documents')
          .update({ status: 'FAILED', error_code: code, text_length: 0 })
          .eq('id', row.id)
          .eq('user_id', userId)
          .eq('status', 'PROCESSING')
          .select(columns)
          .maybeSingle();
        if (failed.error) throw new DocumentError('PROCESSING_FAILED');
        if (!failed.data) {
          const current = await client
            .from('source_documents')
            .select(columns)
            .eq('id', row.id)
            .eq('user_id', userId)
            .maybeSingle();
          if (current.data?.status === 'READY')
            return current.data as DocumentMetadata;
          if (current.error) throw new DocumentError('PROCESSING_FAILED');
        }
        // Keep a failed record so removal can be retried even after an uncertain Storage response.
        if (
          uploaded ||
          code === 'UPLOAD_FAILED' ||
          code === 'PROCESSING_FAILED'
        ) {
          await storage.remove([objectKey(row.id)]).catch(() => undefined);
        }
        throw new DocumentError(code);
      }
    },
    async download(id: string) {
      const document = await find(id);
      if (document.status !== 'READY') throw new DataAccessError('NOT_FOUND');
      const { data, error } = await storage.download(objectKey(id));
      if (error || !data) throw new DataAccessError('UNAVAILABLE');
      return { document, blob: data };
    },
    async reindex(id: string) {
      const document = await find(id);
      if (document.status !== 'READY') throw new DocumentError('DOCUMENT_BUSY');
      const text = await client
        .from('source_document_texts')
        .select('text_content')
        .eq('document_id', id)
        .eq('user_id', userId)
        .single();
      if (text.error || !text.data) throw new DataAccessError('UNAVAILABLE');
      const original = await storage.download(objectKey(id));
      if (original.error || !original.data)
        throw new DataAccessError('UNAVAILABLE');
      if (original.data.size !== document.byte_size)
        throw new DocumentError('INVALID_FORMAT');
      const format = validateDocument({
        name: document.name,
        type: document.mime_type,
        size: original.data.size,
      });
      const bytes = new Uint8Array(await original.data.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== document.sha256)
        throw new DocumentError('INVALID_FORMAT');
      validateDocumentBytes(bytes, format);
      const index = buildDocumentIndex(await extract(bytes, format));
      const result = await client.rpc('replace_knowledge_index', {
        p_user_id: userId,
        p_document_id: id,
        p_version: document.version,
        p_sha256: document.sha256,
        p_text_hash: createHash('md5')
          .update(text.data.text_content)
          .digest('hex'),
        p_index: index as unknown as Json,
      });
      if (result.error) throw new DataAccessError('UNAVAILABLE');
      if (!result.data) throw new DocumentError('DOCUMENT_BUSY');
      return {
        documentId: id,
        version: document.version,
        chunkCount: index.chunks.length,
      };
    },
    async chunks(id: string, offset = 0, limit = 20) {
      const document = await find(id);
      if (document.status !== 'READY' || !document.indexed_at)
        throw new DataAccessError('NOT_FOUND');
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > 1999 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        throw new DataAccessError('INVALID_INPUT');
      const result = await client
        .from('knowledge_chunks')
        .select(
          'id,document_id,version,position,section,content,start_offset,end_offset,page_start,page_end',
        )
        .eq('document_id', id)
        .eq('user_id', userId)
        .eq('version', document.version)
        .order('position')
        .range(offset, offset + limit - 1);
      if (result.error) throw new DataAccessError('UNAVAILABLE');
      return {
        document: { id, name: document.name, version: document.version },
        chunks: result.data ?? [],
        total: document.chunk_count,
      };
    },
    async search(query: string, limit = 10, documentId?: string) {
      if (
        typeof query !== 'string' ||
        !query.trim() ||
        query.length > 300 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 20
      )
        throw new DataAccessError('INVALID_INPUT');
      if (documentId) {
        requireUuid(documentId);
        await find(documentId);
      }
      const result = await client.rpc('search_knowledge_chunks', {
        p_user_id: userId,
        p_query: query.trim(),
        p_limit: limit,
        p_document_id: documentId,
      });
      if (result.error) throw new DataAccessError('UNAVAILABLE');
      return result.data ?? [];
    },
    async remove(id: string) {
      await find(id);
      const result = await client.rpc('begin_source_document_deletion', {
        p_user_id: userId,
        p_document_id: id,
      });
      if (result.error) throw new DataAccessError('UNAVAILABLE');
      if (!result.data) throw new DocumentError('DOCUMENT_BUSY');
      // Invalidate derived text first. On failure DELETING remains visible and can be retried.
      const removed = await storage.remove([objectKey(id)]);
      if (removed.error) throw new DataAccessError('UNAVAILABLE');
      const { error } = await client
        .from('source_documents')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .eq('status', 'DELETING');
      if (error) throw new DataAccessError('UNAVAILABLE');
    },
  });
}
