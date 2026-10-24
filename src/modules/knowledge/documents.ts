import { z } from 'zod';

const validityDate = z.iso
  .date()
  .refine((s) => s >= '0001-01-01')
  .nullable();
export const documentValiditySchema = z
  .object({ validFrom: validityDate, validUntil: validityDate })
  .strict()
  .refine((v) => !v.validFrom || !v.validUntil || v.validFrom <= v.validUntil);
export type DocumentValidity = z.infer<typeof documentValiditySchema>;

export const documentLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxDocuments: 10,
  maxTextLength: 1_000_000,
  parserTimeoutMs: 15_000,
} as const;

export const documentMimeTypes = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;
export type DocumentFormat = keyof typeof documentMimeTypes;
export type DocumentErrorCode =
  | 'INVALID_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_FORMAT'
  | 'UNSAFE_FILE'
  | 'NO_TEXT'
  | 'TEXT_LIMIT'
  | 'PARSER_TIMEOUT'
  | 'DOCUMENT_LIMIT'
  | 'DOCUMENT_BUSY'
  | 'UPLOAD_FAILED'
  | 'PROCESSING_FAILED';
export class DocumentError extends Error {
  constructor(public readonly code: DocumentErrorCode) {
    super(code);
  }
}
export type DocumentMetadata = {
  id: string;
  name: string;
  mime_type: string;
  byte_size: number;
  version: number;
  status: 'PROCESSING' | 'READY' | 'FAILED' | 'DELETING';
  error_code: string | null;
  text_length: number;
  uploaded_at: string;
  updated_at: string;
  indexed_at: string | null;
  chunk_count: number;
  indexer_version: string | null;
  source_id: string | null;
  content_updated_at: string;
  valid_from: string | null;
  valid_until: string | null;
  audience_kind?: 'GENERAL' | 'RECIPIENT' | 'DOMAIN';
  audience_key?: string;
};

export function validateDocument(
  file: Pick<File, 'name' | 'type' | 'size'>,
): DocumentFormat {
  if (
    !file.name ||
    file.name.length > 180 ||
    /[\p{Cc}\p{Cf}/\\]/u.test(file.name) ||
    file.name.trim() !== file.name
  )
    throw new DocumentError('INVALID_FILE');
  if (!Number.isSafeInteger(file.size) || file.size < 1)
    throw new DocumentError('INVALID_FILE');
  if (file.size > documentLimits.maxBytes)
    throw new DocumentError('FILE_TOO_LARGE');
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (!extension || !Object.hasOwn(documentMimeTypes, extension))
    throw new DocumentError('INVALID_FORMAT');
  const format = extension as DocumentFormat;
  if (file.type !== documentMimeTypes[format])
    throw new DocumentError('INVALID_FORMAT');
  return format;
}

export function validateDocumentBytes(
  bytes: Uint8Array,
  format: DocumentFormat,
) {
  if (!bytes.length || bytes.length > documentLimits.maxBytes)
    throw new DocumentError('INVALID_FILE');
  const start = Buffer.from(bytes.subarray(0, 8));
  if (
    format === 'pdf' &&
    !/^%PDF-1\.[0-7]|^%PDF-2\.0/.test(start.toString('ascii'))
  )
    throw new DocumentError('INVALID_FORMAT');
  if (
    format === 'docx' &&
    !start.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))
  )
    throw new DocumentError('INVALID_FORMAT');
  if (format === 'txt') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new DocumentError('INVALID_FORMAT');
    }
    if (
      [...text].some((c) => {
        const code = c.charCodeAt(0);
        return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
      }) ||
      start.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])) ||
      /^(?:%PDF-|MZ|\s*<(!doctype|html|script))/i.test(text)
    )
      throw new DocumentError('INVALID_FORMAT');
  }
}
