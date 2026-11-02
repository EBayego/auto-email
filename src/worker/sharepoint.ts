import { createHash } from 'node:crypto';
import type { DataClient } from '@/db/models';
import { createSharePointStore } from '@/db/sharepoint';
import {
  readSharePointConfig,
  type SharePointConfig,
} from '@/config/sharepoint';
import { createMicrosoftAuth } from '@/modules/sharepoint/auth';
import {
  createSharePointGraph,
  sharePointWebUrl,
} from '@/providers/sharepoint';
import { createSharePointOcr } from '@/providers/sharepoint-ocr';
import { buildDocumentIndex } from '@/modules/knowledge/document-index';
import { extractImportedDocument } from '@/modules/sharepoint/extraction';
import {
  SharePointError,
  sharePointLimits,
  type SharePointConnector,
  type SharePointStore,
  type SyncedItem,
} from '@/modules/sharepoint/contracts';
import type { SharePointGraph } from '@/providers/sharepoint';

export async function syncSharePointConnector(
  c: SharePointConnector,
  store: SharePointStore,
  g: SharePointGraph,
  config: SharePointConfig,
  signal?: AbortSignal,
) {
  const args = { id: c.id, lease: c.lease_id };
  const leaseController = new AbortController();
  const workSignal = AbortSignal.any([
    leaseController.signal,
    ...(signal ? [signal] : []),
  ]);
  let leaseLost = false;
  const renew = setInterval(() => {
    void store.command('heartbeat', args).catch(() => {
      leaseLost = true;
      leaseController.abort();
      g.close?.();
    });
  }, 30000);
  renew.unref();
  let error: string | null = null;
  let retryAfter = 0;
  try {
    if (c.phase === 'DELTA') {
      let path =
        c.next_link ??
        c.delta_link ??
        `/drives/${encodeURIComponent(c.drive_id)}/root/delta`;
      for (let count = 0; count < 3 && !signal?.aborted; count++) {
        const page = await g.page(path);
        await store.command('page', {
          ...args,
          items: page.items,
          next: page.next,
          delta: page.delta,
        });
        if (!page.next) {
          c.phase = 'INDEX';
          break;
        }
        path = page.next;
      }
    }
    if (c.phase === 'INDEX' && !signal?.aborted) {
      const pending = await store.command<SyncedItem[]>('pending', args);
      for (const item of pending) {
        if (leaseLost) throw new SharePointError('CONNECTOR_LEASE_LOST');
        if (signal?.aborted) break;
        try {
          if (item.size > sharePointLimits.maxFileBytes)
            throw new SharePointError('FILE_TOO_LARGE');
          const current = await g.assertInRoot(
            c.drive_id,
            c.root_item_id,
            item.item_id,
            c.recursive,
          );
          if (current.eTag !== item.etag)
            throw new SharePointError('REMOTE_CHANGED_DURING_SYNC');
          const bytes = await g.download(c.drive_id, item.item_id);
          const name =
            Array.from(
              (current.name ?? item.name).replace(/[\p{Cc}\p{Cf}/\\]/gu, '_'),
            )
              .slice(0, 180)
              .join('') || 'Documento';
          const hash = createHash('sha256').update(bytes).digest('hex');
          const cached = item.document_id
            ? await store.command<{ hash: string; ready: boolean } | null>(
                'cached_hash',
                { ...args, itemId: item.item_id },
              )
            : null;
          if (cached?.ready && cached.hash === hash) {
            const checked = await g.item(c.drive_id, item.item_id);
            if (checked.eTag !== item.etag)
              throw new SharePointError('REMOTE_CHANGED_DURING_SYNC');
            await store.command('document_unchanged', {
              ...args,
              itemId: item.item_id,
              hash,
              name,
              url: sharePointWebUrl(current.webUrl ?? item.web_url),
              modifiedAt: current.lastModifiedDateTime ?? item.modified_at,
            });
            continue;
          }
          const extracted = await extractImportedDocument(
            bytes,
            name,
            config.ocr
              ? createSharePointOcr(
                  config.ocr,
                  fetch,
                  workSignal,
                  (pages) =>
                    store
                      .command('ocr_reserve', {
                        pages,
                        limit: config.ocr!.dailyPageBudget,
                      })
                      .then(() => {}),
                  () =>
                    store
                      .command('assert_read', { id: c.connection_id })
                      .then(() => {}),
                )
              : undefined,
          );
          if (leaseLost) throw new SharePointError('CONNECTOR_LEASE_LOST');
          const checked = await g.item(c.drive_id, item.item_id);
          if (checked.eTag !== item.etag)
            throw new SharePointError('REMOTE_CHANGED_DURING_SYNC');
          const index = buildDocumentIndex(extracted);
          await store.command('document_save', {
            ...args,
            itemId: item.item_id,
            name,
            mime:
              current.file?.mimeType ??
              item.mime_type ??
              'application/octet-stream',
            size: bytes.length,
            hash,
            url: sharePointWebUrl(current.webUrl ?? item.web_url),
            modifiedAt: current.lastModifiedDateTime ?? item.modified_at,
            text: extracted.text,
            index,
          });
        } catch (e) {
          const code =
            e instanceof SharePointError
              ? e.code
              : e instanceof Error && 'code' in e
                ? String(e.code)
                : 'PROCESSING_FAILED';
          if (code === 'REMOTE_CHANGED_DURING_SYNC') {
            await store.command('reset', args);
            throw e;
          }
          if (
            [
              'REAUTH_REQUIRED',
              'TOKEN_BUSY',
              'CONNECTOR_LEASE_LOST',
              'GRAPH_UNAVAILABLE',
              'THROTTLED',
              'MICROSOFT_UNAVAILABLE',
              'DOWNLOAD_FAILED',
              'OCR_UNAVAILABLE',
              'OCR_TIMEOUT',
              'OCR_DAILY_BUDGET',
            ].includes(code)
          )
            throw e;
          await store.command('item_error', {
            ...args,
            itemId: item.item_id,
            error: code,
            omitted: [
              'UNSUPPORTED_FORMAT',
              'OCR_NOT_CONFIGURED',
              'EMBEDDED_OCR_NOT_CONFIGURED',
              'OCR_REVIEW_REQUIRED',
              'FILE_TOO_LARGE',
              'TEXT_LIMIT',
              'EMBEDDED_IMAGE_LIMIT',
            ].includes(code),
          });
        }
      }
    }
  } catch (e) {
    error = e instanceof SharePointError ? e.code : 'CONNECTOR_UNAVAILABLE';
    retryAfter =
      error === 'OCR_DAILY_BUDGET'
        ? 3600
        : e instanceof SharePointError
          ? e.retryAfter || 60
          : 60;
    if (error === 'CURSOR_EXPIRED') {
      await store.command('reset', args);
      error = null;
    }
    if (error === 'REAUTH_REQUIRED')
      await store.command('reauth', { id: c.connection_id });
  } finally {
    clearInterval(renew);
    await store
      .command('release', { ...args, error, retryAfter })
      .catch(() => {});
  }
  return { failed: !!error };
}
export async function runSharePointCycle(
  client: DataClient,
  signal?: AbortSignal,
) {
  const config = readSharePointConfig();
  if (!config) return { failed: false };
  let failed = false;
  for (let count = 0; count < 3 && !signal?.aborted; count++) {
    const c = await createSharePointStore(
      client,
      null,
    ).command<SharePointConnector | null>('claim');
    if (!c) break;
    const store = createSharePointStore(client, c.user_id);
    const auth = createMicrosoftAuth(config, store, c.user_id);
    let token: Promise<string> | undefined;
    const graph = createSharePointGraph(
      async () => {
        await store.command('assert_read', { id: c.connection_id });
        return (token ??= auth.token(c.connection_id));
      },
      fetch,
      signal,
    );
    const result = await syncSharePointConnector(
      c,
      store,
      graph,
      config,
      signal,
    );
    failed ||= result.failed;
  }
  return { failed };
}
