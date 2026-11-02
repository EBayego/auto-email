import { z } from 'zod';
import type { SharePointConfig } from '@/config/sharepoint';
import {
  createSharePointGraph,
  sharePointWebUrl,
  type SharePointGraph,
} from '@/providers/sharepoint';
import { createMicrosoftAuth } from './auth';
import {
  connectorOperationSchema,
  remoteId,
  SharePointError,
  type ConnectorSnapshot,
  type SharePointConnector,
  type SharePointStore,
  type SyncedItem,
} from './contracts';

const collection = z.object({
  value: z
    .array(
      z.object({
        id: remoteId,
        name: z.string().optional(),
        webUrl: z.string().optional(),
      }),
    )
    .max(5000),
});
export function createSharePointService(
  config: SharePointConfig,
  store: SharePointStore,
  userId: string,
  fetcher: typeof fetch = fetch,
) {
  const auth = createMicrosoftAuth(config, store, userId);
  const graphs = new Map<string, SharePointGraph>();
  const graph = (connection: string) => {
    let existing = graphs.get(connection);
    if (!existing) {
      let token: Promise<string> | undefined;
      existing = createSharePointGraph(async () => {
        await store.command('assert_read', { id: connection });
        return (token ??= auth.token(connection));
      }, fetcher);
      graphs.set(connection, existing);
    }
    return existing;
  };
  async function drives(g: SharePointGraph, site: string) {
    const found: z.infer<typeof collection>['value'] = [];
    let path: string | null =
      `/sites/${encodeURIComponent(remoteId.parse(site))}/drives`;
    while (path) {
      const page = await g.json(path);
      const parsed = collection.parse(page);
      found.push(...parsed.value);
      if (found.length > 5000) throw new SharePointError('CONNECTOR_LIMIT');
      path =
        z.object({ '@odata.nextLink': z.string().optional() }).parse(page)[
          '@odata.nextLink'
        ] ?? null;
    }
    return found;
  }
  return {
    auth,
    graph,
    async snapshot(): Promise<ConnectorSnapshot> {
      return {
        ...(await store.command<
          Omit<ConnectorSnapshot, 'enabled' | 'configured' | 'ocrConfigured'>
        >('list')),
        enabled: true,
        configured: true,
        ocrConfigured: !!config.ocr,
      };
    },
    async browse(input: {
      connectionId: string;
      siteUrl?: string;
      siteId?: string;
      driveId?: string;
      itemId?: string;
      next?: string;
    }) {
      z.uuid().parse(input.connectionId);
      const g = graph(input.connectionId);
      if (input.siteUrl) {
        const url = new URL(sharePointWebUrl(input.siteUrl));
        if (
          url.search ||
          url.hash ||
          (!/^\/(?:sites|teams)\/[^/]+\/?$/.test(url.pathname) &&
            url.pathname !== '/')
        )
          throw new SharePointError('SITE_URL_REQUIRED');
        const site = z
          .object({
            id: remoteId,
            webUrl: z.string(),
            displayName: z.string().optional(),
          })
          .parse(await g.json(`/sites/${url.hostname}:${url.pathname}`));
        return { site, drives: await drives(g, site.id) };
      }
      if (!input.siteId) throw new SharePointError('SITE_URL_REQUIRED');
      const available = await drives(g, input.siteId);
      if (!input.driveId)
        return { site: { id: input.siteId }, drives: available };
      if (!available.some((d) => d.id === input.driveId))
        throw new SharePointError('OUTSIDE_SCOPE');
      const id = input.itemId ?? 'root';
      const folder = await g.item(input.driveId, id);
      if (!folder.folder || folder.remoteItem)
        throw new SharePointError('FOLDER_REQUIRED');
      const base = `/drives/${encodeURIComponent(input.driveId)}/items/${encodeURIComponent(folder.id)}/children`;
      if (input.next) {
        const url = new URL(input.next);
        if (
          url.origin !== 'https://graph.microsoft.com' ||
          url.pathname !== `/v1.0${base}`
        )
          throw new SharePointError('INVALID_GRAPH_URL');
      }
      const page = await g.page(input.next ?? base);
      return {
        site: { id: input.siteId },
        folder,
        folders: page.items.filter(
          (i) => i.folder && !i.remoteItem && !i.deleted,
        ),
        next: page.next,
      };
    },
    async operate(raw: unknown) {
      const input = connectorOperationSchema.parse(raw);
      if (input.action !== 'create')
        return store.command(input.action, { ...input });
      const g = graph(input.connectionId);
      const available = await drives(g, input.siteId);
      if (!available.some((d) => d.id === input.driveId))
        throw new SharePointError('OUTSIDE_SCOPE');
      const root = await g.item(input.driveId, input.rootId);
      if (!root.folder || root.remoteItem || root.deleted || !root.webUrl)
        throw new SharePointError('FOLDER_REQUIRED');
      const ancestors: string[] = [];
      let parent = root.parentReference?.id;
      while (parent && ancestors.length < 100) {
        if (ancestors.includes(parent))
          throw new SharePointError('OUTSIDE_SCOPE');
        ancestors.push(parent);
        parent = (await g.item(input.driveId, parent)).parentReference?.id;
      }
      if (parent) throw new SharePointError('OUTSIDE_SCOPE');
      return store.command('create', {
        ...input,
        webUrl: sharePointWebUrl(root.webUrl),
        ancestors,
      });
    },
    items(id: string, offset = 0) {
      z.uuid().parse(id);
      if (!Number.isInteger(offset) || offset < 0 || offset > 5000)
        throw new SharePointError('INVALID_INPUT');
      return store.command<SyncedItem[]>('items', { id, offset });
    },
  };
}

export type ExternalReference = {
  document_id: string;
  version: number;
  connector_id?: string;
  origin_url?: string;
};
type Meta = SyncedItem & {
  connector: SharePointConnector;
  connection_version: number;
  connection_status: string;
  document_version: number;
};
export async function verifySharePointEvidence(
  store: SharePointStore,
  graphFor: (id: string) => SharePointGraph,
  refs: ExternalReference[],
  options: { forDraft?: boolean } = {},
) {
  const external = [
    ...new Map(
      refs.filter((r) => r.connector_id).map((r) => [r.document_id, r]),
    ).values(),
  ];
  if (!external.length) return new Map<string, Meta>();
  const metadata = await store.command<Meta[]>('document_meta', {
    ids: external.map((r) => r.document_id),
  });
  if (metadata.length !== external.length)
    throw new SharePointError('EVIDENCE_UNAVAILABLE');
  const byId = new Map(metadata.map((m) => [m.document_id!, m]));
  for (const ref of external) {
    const m = byId.get(ref.document_id);
    const c = m?.connector;
    if (
      !m ||
      !c ||
      c.id !== ref.connector_id ||
      c.review_only ||
      m.connection_status !== 'CONNECTED' ||
      m.status !== 'READY' ||
      !m.in_scope ||
      m.document_version !== ref.version
    )
      throw new SharePointError('EVIDENCE_UNAVAILABLE');
    const current = await graphFor(c.connection_id).assertInRoot(
      c.drive_id,
      c.root_item_id,
      m.item_id,
      c.recursive,
    );
    if (current.eTag !== m.etag) throw new SharePointError('EVIDENCE_CHANGED');
    sharePointWebUrl(current.webUrl ?? '');
  }
  // Fence local disconnects/policy changes which happened while checking Microsoft.
  const after = await store.command<Meta[]>('document_meta', {
    ids: external.map((r) => r.document_id),
  });
  if (
    after.length !== metadata.length ||
    after.some((m) => {
      const before = byId.get(m.document_id!);
      return (
        !before ||
        m.connector.version !== before.connector.version ||
        m.connection_version !== before.connection_version ||
        m.connection_status !== 'CONNECTED' ||
        m.document_version !== before.document_version ||
        m.status !== 'READY'
      );
    })
  )
    throw new SharePointError(
      options.forDraft ? 'PREWRITE_EVIDENCE_CHANGED' : 'EVIDENCE_CHANGED',
    );
  return byId;
}
