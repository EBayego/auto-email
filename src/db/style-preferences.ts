import type { DataClient } from './models';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import { createStyleRelationshipRepository } from './style-relationships';
import {
  normalizeStyleScope,
  type StyleScope,
} from '@/modules/identity/contextual-style';
import {
  resolveStylePreferences,
  preferenceKeys,
  stylePreferenceLimit,
  StylePreferenceError,
  validateScopedPreference,
  validateStylePreference,
  type ScopedStylePreference,
  type StoredStylePreference,
  type StylePreference,
} from '@/modules/identity/style-preferences';
import type { Tables } from './database.types';

export function createStylePreferenceRepository(
  client: DataClient,
  userId: string,
  accountId: string,
) {
  requireUuid(userId);
  requireUuid(accountId);
  const authorize = async () => {
    const owner = createOwnerRepositories(client, userId);
    if (
      (await owner.users.get())?.status !== 'ACTIVE' ||
      requireResource(await owner.gmailAccounts.findById(accountId)).status !==
        'CONNECTED'
    )
      throw new DataAccessError('FORBIDDEN');
  };
  const decode = (row: Tables<'style_preferences'>): StoredStylePreference => {
    if (
      row.user_id !== userId ||
      row.gmail_account_id !== accountId ||
      row.origin !== 'EXPLICIT'
    )
      throw new DataAccessError('UNAVAILABLE');
    requireUuid(row.revision);
    return {
      scope: normalizeStyleScope({ kind: row.scope_kind, key: row.scope_key }),
      preference: validateStylePreference({
        key: row.preference_key,
        value: row.preference_value,
      }),
      origin: 'EXPLICIT',
      revision: row.revision,
    };
  };
  const list = async () => {
    await authorize();
    const { data, error } = await client
      .from('style_preferences')
      .select('*')
      .eq('user_id', userId)
      .eq('gmail_account_id', accountId)
      .order('scope_kind')
      .order('scope_key')
      .order('preference_key')
      .limit(stylePreferenceLimit + 1);
    if (error || !data || data.length > stylePreferenceLimit)
      throw new DataAccessError('UNAVAILABLE');
    return data.map(decode);
  };
  return Object.freeze({
    list,
    async set(input: ScopedStylePreference, expectedRevision?: string | null) {
      const { scope, preference } = validateScopedPreference(input);
      if (typeof expectedRevision === 'string') requireUuid(expectedRevision);
      const rows = await list();
      const existing = rows.find(
        (row) =>
          row.scope.kind === scope.kind &&
          row.scope.key === scope.key &&
          row.preference.key === preference.key,
      );
      if (!existing && rows.length >= stylePreferenceLimit)
        throw new DataAccessError('INVALID_INPUT');
      const value = {
        user_id: userId,
        gmail_account_id: accountId,
        scope_kind: scope.kind,
        scope_key: scope.key,
        preference_key: preference.key,
        preference_value: preference.value,
        origin: 'EXPLICIT',
      };
      const query =
        expectedRevision === null
          ? client.from('style_preferences').insert(value)
          : expectedRevision === undefined
            ? client.from('style_preferences').upsert(value, {
                onConflict:
                  'gmail_account_id,scope_kind,scope_key,preference_key',
              })
            : client
                .from('style_preferences')
                .update({ preference_value: preference.value })
                .eq('user_id', userId)
                .eq('gmail_account_id', accountId)
                .eq('scope_kind', scope.kind)
                .eq('scope_key', scope.key)
                .eq('preference_key', preference.key)
                .eq('revision', expectedRevision);
      const { data, error } = await query.select('*').maybeSingle();
      if (error?.code === '23505' || (!error && !data))
        throw new StylePreferenceError('STALE_PREFERENCE');
      if (error || !data) throw new DataAccessError('UNAVAILABLE');
      return decode(data);
    },
    async remove(
      scopeInput: StyleScope,
      key: StylePreference['key'],
      expectedRevision?: string,
    ) {
      const scope = normalizeStyleScope(scopeInput);
      if (!preferenceKeys.includes(key))
        throw new StylePreferenceError('INVALID_PREFERENCE');
      if (expectedRevision !== undefined) requireUuid(expectedRevision);
      await authorize();
      let query = client
        .from('style_preferences')
        .delete()
        .eq('user_id', userId)
        .eq('gmail_account_id', accountId)
        .eq('scope_kind', scope.kind)
        .eq('scope_key', scope.key)
        .eq('preference_key', key);
      if (expectedRevision) query = query.eq('revision', expectedRevision);
      const { data, error } = await query.select('revision');
      if (error) throw new DataAccessError('UNAVAILABLE');
      if (expectedRevision && !data?.length)
        throw new StylePreferenceError('STALE_PREFERENCE');
    },
    async resolve(recipient: string) {
      const rows = await list();
      const rules = rows.some((row) => row.scope.kind === 'RELATIONSHIP')
        ? await createStyleRelationshipRepository(
            client,
            userId,
            accountId,
          ).list()
        : [];
      return resolveStylePreferences(rows, recipient, rules);
    },
  });
}
