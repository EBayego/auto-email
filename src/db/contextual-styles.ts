import type { DataClient } from './models';
import { createWritingProfileRepository } from './writing-profiles';
import { createStyleRelationshipRepository } from './style-relationships';
import {
  contextualStyleLimits,
  normalizeStyleScope,
  relationshipFor,
  type StyleScope,
} from '@/modules/identity/contextual-style';

export async function selectContextualWritingProfile(
  client: DataClient,
  userId: string,
  accountId: string,
  recipient: string,
  now = new Date(),
) {
  const target = normalizeStyleScope({ kind: 'RECIPIENT', key: recipient });
  const general = await createWritingProfileRepository(
    client,
    userId,
    accountId,
  ).get();
  if (general?.review_status !== 'CONFIRMED') return null;
  const rules = await createStyleRelationshipRepository(
    client,
    userId,
    accountId,
  ).list();
  const category = relationshipFor(target.key, rules);
  const scopes: StyleScope[] = [target];
  if (category) scopes.push({ kind: 'RELATIONSHIP', key: category });
  scopes.push({ kind: 'DOMAIN', key: target.key.split('@')[1] });
  for (const scope of scopes) {
    const profile = await createWritingProfileRepository(
      client,
      userId,
      accountId,
      scope,
    ).get();
    if (
      !profile ||
      profile.review_status !== 'CONFIRMED' ||
      profile.parent_revision !== general.revision
    )
      continue;
    const age = now.getTime() - Date.parse(profile.generated_at);
    if (
      scope.kind === 'RELATIONSHIP' &&
      [...profile.relationship_rule_revisions].sort().join(',') !==
        rules
          .map((r) => r.revision)
          .sort()
          .join(',')
    )
      continue;
    if (
      Number.isFinite(age) &&
      age >= -5000 &&
      age < contextualStyleLimits.maxAgeMs
    )
      return profile;
  }
  return general;
}
