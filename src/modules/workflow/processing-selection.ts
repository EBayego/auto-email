import type { GmailMessage } from '@/providers/contracts';
export type ProcessingScope = 'ALL_INCOMING' | 'INBOX' | 'UNREAD_INBOX';
export function matchesProcessingScope(
  message: GmailMessage,
  scope: ProcessingScope,
) {
  if (!['ALL_INCOMING', 'INBOX', 'UNREAD_INBOX'].includes(scope)) return false;
  if (scope === 'ALL_INCOMING') return true;
  return (
    !!message.labelIds?.includes('INBOX') &&
    (scope !== 'UNREAD_INBOX' || message.labelIds.includes('UNREAD'))
  );
}
