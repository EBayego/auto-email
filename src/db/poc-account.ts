import type { DataClient } from './models';
import { DataAccessError, requireResource } from './errors';
import { createOwnerRepositories } from './repositories';

// Local operator CLI only. Resolve an explicitly selected, already authorized mailbox;
// all subsequent reads still use the worker's owner/account checks.
export async function resolvePocAccount(
  client: DataClient,
  email: string,
  requireConnected = true,
) {
  if (
    typeof email !== 'string' ||
    !/^[^\s<>@]+@[^\s<>@]+$/u.test(email) ||
    email.length > 254
  )
    throw new DataAccessError('INVALID_INPUT');
  const { data, error } = await client
    .from('gmail_accounts')
    .select('id, user_id')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) throw new DataAccessError('UNAVAILABLE');
  if (!data) throw new DataAccessError('NOT_FOUND');
  const work = { userId: data.user_id, gmailAccountId: data.id };
  const access = createOwnerRepositories(client, work.userId);
  if ((await access.users.get())?.status !== 'ACTIVE')
    throw new DataAccessError('FORBIDDEN');
  const account = requireResource(
    await access.gmailAccounts.findById(work.gmailAccountId),
  );
  if (requireConnected && account.status !== 'CONNECTED')
    throw new DataAccessError('FORBIDDEN');
  return { work, account };
}
