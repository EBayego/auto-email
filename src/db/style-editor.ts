import type { DataClient } from './models';
import { DataAccessError, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import { parseWritingProfileRow } from './writing-profiles';
import { createStylePreferenceRepository } from './style-preferences';
import { createStyleRelationshipRepository } from './style-relationships';
import {
  contextualStyleLimits,
  normalizeStyleScope,
} from '@/modules/identity/contextual-style';
import {
  StyleEditorError,
  type StyleEditorOperation,
  type StyleEditorSnapshot,
  type StyleProfileView,
} from '@/modules/identity/style-editor';

export function createStyleEditorRepository(
  reader: DataClient,
  writer: DataClient,
  userId: string,
  accountId: string,
) {
  requireUuid(userId);
  requireUuid(accountId);
  const authorize = async () => {
    const owner = createOwnerRepositories(reader, userId);
    if ((await owner.users.get())?.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
    if ((await owner.gmailAccounts.findById(accountId))?.status !== 'CONNECTED')
      throw new StyleEditorError('NOT_CONNECTED');
  };
  const get = async (): Promise<StyleEditorSnapshot | null> => {
    await authorize();
    const [profiles, prefs, rules] = await Promise.all([
      reader
        .from('style_profiles')
        .select('*')
        .eq('user_id', userId)
        .eq('gmail_account_id', accountId)
        .order('scope_kind')
        .order('scope_key')
        .limit(201),
      createStylePreferenceRepository(reader, userId, accountId).list(),
      createStyleRelationshipRepository(reader, userId, accountId).list(),
    ]);
    if (profiles.error || !profiles.data || profiles.data.length > 200)
      throw new DataAccessError('UNAVAILABLE');
    const rows = profiles.data.map((row) => {
      if (row.user_id !== userId || row.gmail_account_id !== accountId)
        throw new DataAccessError('UNAVAILABLE');
      return parseWritingProfileRow(row);
    });
    const general = rows.find((row) => row.scope_kind === 'GENERAL');
    if (!general) return null;
    const ruleRevisions = rules
      .map((rule) => rule.revision)
      .sort()
      .join(',');
    const views: StyleProfileView[] = rows.map((row) => {
      let inactiveReason: StyleProfileView['inactiveReason'] = null;
      if (row.scope_kind !== 'GENERAL') {
        const age = Date.now() - Date.parse(row.generated_at);
        inactiveReason =
          row.parent_revision !== general.revision
            ? 'GENERAL_CHANGED'
            : row.scope_kind === 'RELATIONSHIP' &&
                [...row.relationship_rule_revisions].sort().join(',') !==
                  ruleRevisions
              ? 'RULES_CHANGED'
              : age < -5000 || age >= contextualStyleLimits.maxAgeMs
                ? 'EXPIRED'
                : general.review_status !== 'CONFIRMED'
                  ? 'GENERAL_UNREVIEWED'
                  : null;
      }
      if (!['UNREVIEWED', 'CONFIRMED'].includes(row.review_status))
        throw new DataAccessError('UNAVAILABLE');
      return {
        scope: normalizeStyleScope({
          kind: row.scope_kind,
          key: row.scope_key,
        }),
        revision: row.revision,
        parentRevision: row.parent_revision,
        version: row.version,
        generatedAt: row.generated_at,
        sampleSize: row.sample_size,
        reviewed: row.review_status === 'CONFIRMED',
        profile: row.profile,
        current: inactiveReason === null,
        inactiveReason,
      };
    });
    return {
      generalRevision: general.revision,
      profiles: views,
      preferences: prefs,
    };
  };
  return Object.freeze({
    get,
    async apply(operation: StyleEditorOperation) {
      await authorize();
      const { data, error } = await writer.rpc('edit_writing_style', {
        p_user_id: userId,
        p_account_id: accountId,
        p_general_revision: operation.generalRevision,
        p_scope_kind: operation.scope.kind,
        p_scope_key: operation.scope.key,
        p_profile_revision: operation.profileRevision ?? undefined,
        p_expected_revisions: operation.expectedRevisions,
        p_action: operation.action.toUpperCase(),
        p_preferences:
          operation.action === 'save'
            ? operation.preferences.map((preference) => ({ ...preference }))
            : [],
        p_reviewed: operation.action === 'confirm' && operation.reviewed,
      });
      if (error) {
        if (error.message === 'FORBIDDEN')
          throw new DataAccessError('FORBIDDEN');
        const known = [
          'NOT_CONNECTED',
          'STYLE_PROFILE_REQUIRED',
          'STALE_STYLE',
          'STALE_PREFERENCE',
          'GENERAL_PROFILE_REQUIRED',
          'CONTEXT_NOT_CURRENT',
          'INVALID_INPUT',
        ];
        throw new StyleEditorError(
          error.code === '23514'
            ? 'INVALID_INPUT'
            : known.includes(error.message)
              ? error.message
              : 'UNAVAILABLE',
        );
      }
      if (!data) throw new StyleEditorError('UNAVAILABLE');
    },
  });
}
