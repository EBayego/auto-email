import type { GmailAccount } from '@/db/models';
import { DisconnectGmail } from './disconnect-gmail';

export function GmailControls({ account }: { account: GmailAccount | null }) {
  return (
    <div className="workspace-actions">
      <a className="button" href="/api/gmail/connect">
        {account ? 'Volver a conectar Gmail' : 'Conectar Gmail'}
      </a>
      {account?.status === 'CONNECTED' && (
        <>
          <form action="/api/automation" method="post">
            <button
              className="button button-secondary"
              name="action"
              value="pause"
              type="submit"
            >
              Pausar cuenta Gmail
            </button>
          </form>
          <form action="/api/automation" method="post">
            <button
              className="button button-secondary"
              name="action"
              value="run"
              type="submit"
            >
              Revisar correos ahora
            </button>
          </form>
          <form action="/api/gmail/check" method="post">
            <button className="button button-secondary" type="submit">
              Comprobar conexión
            </button>
          </form>
        </>
      )}
      {account?.status === 'PAUSED' && (
        <form action="/api/automation" method="post">
          <button
            className="button button-secondary"
            name="action"
            value="resume"
            type="submit"
          >
            Reactivar cuenta Gmail
          </button>
        </form>
      )}
      {account && <DisconnectGmail />}
    </div>
  );
}
