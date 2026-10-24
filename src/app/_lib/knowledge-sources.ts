import 'server-only';
import { openUserKnowledgeSources } from '@/db/user-knowledge-sources';
import { createServerAuthClient } from './auth';

export async function getKnowledgeSources() {
  return openUserKnowledgeSources(await createServerAuthClient());
}
