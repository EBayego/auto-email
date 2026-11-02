import type { SharePointConfig } from '@/config/sharepoint';
import { SharePointError } from '@/modules/sharepoint/contracts';
import type { OcrReader } from '@/modules/sharepoint/extraction';
import { boundedBody } from './sharepoint';
import { z } from 'zod';

export function createSharePointOcr(
  config: NonNullable<SharePointConfig['ocr']>,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  reserve?: (pages: number) => Promise<void>,
  assertAllowed?: () => Promise<void>,
): OcrReader {
  return async (bytes) => {
    await reserve?.(
      Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-' ? 101 : 1,
    );
    const deadline = AbortSignal.timeout(180000);
    const requestSignal = signal
      ? AbortSignal.any([deadline, signal])
      : deadline;
    await assertAllowed?.();
    const start = await fetcher(
      `${config.endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30&pages=1-101`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': config.key.reveal(),
          'Content-Type': 'application/octet-stream',
        },
        body: Buffer.from(bytes),
        redirect: 'error',
        signal: requestSignal,
      },
    );
    const operation = new URL(
      start.headers.get('operation-location') ?? config.endpoint,
    );
    if (
      start.status !== 202 ||
      operation.origin !== config.endpoint ||
      !operation.pathname.startsWith(
        '/documentintelligence/documentModels/prebuilt-read/analyzeResults/',
      )
    )
      throw new SharePointError('OCR_UNAVAILABLE');
    for (let attempt = 0; attempt < 80; attempt++) {
      if (requestSignal.aborted) throw new SharePointError('OCR_TIMEOUT');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          requestSignal.removeEventListener('abort', abort);
          resolve();
        }, 1500);
        const abort = () => {
          clearTimeout(timer);
          reject(new SharePointError('OCR_TIMEOUT'));
        };
        requestSignal.addEventListener('abort', abort, { once: true });
      });
      await assertAllowed?.();
      const response = await fetcher(operation, {
        headers: { 'Ocp-Apim-Subscription-Key': config.key.reveal() },
        redirect: 'error',
        cache: 'no-store',
        signal: requestSignal,
      });
      if (!response.ok) throw new SharePointError('OCR_UNAVAILABLE');
      const result = z
        .object({
          status: z.string(),
          analyzeResult: z
            .object({
              content: z.string(),
              pages: z.array(
                z.object({
                  pageNumber: z.number(),
                  lines: z.array(z.object({ content: z.string() })).optional(),
                  words: z
                    .array(
                      z.object({ content: z.string(), confidence: z.number() }),
                    )
                    .optional(),
                }),
              ),
            })
            .optional(),
        })
        .parse(
          JSON.parse(
            Buffer.from(await boundedBody(response, 8 * 1024 * 1024)).toString(
              'utf8',
            ),
          ),
        );
      if (result.status === 'failed') throw new SharePointError('OCR_FAILED');
      if (result.status !== 'succeeded') continue;
      if (!result.analyzeResult?.content.trim())
        throw new SharePointError('NO_TEXT');
      if (
        result.analyzeResult.pages.length > 100 ||
        result.analyzeResult.content.length > 1000000
      )
        throw new SharePointError('TEXT_LIMIT');
      const words = result.analyzeResult.pages.flatMap((p) => p.words ?? []);
      if (
        words.some((w) => /\d/.test(w.content) && w.confidence < 0.9) ||
        (words.length &&
          words.reduce((n, w) => n + w.confidence, 0) / words.length < 0.9)
      )
        throw new SharePointError('OCR_REVIEW_REQUIRED');
      return {
        text: result.analyzeResult.content,
        pages: result.analyzeResult.pages.map((p) => ({
          page: p.pageNumber,
          text: p.lines?.map((l) => l.content).join('\n') ?? '',
        })),
      };
    }
    throw new SharePointError('OCR_TIMEOUT');
  };
}
