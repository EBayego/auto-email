import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { extractDocumentContent } from '@/modules/knowledge/extract-document';
import { DocumentError } from '@/modules/knowledge/documents';
import type { ExtractedDocument } from '@/modules/knowledge/document-index';
import { SharePointError, sharePointLimits } from './contracts';

export type ImportedFormat =
  | 'pdf'
  | 'docx'
  | 'txt'
  | 'xlsx'
  | 'csv'
  | 'pptx'
  | 'md'
  | 'html'
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'tif'
  | 'tiff'
  | 'bmp';
export type OcrReader = (bytes: Uint8Array) => Promise<ExtractedDocument>;
export function importedFormat(name: string): ImportedFormat {
  const ext = name.split('.').at(-1)?.toLowerCase();
  if (
    !ext ||
    ![
      'pdf',
      'docx',
      'txt',
      'xlsx',
      'csv',
      'pptx',
      'md',
      'html',
      'png',
      'jpg',
      'jpeg',
      'tif',
      'tiff',
      'bmp',
    ].includes(ext)
  )
    throw new SharePointError('UNSUPPORTED_FORMAT');
  return ext as ImportedFormat;
}
async function office(
  bytes: Uint8Array,
  format: ImportedFormat,
): Promise<{ text: string; images: { name: string; bytes: Uint8Array }[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(process.cwd(), 'scripts/sharepoint-parser.mjs'),
      {
        workerData: { bytes, format },
        env: {},
        execArgv: [],
        stdout: true,
        stderr: true,
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 32,
        },
      },
    );
    worker.stdout.resume();
    worker.stderr.resume();
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new SharePointError('PARSER_TIMEOUT'));
    }, 30000);
    worker.once('message', (result) => {
      clearTimeout(timer);
      void worker.terminate();
      if (result.error) reject(new SharePointError(result.error));
      else resolve(result);
    });
    worker.once('error', () => {
      clearTimeout(timer);
      reject(new SharePointError('INVALID_FORMAT'));
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new SharePointError('INVALID_FORMAT'));
    });
  });
}
export async function extractImportedDocument(
  bytes: Uint8Array,
  name: string,
  ocr?: OcrReader,
): Promise<ExtractedDocument> {
  if (bytes.length > sharePointLimits.maxFileBytes)
    throw new SharePointError('FILE_TOO_LARGE');
  const format = importedFormat(name);
  let result: ExtractedDocument;
  if (['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'].includes(format)) {
    if (!ocr) throw new SharePointError('OCR_NOT_CONFIGURED');
    return ocr(bytes);
  }
  if (format === 'pdf' || format === 'txt' || format === 'docx') {
    try {
      result = await extractDocumentContent(bytes, format);
    } catch (error) {
      if (
        format === 'pdf' &&
        error instanceof DocumentError &&
        error.code === 'NO_TEXT'
      ) {
        if (!ocr) throw new SharePointError('OCR_NOT_CONFIGURED');
        return ocr(bytes);
      }
      throw error;
    }
    if (format === 'pdf') {
      if (ocr) return ocr(bytes);
      if (result.pages?.some((page) => !page.text.trim()))
        throw new SharePointError('OCR_NOT_CONFIGURED');
      return result;
    }
    if (format === 'txt') return result;
  } else result = { text: '' };
  const parsed = await office(bytes, format);
  let combined = result.text || parsed.text;
  if (parsed.images.length) {
    if (!ocr) throw new SharePointError('EMBEDDED_OCR_NOT_CONFIGURED');
    for (const image of parsed.images) {
      try {
        const read = await ocr(image.bytes);
        combined += `\n\n# Imagen incrustada: ${image.name}\n${read.text}`;
      } catch (error) {
        if (!(error instanceof SharePointError && error.code === 'NO_TEXT'))
          throw error;
      }
    }
  }
  if (!combined.trim()) throw new SharePointError('NO_TEXT');
  if (Array.from(combined).length > sharePointLimits.maxTextCharacters)
    throw new SharePointError('TEXT_LIMIT');
  return { text: combined };
}
