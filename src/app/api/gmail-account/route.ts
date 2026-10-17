import { userDataResponse } from '@/app/_lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  return userDataResponse((data) => data.gmailAccounts.get());
}
