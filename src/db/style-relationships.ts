import type { DataClient } from './models';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import {
  contextualStyleLimits,
  normalizeStyleScope,
  validateRelationshipRule,
  type RelationshipRule,
} from '@/modules/identity/contextual-style';

export function createStyleRelationshipRepository(
  client: DataClient,
  userId: string,
  accountId: string,
) {
  requireUuid(userId);
  requireUuid(accountId);
  const authorize = async () => {
    const owners = createOwnerRepositories(client, userId);
    if ((await owners.users.get())?.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
    if (
      requireResource(await owners.gmailAccounts.findById(accountId)).status !==
      'CONNECTED'
    )
      throw new DataAccessError('FORBIDDEN');
  };
  const list = async (): Promise<
    (RelationshipRule & { revision: string })[]
  > => {
    await authorize();
    const { data, error } = await client
      .from('style_relationships')
      .select('user_id,gmail_account_id,match_kind,match_key,category,revision')
      .eq('user_id', userId)
      .eq('gmail_account_id', accountId)
      .order('match_kind')
      .order('match_key')
      .limit(contextualStyleLimits.rules + 1);
    if (error || !data || data.length > contextualStyleLimits.rules)
      throw new DataAccessError('UNAVAILABLE');
    return data.map((row) => {
      if (row.user_id !== userId || row.gmail_account_id !== accountId)
        throw new DataAccessError('UNAVAILABLE');
      requireUuid(row.revision);
      return {
        ...validateRelationshipRule({
          kind: row.match_kind as RelationshipRule['kind'],
          key: row.match_key,
          category: row.category as RelationshipRule['category'],
        }),
        revision: row.revision,
      };
    });
  };
  return Object.freeze({
    list,
    async set(value: RelationshipRule) {
      const rule = validateRelationshipRule(value);
      const existing = await list();
      if (
        existing.length >= contextualStyleLimits.rules &&
        !existing.some((r) => r.kind === rule.kind && r.key === rule.key)
      )
        throw new DataAccessError('INVALID_INPUT');
      const { error } = await client.from('style_relationships').upsert(
        {
          user_id: userId,
          gmail_account_id: accountId,
          match_kind: rule.kind,
          match_key: rule.key,
          category: rule.category,
        },
        { onConflict: 'gmail_account_id,match_kind,match_key' },
      );
      if (error) throw new DataAccessError('UNAVAILABLE');
    },
    async remove(value: Pick<RelationshipRule, 'kind' | 'key'>) {
      const scope = normalizeStyleScope(value);
      if (scope.kind !== 'RECIPIENT' && scope.kind !== 'DOMAIN')
        throw new DataAccessError('INVALID_INPUT');
      await authorize();
      const { error } = await client
        .from('style_relationships')
        .delete()
        .eq('user_id', userId)
        .eq('gmail_account_id', accountId)
        .eq('match_kind', scope.kind)
        .eq('match_key', scope.key);
      if (error) throw new DataAccessError('UNAVAILABLE');
      const cleanup = await client
        .from('style_profiles')
        .delete()
        .eq('user_id', userId)
        .eq('gmail_account_id', accountId)
        .eq('scope_kind', 'RELATIONSHIP');
      if (cleanup.error) throw new DataAccessError('UNAVAILABLE');
    },
  });
}
