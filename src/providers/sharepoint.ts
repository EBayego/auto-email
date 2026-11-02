import { z } from 'zod';
import {
  SharePointError,
  remoteId,
  sharePointLimits,
  type RemoteItem,
} from '@/modules/sharepoint/contracts';

const itemSchema = z.object({
  id: remoteId,
  name: z.string().max(400).optional(),
  eTag: z.string().max(1024).optional(),
  size: z.number().nonnegative().optional(),
  webUrl: z
    .string()
    .max(4096)
    .refine((value) => {
      try {
        sharePointWebUrl(value);
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
  lastModifiedDateTime: z.string().optional(),
  parentReference: z
    .object({ id: remoteId.optional(), driveId: remoteId.optional() })
    .optional(),
  folder: z.object({ childCount: z.number().optional() }).optional(),
  file: z.object({ mimeType: z.string().optional() }).optional(),
  deleted: z.object({}).optional(),
  remoteItem: z.object({}).optional(),
});
export function sharePointWebUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.sharepoint.com') ||
    url.port ||
    url.username ||
    url.password
  )
    throw new SharePointError('INVALID_SHAREPOINT_URL');
  return url.href;
}
export function graphUrl(value: string) {
  const url = new URL(
    value.startsWith('/') ? `https://graph.microsoft.com/v1.0${value}` : value,
  );
  if (
    url.origin !== 'https://graph.microsoft.com' ||
    !url.pathname.startsWith('/v1.0/') ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new SharePointError('INVALID_GRAPH_URL');
  return url.href;
}
export function createSharePointGraph(
  token: () => Promise<string>,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const request = async (path: string, redirect: RequestRedirect = 'error') => {
    const response = await fetcher(graphUrl(path), {
      headers: { Authorization: `Bearer ${await token()}` },
      redirect,
      cache: 'no-store',
      signal: AbortSignal.any([
        controller.signal,
        ...(signal ? [signal] : []),
        AbortSignal.timeout(30000),
      ]),
    });
    if (!response.ok && response.status !== 302) {
      const seconds = response.headers.get('retry-after');
      const delay = seconds && /^\d+$/.test(seconds) ? Number(seconds) : 30;
      const code =
        response.status === 410
          ? 'CURSOR_EXPIRED'
          : response.status === 401
            ? 'REAUTH_REQUIRED'
            : response.status === 403
              ? 'ACCESS_DENIED'
              : response.status === 404
                ? 'REMOTE_NOT_FOUND'
                : response.status === 429
                  ? 'THROTTLED'
                  : 'GRAPH_UNAVAILABLE';
      throw new SharePointError(code, delay);
    }
    return response;
  };
  const json = async (path: string): Promise<unknown> => {
    const response = await request(path);
    const body = await boundedBody(response, 8 * 1024 * 1024);
    try {
      return JSON.parse(Buffer.from(body).toString('utf8'));
    } catch {
      throw new SharePointError('INVALID_GRAPH_RESPONSE');
    }
  };
  const enc = (id: string) => encodeURIComponent(remoteId.parse(id));
  const item = async (drive: string, id: string) =>
    itemSchema.parse(
      await json(
        id === 'root'
          ? `/drives/${enc(drive)}/root`
          : `/drives/${enc(drive)}/items/${enc(id)}`,
      ),
    );
  return {
    close() {
      controller.abort();
    },
    json,
    item,
    async page(path: string) {
      const result = z
        .object({
          value: z.array(itemSchema).max(5000),
          '@odata.nextLink': z.string().optional(),
          '@odata.deltaLink': z.string().optional(),
        })
        .parse(await json(path));
      return {
        items: result.value as RemoteItem[],
        next: result['@odata.nextLink']
          ? graphUrl(result['@odata.nextLink'])
          : null,
        delta: result['@odata.deltaLink']
          ? graphUrl(result['@odata.deltaLink'])
          : null,
      };
    },
    async assertInRoot(
      drive: string,
      root: string,
      id: string,
      recursive: boolean,
    ) {
      const current = await item(drive, id);
      if (current.deleted || current.remoteItem || !current.file)
        throw new SharePointError('OUTSIDE_SCOPE');
      let parent = current.parentReference?.id;
      const seen = new Set([id]);
      for (let depth = 0; parent && depth < 100; depth++) {
        if (parent === root) {
          const folder = await item(drive, root);
          if (!folder.folder || folder.deleted || folder.remoteItem) break;
          return current;
        }
        if (!recursive || seen.has(parent)) break;
        seen.add(parent);
        const ancestor = await item(drive, parent);
        if (ancestor.deleted || ancestor.remoteItem) break;
        parent = ancestor.parentReference?.id;
      }
      throw new SharePointError('OUTSIDE_SCOPE');
    },
    async download(drive: string, id: string) {
      const response = await request(
        `/drives/${enc(drive)}/items/${enc(id)}/content`,
        'manual',
      );
      if (response.status !== 302)
        return boundedBody(response, sharePointLimits.maxFileBytes);
      const location = new URL(response.headers.get('location') ?? '');
      if (
        location.protocol !== 'https:' ||
        location.port ||
        location.username ||
        location.password ||
        !['.sharepoint.com', '.files.1drv.com', '.files.1drv.ms'].some((s) =>
          location.hostname.endsWith(s),
        )
      )
        throw new SharePointError('INVALID_DOWNLOAD_URL');
      // Download URLs are bearer capabilities. Never attach Graph credentials or follow another redirect.
      await token();
      const file = await fetcher(location, {
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.any([
          controller.signal,
          ...(signal ? [signal] : []),
          AbortSignal.timeout(60000),
        ]),
      });
      if (!file.ok) throw new SharePointError('DOWNLOAD_FAILED');
      return boundedBody(file, sharePointLimits.maxFileBytes);
    },
  };
}
export type SharePointGraph = ReturnType<typeof createSharePointGraph>;
export async function boundedBody(response: Response, maximum: number) {
  if (
    Number(response.headers.get('content-length')) > maximum ||
    !response.body
  )
    throw new SharePointError('FILE_TOO_LARGE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new SharePointError('FILE_TOO_LARGE');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks));
}
