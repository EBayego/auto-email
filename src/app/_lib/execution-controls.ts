import 'server-only';
import { openUserExecutionControls } from '@/db/user-execution-controls';
import { createServerAuthClient } from './auth';

export async function getExecutionControls() {
  return openUserExecutionControls(await createServerAuthClient());
}
