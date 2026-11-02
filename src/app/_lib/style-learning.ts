import 'server-only';
import { createServerAuthClient } from './auth';
import { openUserStyleLearning } from '@/db/user-style-learning';
export async function getStyleLearningAccess() {
  return openUserStyleLearning(await createServerAuthClient());
}
