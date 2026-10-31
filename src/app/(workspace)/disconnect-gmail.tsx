'use client';
import { useState } from 'react';
export function DisconnectGmail() {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="account-confirm">
      {!confirming ? (
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setConfirming(true)}
        >
          Desconectar Gmail y revocar acceso
        </button>
      ) : (
        <form action="/api/gmail/disconnect" method="post">
          <p>
            Se detendrá la automatización, se cancelarán los trabajos pendientes
            y se retirará el acceso a Gmail. Puedes conservar los datos del
            servicio o borrarlos desde los controles de cuenta. Los correos y
            borradores de Gmail se conservan.
          </p>
          <input type="hidden" name="confirmed" value="true" />
          <div className="workspace-actions">
            <button className="button" type="submit">
              Sí, desconectar Gmail
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setConfirming(false)}
            >
              Cancelar desconexión
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
