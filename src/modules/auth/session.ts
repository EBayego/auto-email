import type { AuthClient } from './client';
import { DataAccessError } from '@/db/errors';
import { openUserDataAccess } from '@/db/user-data';

export type Account = {
  user: { id: string; email: string };
  settings: {
    automationEnabled: boolean;
    pollIntervalSeconds: number;
    maxDailyDrafts: number;
  };
};

export type AccountResult =
  | { status: 'authenticated'; account: Account }
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | { status: 'unavailable' };

export async function resolveAccount(
  client: AuthClient,
): Promise<AccountResult> {
  try {
    const data = await openUserDataAccess(client);
    const settings = await data.settings.get();

    return {
      status: 'authenticated',
      account: {
        user: data.user,
        settings: {
          automationEnabled: settings.automation_enabled,
          pollIntervalSeconds: settings.poll_interval_seconds,
          maxDailyDrafts: settings.max_daily_drafts,
        },
      },
    };
  } catch (error) {
    if (error instanceof DataAccessError) {
      if (error.code === 'UNAUTHENTICATED')
        return { status: 'unauthenticated' };
      if (error.code === 'FORBIDDEN') return { status: 'forbidden' };
    }
    return { status: 'unavailable' };
  }
}
