import { describe, it, expect, vi } from 'vitest';
import { createSharePointOcr } from './sharepoint-ocr';
import { SecretValue } from '@/config/env';

const config = {
  endpoint: 'https://fixture.cognitiveservices.azure.com',
  key: new SecretValue('fixture'),
  dailyPageBudget: 500,
};
const location = `${config.endpoint}/documentintelligence/documentModels/prebuilt-read/analyzeResults/job?api-version=2024-11-30`;
describe('OCR de SharePoint', () => {
  it('no consulta el resultado si se retira la autorización durante el trabajo', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 202,
          headers: { 'operation-location': location },
        }),
      );
      const allowed = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('PRIVACY_CONSENT_REQUIRED'));
      const rejected = expect(
        createSharePointOcr(
          config,
          fetcher,
          undefined,
          undefined,
          allowed,
        )(Buffer.from('image')),
      ).rejects.toThrow('PRIVACY_CONSENT_REQUIRED');
      await vi.advanceTimersByTimeAsync(1600);
      await rejected;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('reserva presupuesto antes de enviar el contenido', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const reserve = vi.fn().mockRejectedValue(new Error('OCR_DAILY_BUDGET'));
    await expect(
      createSharePointOcr(
        config,
        fetcher,
        undefined,
        reserve,
      )(Buffer.from('%PDF-1.7')),
    ).rejects.toThrow('OCR_DAILY_BUDGET');
    expect(reserve).toHaveBeenCalledWith(101);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rechaza redirecciones de la operación fuera del recurso configurado', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { 'operation-location': 'https://evil.invalid/operation' },
      }),
    );
    await expect(
      createSharePointOcr(config, fetcher)(Buffer.from('image')),
    ).rejects.toThrow('OCR_UNAVAILABLE');
  });
  it('extrae páginas y bloquea cifras de baja confianza', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 202,
            headers: { 'operation-location': location },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: 'succeeded',
              analyzeResult: {
                content: 'Precio: 125 EUR.',
                pages: [
                  {
                    pageNumber: 1,
                    lines: [{ content: 'Precio: 125 EUR.' }],
                    words: [{ content: '125', confidence: 0.99 }],
                  },
                ],
              },
            }),
          ),
        );
      const promise = createSharePointOcr(
        config,
        fetcher,
      )(Buffer.from('image'));
      await vi.advanceTimersByTimeAsync(1600);
      await expect(promise).resolves.toMatchObject({
        text: 'Precio: 125 EUR.',
        pages: [{ page: 1 }],
      });
      fetcher
        .mockResolvedValueOnce(
          new Response(null, {
            status: 202,
            headers: { 'operation-location': location },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: 'succeeded',
              analyzeResult: {
                content: 'Precio: 125 EUR.',
                pages: [
                  {
                    pageNumber: 1,
                    words: [{ content: '125', confidence: 0.3 }],
                  },
                ],
              },
            }),
          ),
        );
      const rejected = expect(
        createSharePointOcr(config, fetcher)(Buffer.from('image')),
      ).rejects.toThrow('OCR_REVIEW_REQUIRED');
      await vi.advanceTimersByTimeAsync(1600);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
