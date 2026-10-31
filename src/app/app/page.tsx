import { redirect } from 'next/navigation';
import type { WorkspaceSearchParams } from '../(workspace)/notices';

export const dynamic = 'force-dynamic';

export default async function LegacyAccountPage({
  searchParams,
}: {
  searchParams: WorkspaceSearchParams;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ['gmail', 'execution', 'error']) {
    if (typeof params[key] === 'string') query.set(key, params[key]);
  }
  const destination =
    query.has('gmail') || query.has('execution') ? '/settings' : '/dashboard';
  redirect(`${destination}${query.size ? `?${query}` : ''}`);
}
