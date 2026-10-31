import 'server-only';
import { createServerAuthClient } from './auth';
import { openUserStyleEditor } from '@/db/user-style-editor';
export async function getStyleEditorAccess() {
  return openUserStyleEditor(await createServerAuthClient());
}
