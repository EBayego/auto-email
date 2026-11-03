import {
  microsoftOAuthMessages,
  microsoftOAuthStatus,
} from '@/modules/sharepoint/oauth-status';

export function MicrosoftConnectionNotice({ result }: { result?: string }) {
  if (!result) return null;
  const code = microsoftOAuthStatus(result);
  const message = microsoftOAuthMessages[code];
  const connected = code === 'CONNECTED';
  return (
    <div
      className={connected ? 'form-message' : 'form-error'}
      role={connected ? 'status' : 'alert'}
      aria-live={connected ? 'polite' : 'assertive'}
    >
      <strong>{message.title}</strong>
      <p>{message.detail}</p>
      {!connected && (
        <p>
          Código: <code>{code}</code>
        </p>
      )}
      {code === 'PRIVACY_CONSENT_REQUIRED' && (
        <a href="/privacy-consent">Revisar información de privacidad</a>
      )}
    </div>
  );
}
