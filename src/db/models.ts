import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from './database.types';

export type DataClient = SupabaseClient<Database>;
export type UserProfile = Pick<Tables<'users'>, 'id' | 'status'>;
export type UserSettings = Pick<
  Tables<'user_settings'>,
  | 'user_id'
  | 'automation_enabled'
  | 'poll_interval_seconds'
  | 'max_daily_drafts'
>;
export type GmailAccount = Pick<
  Tables<'gmail_accounts'>,
  'id' | 'user_id' | 'email' | 'status' | 'scope_set' | 'last_sync_at'
>;
export type ProcessingRun = Pick<
  Tables<'processing_runs'>,
  | 'id'
  | 'user_id'
  | 'gmail_account_id'
  | 'trigger_kind'
  | 'status'
  | 'started_at'
  | 'finished_at'
  | 'messages_detected'
  | 'messages_processed'
  | 'drafts_created'
  | 'error_count'
  | 'error_code'
>;

export type RunTrigger = 'MANUAL' | 'SCHEDULED' | 'RETRY';
export type RunOutcome = {
  messagesDetected: number;
  messagesProcessed: number;
  draftsCreated: number;
  errorCount: number;
} & (
  | { status: 'COMPLETED' | 'CANCELLED'; errorCode?: string }
  | { status: 'FAILED'; errorCode: string }
);
