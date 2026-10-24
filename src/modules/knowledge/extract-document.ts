import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { ExtractedDocument } from './document-index';
import {
  DocumentError,
  documentLimits,
  type DocumentFormat,
} from './documents';

export async function extractDocument(
  bytes: Uint8Array,
  format: DocumentFormat,
): Promise<string> {
  return (await extractDocumentContent(bytes, format)).text;
}

export async function extractDocumentContent(
  bytes: Uint8Array,
  format: DocumentFormat,
): Promise<ExtractedDocument> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(process.cwd(), 'scripts/knowledge-parser.mjs'),
      {
        workerData: { bytes, format },
        resourceLimits: {
          maxOldGenerationSizeMb: 192,
          maxYoungGenerationSizeMb: 32,
        },
        stdout: true,
        stderr: true,
        // A parser receives no application credentials and does not fetch remote resources.
        env: {},
        execArgv: [],
      },
    );
    worker.stdout.resume();
    worker.stderr.resume();
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new DocumentError('PARSER_TIMEOUT'));
    }, documentLimits.parserTimeoutMs);
    worker.once(
      'message',
      (message: Partial<ExtractedDocument> & { error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (typeof message.text === 'string')
          resolve({ text: message.text, pages: message.pages });
        else
          reject(
            new DocumentError(
              message.error === 'NO_TEXT' ||
                message.error === 'TEXT_LIMIT' ||
                message.error === 'UNSAFE_FILE'
                ? message.error
                : 'INVALID_FORMAT',
            ),
          );
      },
    );
    worker.once('error', () => {
      clearTimeout(timer);
      reject(new DocumentError('INVALID_FORMAT'));
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new DocumentError('INVALID_FORMAT'));
    });
  });
}
