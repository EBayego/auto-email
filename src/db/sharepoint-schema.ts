import type {
  MicrosoftConnection,
  SharePointConnector,
  SyncedItem,
} from '@/modules/sharepoint/contracts';
type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
  ComputedFields: never;
};
// Kept alongside the generated baseline until the complete Supabase schema can
// be regenerated locally. The SQL migration is exercised by PostgreSQL tests.
export type SharePointDatabaseTables = {
  microsoft_connections: Table<
    MicrosoftConnection & {
      cache_version: number;
      token_lease: string | null;
      token_lease_until: string | null;
      created_at: string;
    },
    'user_id' | 'tenant_id' | 'account_id' | 'username' | 'cache'
  >;
  microsoft_oauth_attempts: Table<
    { state_hash: string; user_id: string; secret: string; expires_at: string },
    'state_hash' | 'user_id' | 'secret'
  >;
  knowledge_connectors: Table<
    Omit<
      SharePointConnector,
      'discovered' | 'ready' | 'pending' | 'omitted' | 'failed'
    > & { root_ancestors: string[] },
    | 'user_id'
    | 'connection_id'
    | 'source_id'
    | 'title'
    | 'site_id'
    | 'drive_id'
    | 'root_item_id'
    | 'web_url'
  >;
  sharepoint_items: Table<
    Omit<SyncedItem, 'audience_kind' | 'audience_key'> & {
      connector_id: string;
      user_id: string;
      generation: number;
      is_deleted: boolean;
      remote_link: boolean;
      audience_kind: string | null;
      audience_key: string | null;
    },
    'connector_id' | 'user_id' | 'item_id' | 'generation'
  >;
  sharepoint_ocr_usage: Table<
    { user_id: string; day: string; reserved_pages: number },
    'user_id' | 'reserved_pages'
  >;
};
