import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import googleProject from '../google/project.json' with { type: 'json' };
import { ConfigurationError } from '../src/config/env.ts';
import { gmailScopes } from '../src/config/google.ts';
import { validateEnvironment } from './check-env.mjs';

export class GoogleSetupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GoogleSetupError';
  }
}

export function checkGoogleCredentials(config, credentialsText) {
  if (config.providerMode !== 'live')
    throw new GoogleSetupError('La comprobación requiere PROVIDER_MODE=live.');

  let credentials;
  try {
    credentials = JSON.parse(credentialsText);
  } catch {
    throw new GoogleSetupError(
      'El archivo no es JSON válido. Descarga el JSON del cliente OAuth desde Google Auth Platform > Clients.',
    );
  }
  const web = credentials?.web;
  if (
    !web ||
    typeof web !== 'object' ||
    Array.isArray(web) ||
    credentials.installed ||
    credentials.type === 'service_account'
  )
    throw new GoogleSetupError(
      'Se necesita el JSON de un cliente OAuth de tipo Web application.',
    );
  if (
    typeof web.project_id !== 'string' ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(web.project_id)
  )
    throw new GoogleSetupError('El JSON no contiene un project_id válido.');
  if (web.project_id !== googleProject.projectId)
    throw new GoogleSetupError(
      'El cliente OAuth no pertenece al proyecto configurado en google/project.json.',
    );
  if (
    ![
      'https://accounts.google.com/o/oauth2/auth',
      'https://accounts.google.com/o/oauth2/v2/auth',
    ].includes(web.auth_uri) ||
    web.token_uri !== 'https://oauth2.googleapis.com/token'
  )
    throw new GoogleSetupError(
      'Los endpoints OAuth del JSON no corresponden a Google.',
    );

  const failures = [];
  if (web.client_id !== config.google.clientId)
    failures.push('GOOGLE_CLIENT_ID');
  if (web.client_secret !== config.google.clientSecret.reveal())
    failures.push('GOOGLE_CLIENT_SECRET');
  if (
    !Array.isArray(web.redirect_uris) ||
    !web.redirect_uris.includes(config.google.redirectUri)
  )
    failures.push('GOOGLE_REDIRECT_URI');
  if (failures.length)
    throw new GoogleSetupError(
      `El JSON y la configuración del servidor no coinciden: ${failures.join(', ')}. Revisa el cliente OAuth y descarga de nuevo su JSON.`,
    );

  const project = encodeURIComponent(web.project_id);
  return Object.freeze({
    projectId: web.project_id,
    redirectUri: config.google.redirectUri,
    scopes: gmailScopes,
    consoleUrls: Object.freeze({
      gmailApi: `https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=${project}`,
      branding: `https://console.cloud.google.com/auth/branding?project=${project}`,
      audience: `https://console.cloud.google.com/auth/audience?project=${project}`,
      dataAccess: `https://console.cloud.google.com/auth/scopes?project=${project}`,
      clients: `https://console.cloud.google.com/auth/clients?project=${project}`,
    }),
  });
}

export function runGoogleCheck(args = process.argv.slice(2)) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        credentials: { type: 'string' },
        help: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new GoogleSetupError(
      'Argumentos inválidos. Usa npm run google:check -- --credentials "ruta/al/client_secret.json".',
    );
  }
  if (values.help) {
    console.log(
      'Uso: npm run google:check -- --credentials "ruta/al/client_secret.json"\nComprueba el JSON del cliente web contra las variables del servidor. No realiza peticiones ni valida el estado remoto de Google Cloud.',
    );
    return;
  }
  if (!values.credentials)
    throw new GoogleSetupError(
      'Indica el JSON descargado de Google con --credentials "ruta/al/client_secret.json".',
    );

  let credentialsText;
  try {
    credentialsText = readFileSync(values.credentials, 'utf8');
  } catch {
    throw new GoogleSetupError('No se pudo leer el archivo de credenciales.');
  }
  const report = checkGoogleCredentials(validateEnvironment(), credentialsText);
  console.log(
    `Configuración local coherente con el JSON OAuth: ${report.projectId}.\nCallback registrado: ${report.redirectUri}\nScopes requeridos:\n${report.scopes.join('\n')}\n\nComprobaciones pendientes en Google Cloud:\nGmail API habilitada: ${report.consoleUrls.gmailApi}\nNombre de aplicación y correo de soporte: ${report.consoleUrls.branding}\nAudiencia External, estado Testing y usuarios de prueba: ${report.consoleUrls.audience}\nLos dos scopes declarados: ${report.consoleUrls.dataAccess}\nCliente Web application y callback: ${report.consoleUrls.clients}\n\nEsta comprobación no autentica el cliente ni confirma la configuración remota. La prueba de autorización requiere el flujo de MAIL-012.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    runGoogleCheck();
  } catch (error) {
    console.error(
      error instanceof GoogleSetupError || error instanceof ConfigurationError
        ? error.message
        : 'No se pudo comprobar la configuración de Google.',
    );
    process.exitCode = 1;
  }
}
