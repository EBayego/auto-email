import 'server-only';
import { createServerAuthClient } from './auth';
import { openUserGenerationRetention } from '@/db/user-generation-retention';

export async function getGenerationRetention() {
  return openUserGenerationRetention(await createServerAuthClient());
}
