import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getAccount, createServerAuthClient } from './auth';
import { getUserData } from './data';
import { createWritingProfileRepository } from '@/db/writing-profiles';

export const requireAccount = cache(async () => {
  const result = await getAccount();
  if (result.status === 'unauthenticated' || result.status === 'forbidden')
    redirect('/login');
  if (result.status !== 'authenticated') throw new Error('ACCOUNT_UNAVAILABLE');
  return result.account;
});

export const getWorkspaceGmail = cache(async () => {
  await requireAccount();
  return (await getUserData()).gmailAccounts.get();
});

export const getRecentRuns = cache(async () => {
  await requireAccount();
  return (await getUserData()).processingRuns.list(20);
});

export const getWorkspaceStyle = cache(async () => {
  const account = await requireAccount();
  const gmail = await getWorkspaceGmail();
  if (!gmail || gmail.status !== 'CONNECTED') return null;
  return createWritingProfileRepository(
    await createServerAuthClient(),
    account.user.id,
    gmail.id,
  ).get();
});
