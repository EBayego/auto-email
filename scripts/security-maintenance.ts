import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import {
  ConfigurationError,
  getDataServiceConfig,
  getWebServerConfig,
} from '../src/config/env';
import {
  getErasureLedger,
  SecurityStateError,
} from '../src/modules/security/erasure-ledger';
import { createServiceDataClient } from '../src/db/service-client';
import {
  containSecurityIncident,
  replayErasureLedger,
  verifyErasureReplay,
} from '../src/db/security-maintenance';
import { logOperationalEvent } from '../src/modules/security/operational-log';

export const usage = `MAIL-062 — Contención y restauración sin recuperar datos suprimidos.
Uso: npm run security:maintenance -- --action init|contain|restore|release [--confirmed] [--help]
  init     Inicializa el registro cifrado de supresiones sin reemplazar uno existente.
  contain  Bloquea RLS y procesamiento, pausa Gmail, cancela trabajos y purga permisos temporales.
  restore  Reaplica TODAS las supresiones del registro externo y ejecuta las purgas.
  release  Retira el bloqueo global; Gmail y la automatización siguen en pausa.
Antes de restaurar: aislar el proyecto y la aplicación del tráfico, detener workers,
activar SECURITY_MAINTENANCE_MODE=true y preservar el registro EXTERNO a Supabase.
Después de restaurar: aplicar migraciones y ejecutar contain y restore con --confirmed.
No abrir el tráfico ni retirar el modo de mantenimiento si restore falla.
Con resultado correcto: revisar conservación, permisos, credenciales e integridad;
ejecutar release con --confirmed y retirar SECURITY_MAINTENANCE_MODE.
Ante un incidente: contain; preservar evidencias fuera de logs ordinarios; revocar
sesiones y credenciales afectadas en los proveedores y rotar secretos en su gestor;
evaluar alcance, obligaciones y notificaciones con el responsable de privacidad.
No imprimir ni adjuntar contenido de correo o secretos a informes ordinarios.
ERASURE_LEDGER_DIRECTORY y ERASURE_LEDGER_ENCRYPTION_KEY deben estar en almacenamiento
persistente independiente de las restauraciones de la base, compartido por web y worker.
Conservar su clave y registro mientras existan copias que puedan recuperar esos datos.
Este comando nunca restaura una base ni borra copias de seguridad del proveedor.`;

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      action: { type: 'string' },
      confirmed: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!['init', 'contain', 'restore', 'release'].includes(values.action ?? ''))
    throw new Error('INVALID_ACTION');
  if (!values.confirmed) throw new Error('CONFIRMATION_REQUIRED');
  nextEnvironment.loadEnvConfig(
    process.cwd(),
    process.env.NODE_ENV !== 'production',
    { info() {}, error() {} },
  );
  if (values.action === 'contain') {
    await containSecurityIncident(
      createServiceDataClient(getDataServiceConfig()),
    );
    logOperationalEvent({ type: 'SECURITY_CONTAINED' });
    return;
  }
  const ledger = getErasureLedger();
  if (!ledger) throw new SecurityStateError('ERASURE_LEDGER_UNAVAILABLE');
  if (values.action === 'init') {
    await ledger.initialize();
    console.log(
      'Registro cifrado inicializado. No se han modificado datos de Supabase.',
    );
    return;
  }
  const client = createServiceDataClient(getDataServiceConfig());
  if (values.action === 'restore') {
    logOperationalEvent({
      type: 'SECURITY_RESTORE_COMPLETED',
      ...(await replayErasureLedger(client, getWebServerConfig())),
    });
  } else {
    await verifyErasureReplay(client);
    const result = await client.rpc('release_security_hold', {
      p_reviewed: true,
    });
    if (result.error || result.data !== true) throw new Error('UNAVAILABLE');
    console.log('Bloqueo global retirado. Las cuentas Gmail siguen en pausa.');
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    console.error(
      error instanceof ConfigurationError
        ? error.message
        : error instanceof SecurityStateError
          ? error.code
          : 'No se pudo completar la operación de seguridad. Revisa --help y la confirmación.',
    );
    process.exitCode = 1;
  });
