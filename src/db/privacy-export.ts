import type { DataClient } from './models';
import type { Database } from './database.types';
import { DataAccessError, requireUuid } from './errors';

// Explicit allowlist: never export token ciphertext, OAuth state, leases or receipts.
const exportColumns = {
  users: 'id,status,created_at,updated_at',
  archived_drafts: '*',
  user_settings: '*',
  gmail_accounts: 'id,email,status,scope_set,created_at,updated_at',
  style_profiles: '*',
  style_preferences: '*',
  style_relationships: '*',
  gmail_onboarding:
    'consent_revision,consent_version,consented_at,scope,status,scanned,selected,finished_at',
  source_documents: '*',
  source_document_texts: '*',
  knowledge_sources: '*',
  source_rules: '*',
  source_rule_sources: '*',
  processing_runs:
    'id,gmail_account_id,status,trigger_kind,started_at,finished_at,error_code',
  email_jobs:
    'id,gmail_account_id,thread_id,target_message_id,status,reason_code,created_at,finished_at',
  generation_runs: '*',
  feedback_events:
    'id,gmail_account_id,status,reason_code,metrics,sent_at,processed_at',
  generation_content_authorizations: '*',
  generation_temporary_content:
    'generation_run_id,body_text,created_at,expires_at',
  style_learning_settings: '*',
  style_learning_proposals: '*',
  privacy_authorizations:
    'notice_version,notice_hash,notice_text,accepted_at,withdrawn_at',
  privacy_events: 'id,action,notice_version,notice_hash,notice_text,created_at',
  account_data_events: 'id,action,created_at',
} satisfies Partial<Record<keyof Database['public']['Tables'], string>>;

export async function exportPrivacyData(client: DataClient, userId: string) {
  requireUuid(userId);
  const result: Record<string, unknown[]> = {};
  let bytes = 0;
  for (const [name, columns] of Object.entries(exportColumns)) {
    const table = name as keyof typeof exportColumns;
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += 500) {
      const query =
        table === 'users'
          ? client.from('users').select(columns).eq('id', userId)
          : client.from(table).select(columns).eq('user_id', userId);
      const order =
        table === 'users'
          ? ['id']
          : [
                'user_settings',
                'gmail_onboarding',
                'privacy_authorizations',
              ].includes(table)
            ? ['user_id']
            : [
                  'style_learning_settings',
                  'generation_content_authorizations',
                ].includes(table)
              ? ['gmail_account_id']
              : table === 'generation_temporary_content'
                ? ['generation_run_id']
                : table === 'source_document_texts'
                  ? ['document_id']
                  : table === 'style_relationships'
                    ? ['gmail_account_id', 'match_kind', 'match_key']
                    : table === 'style_preferences'
                      ? [
                          'gmail_account_id',
                          'scope_kind',
                          'scope_key',
                          'preference_key',
                        ]
                      : table === 'source_rule_sources'
                        ? ['rule_id', 'source_id']
                        : ['id'];
      let ordered = query;
      if (table === 'generation_temporary_content')
        ordered = ordered.filter('expires_at', 'gt', new Date().toISOString());
      for (const column of order) ordered = ordered.order(column);
      const { data, error } = await ordered.range(offset, offset + 499);
      if (error || !data) throw new DataAccessError('UNAVAILABLE');
      bytes += Buffer.byteLength(JSON.stringify(data));
      // Fail explicitly instead of silently truncating a data-access request.
      if (bytes > 25 * 1024 * 1024 || offset >= 100000)
        throw new DataAccessError('UNAVAILABLE');
      rows.push(...data);
      if (data.length < 500) break;
    }
    result[name] = rows;
  }
  const external = await client.rpc('sharepoint_command', {
    p_user_id: userId,
    p_action: 'export',
  });
  if (external.error) {
    if (
      external.error.code !== 'PGRST202' ||
      process.env.SHAREPOINT_ENABLED === 'true'
    )
      throw new DataAccessError('UNAVAILABLE');
  } else result.sharepoint = [external.data];
  if (Buffer.byteLength(JSON.stringify(result)) > 25 * 1024 * 1024)
    throw new DataAccessError('UNAVAILABLE');
  return { exportedAt: new Date().toISOString(), data: result };
}
