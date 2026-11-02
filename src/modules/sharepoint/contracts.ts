import { z } from 'zod';
import { documentAudienceSchema } from '@/modules/knowledge/audience';

export class SharePointError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryAfter = 0,
  ) {
    super(code);
    this.name = 'SharePointError';
  }
}
export const remoteId = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[\w!,.-]+$/);
export const connectorOperationSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    connectionId: z.uuid(),
    title: z.string().trim().min(1).max(100),
    siteId: remoteId,
    driveId: remoteId,
    rootId: remoteId,
    recursive: z.boolean(),
    intervalMinutes: z.int().min(5).max(1440),
    audience: documentAudienceSchema,
    reviewOnly: z.boolean(),
  }),
  z.strictObject({
    action: z.enum(['sync', 'pause', 'resume', 'remove']),
    id: z.uuid(),
  }),
  z.strictObject({
    action: z.literal('configure'),
    id: z.uuid(),
    recursive: z.boolean(),
    intervalMinutes: z.int().min(5).max(1440),
    audience: documentAudienceSchema,
    reviewOnly: z.boolean(),
  }),
  z.strictObject({ action: z.literal('disconnect'), id: z.uuid() }),
  z.strictObject({
    action: z.literal('file_audience'),
    id: z.uuid(),
    itemId: remoteId,
    audience: documentAudienceSchema.nullable(),
  }),
]);
export type ConnectorOperation = z.infer<typeof connectorOperationSchema>;
export type MicrosoftConnection = {
  id: string;
  user_id: string;
  tenant_id: string;
  account_id: string;
  username: string;
  status: 'CONNECTED' | 'REAUTH_REQUIRED';
  version: number;
  cache: string;
};
export type SharePointConnector = {
  id: string;
  user_id: string;
  connection_id: string;
  source_id: string;
  title: string;
  site_id: string;
  drive_id: string;
  root_item_id: string;
  web_url: string;
  recursive: boolean;
  interval_minutes: number;
  review_only: boolean;
  audience_kind: 'GENERAL' | 'RECIPIENT' | 'DOMAIN';
  audience_key: string;
  status: 'ACTIVE' | 'PAUSED';
  phase: 'DELTA' | 'INDEX' | 'IDLE';
  delta_link: string | null;
  next_link: string | null;
  full_scan: boolean;
  generation: number;
  lease_id: string | null;
  lease_until: string | null;
  version: number;
  next_sync_at: string;
  last_sync_at: string | null;
  error_code: string | null;
  discovered?: number;
  ready?: number;
  pending?: number;
  omitted?: number;
  failed?: number;
};
export type RemoteItem = {
  id: string;
  name?: string;
  eTag?: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  parentReference?: { id?: string; driveId?: string };
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  deleted?: object;
  remoteItem?: object;
};
export type SyncedItem = {
  item_id: string;
  parent_id: string | null;
  name: string;
  etag: string;
  size: number;
  mime_type: string;
  web_url: string;
  modified_at: string;
  is_folder: boolean;
  status: string;
  document_id: string | null;
  in_scope: boolean;
  error_code: string | null;
  audience_kind?: 'GENERAL' | 'DOMAIN' | 'RECIPIENT' | null;
  audience_key?: string | null;
};
export type ConnectorSnapshot = {
  enabled: boolean;
  configured: boolean;
  ocrConfigured: boolean;
  connections: Omit<MicrosoftConnection, 'cache' | 'user_id'>[];
  connectors: SharePointConnector[];
};
export interface SharePointStore {
  command<T>(action: string, input?: Record<string, unknown>): Promise<T>;
}
export const sharePointLimits = {
  maxFileBytes: 50 * 1024 * 1024,
  maxFiles: 5000,
  maxInventory: 50000,
  maxTextCharacters: 1_000_000,
  maxOcrPagesPerFile: 100,
  maxEmbeddedImages: 20,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
} as const;
