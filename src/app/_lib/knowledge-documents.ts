import 'server-only';
import { openUserKnowledgeDocuments } from '@/db/user-knowledge-documents';
import { createServerAuthClient } from './auth';

export async function getKnowledgeDocuments() {
  return openUserKnowledgeDocuments(await createServerAuthClient());
}
