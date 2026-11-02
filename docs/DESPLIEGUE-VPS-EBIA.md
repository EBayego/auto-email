# Producción en ebia.cloud — pendientes actuales

Revisado el **2 de noviembre de 2026** mediante archivos locales, DNS público, API de Supabase, SSH de lectura y comprobaciones sin aplicar migraciones. Dominio: **https://auto-email.ebia.cloud**. Contacto: **ebayego.ia@gmail.com**.

Se han retirado las instrucciones ya completadas: alta y DNS de Resend, configuración SMTP de Supabase, URLs de Auth, creación del PAT, contraseña PostgreSQL, descarga del cliente Google de producción y preparación de sus credenciales. SMTP real comprobado: `smtp.resend.com:465`, usuario `resend`, remitente `acceso@auth.ebia.cloud`, nombre `Auto Email` y contraseña configurada. El PAT y la contraseña de base superaron el `dry-run` de migraciones. Los dos cifrados conservan las claves locales existentes.

El dominio ya apunta a `194.164.72.105`, los tres registros de Resend resuelven y hay TXT de verificación de Google publicado. **Todavía falta desplegar Auto Email y tener HTTPS válido**: HTTP devuelve 404, HTTPS presenta un certificado autofirmado y no hay instalación/contenedores de esta aplicación en la VPS. Publicar el TXT tampoco acredita por sí solo que Search Console haya confirmado la propiedad.

**Backups aplazados:** `.production/deployment.env` conserva `BACKUP_MODE=deferred`. No completes ahora S3/Restic ni instales su timer. Su recuperación y la réplica externa actualizada del ledger siguen en el punto 1 de [TODO-PROXIMOS-PASOS.md](../TODO-PROXIMOS-PASOS.md). Los archivos y claves existentes deben conservarse. El procedimiento actual omite la copia previa a migraciones.

La configuración de privacidad ya está sincronizada entre `.env.local` y `.production/operator.json`, sin bloques `PENDIENTE_…`. Se han incorporado los datos de Supabase Free, backups semanales de Hostinger en Países Bajos, Resend Free y condiciones estándar confirmados por el operador. Copia legible y fuentes: `.production/privacy-processing-draft.txt` y `.production/privacy-processing-sources.md`. Se conserva la aprobación configurada en origen; este dato no acredita revisión externa de Google.

Los comandos de despliegue siguientes son instrucciones para después; esta revisión no los ha ejecutado ni ha enviado correos. El proyecto Supabase está compartido con desarrollo/staging: no ejecutes resets ni seeds remotos.

## 1. Completar cuentas y comprobar el correo real

### Recuperación de contraseña — falta código

- [ ] Implementar solicitud, callback seguro y formulario de nueva contraseña con Supabase Auth.
- [ ] Configurar plantilla y retorno exacto; probar enlaces inválidos, caducados y reutilizados y el acceso con la contraseña nueva.

El SMTP ya está configurado, pero no añade este flujo. El callback actual `/auth/callback` intercambia el código y redirige a `/app`.

### Admisión al piloto — falta control

La API de Supabase confirma que **el alta de usuarios sigue habilitada**. El registro web tampoco comprueba una invitación.

- [ ] Definir/restringir las cuentas admitidas al piloto y revisar las ya existentes.
- [ ] Si el piloto es por invitación, bloquear el alta pública en Supabase y servidor e implementar aceptación de invitación y elección de contraseña.
- [ ] Probar el rechazo de altas no autorizadas antes de publicar la ruta. Los testers de Google no restringen el registro web.

### Resend — solo falta probar recepción y confirmación

El usuario confirma que todavía no ha realizado esta prueba. No vuelvas a crear el dominio, DNS, API key o SMTP.

- [ ] Registrar una cuenta con un correo externo controlado desde una versión funcional de Auto Email.
- [ ] Recibir el mensaje y abrir el enlace en el mismo navegador para completar PKCE.
- [ ] Comprobar confirmación, login/logout y ausencia de errores en Resend/Supabase.

Puedes probar en localhost con su retorno ya autorizado. Repite la prueba final contra HTTPS después del despliegue. Site URL de Supabase ya es `https://auto-email.ebia.cloud`, están autorizados su `/auth/callback` y el retorno local, y la confirmación de correo está activada.

## 2. Resolver el receptor de alertas

**`.production/operator.json`: `ALERT_WEBHOOK_URL` sigue vacío.** El bearer ya tiene valor. El preflight actual exige un receptor: aplazar backups no hace opcionales los avisos.

- [ ] Configurar un receptor real y probarlo, o implementar explícitamente el modo sin avisos antes de desplegar.

Para usar el n8n existente:

1. Crear Webhook POST, path `auto-email-alerts`, autenticación Header Auth.
2. Credencial: nombre `Authorization`, valor `Bearer ` seguido de `ALERT_WEBHOOK_BEARER_TOKEN`. Conservar el token existente.
3. Validar el evento, guardar/deduplicar persistentemente por `body.eventId` y enviar al canal elegido. Responder 2xx después de aceptación duradera; los repetidos aceptados deben devolver éxito sin duplicar avisos.
4. Publicar el workflow, probar autenticación, entrega y reintentos y copiar su Production URL a `ALERT_WEBHOOK_URL`. La URL prevista es `https://a.ebia.cloud/webhook/auto-email-alerts`; solo utilizarla si es la URL realmente publicada y accesible.

El SMTP de Supabase solo envía mensajes de Auth. Para avisos por correo desde n8n, prepara allí una credencial de envío dedicada. El formato del evento está en [la guía general, sección 7](PUESTA-EN-MARCHA-PRODUCCION.md). Añade vigilancia externa de disponibilidad: el n8n de esta VPS tampoco avisará si cae toda ella.

## 3. Validar el acceso real a los proveedores

Las claves ya tienen valor; no hay que crearlas otra vez.

- [ ] Confirmar en el proyecto Google que Gmail API está habilitada, la marca y los dos scopes corresponden a la aplicación y las cuentas controladas están en Audience/testers mientras proceda.
- [ ] Confirmar facturación/saldo, acceso al modelo y límites del proyecto OpenAI que utiliza la clave; validar una generación pequeña con datos sintéticos en el ensayo funcional.
- [ ] Revisar los precios configurados si cambia la modalidad/modelo antes de utilizar las estimaciones de costes.

El JSON Google de producción ya existe, coincide con `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` y contiene el callback `https://auto-email.ebia.cloud/api/gmail/callback`. No hace falta recrearlo. La autorización de Gmail es independiente de la confirmación de la cuenta de Auto Email.

## 4. Obtener las imágenes revisadas y completar los digests

En **`.production/deployment.env`**, `APP_IMAGE` y `OPS_IMAGE` todavía contienen `REPLACE_WITH_RELEASE_DIGEST`.

1. Revisar y guardar en Git la versión que se va a desplegar, incluido el modo de backups aplazados y los archivos públicos nuevos. Excluir `.production`, `.env.local`, JSON OAuth, ledger y datos.
2. En GitHub configurar/revisar el environment `production-release` y ejecutar **Preparar imágenes de producción** con el SHA completo revisado. `publish=false` valida; `publish=true` publica tras superar los controles.
3. Obtener `production-release.json` del artefacto y copiar sus referencias `appImage`/`opsImage` a `APP_IMAGE`/`OPS_IMAGE`: deben contener `@sha256:` y un digest real de 64 caracteres hexadecimales.
4. Conservar `BACKUP_MODE=deferred` y el resto de rutas/red ya configuradas.

Para imágenes privadas, prepara la credencial de lectura de GHCR para `docker login` en el apartado siguiente. No añadas un token de registro a `operator.json` ni ejecutes `deployment.env` con `source`.

## 5. Instalar la versión revisada en la VPS

La inspección SSH actual confirma que faltan `/opt/auto-email`, `/srv/auto-email-prod`, `/etc/auto-email-prod` y el archivo dinámico de Traefik. Docker y el proxy existente están en uso por otros proyectos. Instala únicamente Auto Email, preservando esos servicios.

En PowerShell, en la raíz del repositorio, usa el mismo SHA revisado del workflow:

```powershell
git archive --format=tar --output "$env:TEMP\auto-email-release.tar" SHA_REAL_DE_40_CARACTERES
Get-FileHash "$env:TEMP\auto-email-release.tar" -Algorithm SHA256
scp "$env:TEMP\auto-email-release.tar" ebayego@194.164.72.105:/home/ebayego/auto-email-release.tar
ssh ebayego@194.164.72.105
```

`git archive` solo incluye lo guardado en ese commit. Comprueba en la VPS que `sha256sum /home/ebayego/auto-email-release.tar` coincide con el hash local. Después entra con `sudo -i`: necesitarás tu contraseña administrativa; `sudo -n` no estaba disponible. Los bloques Bash siguientes se ejecutan en esa sesión **root**.

Instala Node 24 aislado para los helpers, sin alterar otros proyectos. La versión fijada actual es 24.19.0:

```bash
install -d -m 0700 /root/auto-email-node-download
cd /root/auto-email-node-download
curl --fail --show-error --location --output node-v24.19.0-linux-x64.tar.xz https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz
curl --fail --show-error --location --output SHASUMS256.txt https://nodejs.org/dist/v24.19.0/SHASUMS256.txt
sha256sum --check --ignore-missing SHASUMS256.txt
```

Solo si el tar da **OK**, continúa:

```bash
install -d -m 0755 /opt/auto-email-node
tar -xJf node-v24.19.0-linux-x64.tar.xz --strip-components=1 -C /opt/auto-email-node
/opt/auto-email-node/bin/node --version
install -d -m 0755 /opt/auto-email
tar -xf /home/ebayego/auto-email-release.tar --no-same-owner -C /opt/auto-email
install -d -m 0700 /etc/auto-email-prod
install -d -m 0700 /srv/auto-email-prod
install -d -m 0700 -o 10001 -g 10001 /srv/auto-email-prod/erasures
install -d -m 0700 -o 10001 -g 10001 /srv/auto-email-prod/backup-staging
install -d -m 0700 -o ebayego -g ebayego /home/ebayego/auto-email-private-transfer
```

Mantén esa sesión. Desde **otra terminal PowerShell local**, transfiere solo los archivos privados completados:

```powershell
scp .production/operator.json .production/deployment.env ebayego@194.164.72.105:/home/ebayego/auto-email-private-transfer/
```

En la sesión root de la VPS:

```bash
install -m 0600 /home/ebayego/auto-email-private-transfer/operator.json /root/auto-email-operator.json
install -m 0600 /home/ebayego/auto-email-private-transfer/deployment.env /srv/auto-email-prod/deployment.env
/opt/auto-email-node/bin/node /opt/auto-email/deploy/secrets.mjs --input /root/auto-email-operator.json --output /etc/auto-email-prod/generated
for role in web worker monitor preflight migrate backup; do
  install -m 0400 -o 10001 -g 10001 "/etc/auto-email-prod/generated/$role.json" "/etc/auto-email-prod/$role.json"
done
```

La carpeta de generación debe ser nueva. Las rotaciones posteriores requieren otra carpeta y recreación controlada de servicios; no mezcles generaciones. Custodia y elimina cuando proceda las copias de transferencia tras verificar la instalación, conservando copia cifrada externa. No copies `.env.local` al código ni subas archivos privados a Git.

En la misma sesión root, autentica GHCR para que despliegue/timer compartan acceso:

```bash
read -r -s -p 'Token GHCR de lectura: ' auto_email_registry_token
printf '\n'
printf '%s' "$auto_email_registry_token" | docker login ghcr.io --username ebayego --password-stdin
unset auto_email_registry_token
```

Usa el propietario real del token si es otro usuario. El login como `ebayego` no configura automáticamente el almacén Docker de root. Custodia `/root/.docker/config.json` o utiliza un almacén de credenciales; el archivo de login no es un gestor cifrado.

## 6. Trasladar el ledger vigente

Antes de inicializarlo/arrancar producción:

1. Detén web/worker locales o de staging que escriban en el Supabase compartido y comprueba que no quede un segundo worker remoto. Esto no se ha ejecutado automáticamente.
2. Localiza la ruta real de `ERASURE_LEDGER_DIRECTORY` en tu `.env.local`. Copia por un canal privado **su contenido completo vigente**, incluido `.ledger` y todos los `.erasure`, a `/srv/auto-email-prod/erasures`. El nombre del directorio de origen puede ser distinto: no crees otro vacío como sustituto.
3. Fija propietario `10001:10001` y permisos restrictivos: directorios 0700 y archivos 0600, conservando estructura. Verifica integridad y ausencia de omisiones, incluidos archivos ocultos.
4. Conserva la clave ya copiada en `.production/operator.json`. No regeneres claves ni restaures un ledger antiguo durante rollback.

Si no existiera ningún registro anterior, acredita que no hay supresiones/datos previos que preservar antes de inicializarlo. Protección y recuperación: [MAIL-067](<Resolucion Tareas Épica EPIC-10/MAIL-067-despliegue-produccion.md>).

## 7. Inicializar y desplegar con backups aplazados

No instales aún el archivo Traefik del apartado siguiente. Desde la sesión root:

```bash
dc() {
  docker compose --env-file /srv/auto-email-prod/deployment.env -f /opt/auto-email/deploy/compose.yaml -f /opt/auto-email/deploy/compose.proxy-network.yaml "$@"
}
dc config --quiet
dc pull web worker monitor preflight ledger-init migrate
dc run --rm ledger-init
dc run --rm preflight
```

Con `BACKUP_MODE=deferred` omite Restic, los archivos de conexión de backups y el timer. Resuelve todos los fallos de preflight: no marques una revisión ficticia o un webhook inexistente como solución.

```bash
/opt/auto-email-node/bin/node /opt/auto-email/deploy/release.mjs --config /srv/auto-email-prod/deployment.env --action plan
/opt/auto-email-node/bin/node /opt/auto-email/deploy/release.mjs --config /srv/auto-email-prod/deployment.env --action deploy --confirmed
dc ps
curl --fail http://127.0.0.1:3087/api/health/live
curl --fail http://127.0.0.1:3087/api/health/ready
```

El helper ejecuta las migraciones necesarias sin seed. Con `BACKUP_MODE=required` crea primero una copia; con `deferred` la omite y emite `DEPLOYMENT_BACKUP_DEFERRED`. El plan informa `backupMode` y `backupBeforeMigrations`. La revisión actual solo comprobó las migraciones con `--dry-run --skip-vault`; no las aplicó. Espera salud en web/worker/monitor; un fallo deja la app detenida para revisión, no fuerces su arranque ignorándolo.

El worker puede procesar cuentas habilitadas aunque aún no haya ruta pública: revisa las autorizaciones existentes y usa cuentas controladas. La salud no prueba SMTP, proveedores, aprobación Google o restauración externa.

## 8. Activar la ruta de Traefik y validar HTTPS

**`deploy/proxy.traefik.ebia.yaml` ya tiene el contenido correcto**: host `auto-email.ebia.cloud`, entradas `web`/`websecure`, resolver `le` y upstream `http://auto-email-prod-web:3000` en `privnetproxy`. No tienes que rellenar otra variable del proxy o crear certificados manualmente.

Con la app saludable y el acceso que vayas a publicar controlado, instala solo este archivo nuevo. Si el destino ya existe en ese momento, revisa y conserva copia fuera del directorio vigilado antes de sustituirlo:

```bash
install -m 0644 /opt/auto-email/deploy/proxy.traefik.ebia.yaml /home/ebayego/n8n-ebia/traefik/dynamic/auto-email.yml
```

Traefik ya vigila el directorio: no necesita reiniciarse para añadir el sitio. No sustituyas `tenants.yml`, configuración estática, otros routers o `acme.json`. No instales otro proxy en 80/443. Esta ruta tiene redirección propia a HTTPS.

Desde tu ordenador y otra red externa:

```bash
curl -I http://auto-email.ebia.cloud/
curl -I https://auto-email.ebia.cloud/
curl --fail https://auto-email.ebia.cloud/api/health/live
curl --fail https://auto-email.ebia.cloud/api/health/ready
```

Certificado válido sin `-k`, HTTP redirigido y portada/privacidad/login funcionando. Comprueba el resto de proyectos, empezando por `ebia.cloud`. No abras 3087 al exterior: se mantiene en loopback; solo web se conecta a la red del proxy.

La inspección no pudo consultar el firewall por requerir contraseña sudo. Revisa sus reglas y las de Hostinger preservando SSH/servicios actuales; no actives UFW o cambies reglas globales a ciegas. La ruta nueva hace accesibles la app y su registro: no hereda `onlymyip` de n8n.

La comprobación actual obtuvo HTTP 404 y un certificado HTTPS autofirmado. Tras instalar esta ruta, verifica la emisión y validez del certificado y la redirección HTTP a HTTPS.

## 9. Completar las evidencias y la revisión de Google

El comprobador actual devuelve `submissionReady=false`: faltan vídeo, las cuatro evidencias del expediente, revisión de seguridad/aprobación y comprobación pública. No se ha consultado una resolución de Google ni marcado ninguna evidencia por anticipado.

Archivo pendiente: **`.production/publication.json`**.

- [ ] Confirmar en Search Console que la propiedad **Dominio: `ebia.cloud`** está verificada con una cuenta vinculada al proyecto Google. El TXT ya está publicado: no repetir su creación. Después actualizar `evidence.domainOwnershipVerified`.
- [ ] Revisar marca y tratamiento de proveedores y actualizar `evidence.brandingReviewed` y `evidence.providerDataHandlingReviewed` con resultados reales.
- [ ] Con HTTPS válido, privacidad revisada y cuentas controladas, grabar la demostración real según [MAIL-068](<Resolucion Tareas Épica EPIC-10/MAIL-068-publicacion-google-oauth.md>), publicar el vídeo accesible al revisor y completar `demoVideoUrl`.
- [ ] Probar las instrucciones/acceso del revisor y completar `evidence.reviewerAccessTested`.
- [ ] Presentar la verificación de marca/scopes y atender las observaciones; completar `review.status`, referencia, scopes y fechas con las comunicaciones reales.
- [ ] Resolver la evaluación de seguridad/CASA o excepción aplicable y registrar referencia/vigencia en `review.securityAssessment`.

Los scopes del expediente son `https://www.googleapis.com/auth/gmail.readonly` y `https://www.googleapis.com/auth/gmail.compose`. Preparar Audience/testers durante la revisión no autoriza una apertura pública; el estado In production no equivale a aprobación.

Comprobación local, desde la raíz:

```powershell
npm run google:release:check -- --submission .production/publication.json --credentials .production/google-production.json --runtime-config .production/operator.json
```

Con páginas públicas válidas añade `--check-public-pages`; tras la aprobación efectiva añade también `--require-approval`. El resultado `remoteApprovalValidated=false` recuerda que este comando no certifica la resolución remota.

## 10. Validación funcional y apertura

- [ ] Probar aislamiento entre dos cuentas, consentimiento, conexión/reconexión Gmail y configuración del perfil.
- [ ] Probar documentos sintéticos, generación y borrador en el hilo/destinatario correctos, abstención sin evidencia y respeto de borradores manuales.
- [ ] Probar pausa, revocación, desconexión, exportación y borrado de una cuenta controlada.
- [ ] Comprobar alertas, recuperación de procesos y funcionamiento de los demás proyectos tras integrar Auto Email.
- [ ] Revisar arranque automático y planificar el ensayo de reinicio de la VPS en una ventana acordada; afecta a otros proyectos.
- [ ] Ejecutar el piloto autorizado de [MAIL-069](<Resolucion Tareas Épica EPIC-10/MAIL-069-preparacion-usuarios-piloto.md>) y [MAIL-070](<Resolucion Tareas Épica EPIC-10/MAIL-070-ejecucion-evaluacion-piloto.md>). La apertura comercial añade las condiciones, cobro/facturación y operación definidos en [MAIL-071](<Resolucion Tareas Épica EPIC-10/MAIL-071-primera-oferta-comercial.md>).

Las copias y restauración quedan aplazadas en el [TODO, punto 1](../TODO-PROXIMOS-PASOS.md); no presentarlas como realizadas ni como requisito completado. El modo aplazado permite avanzar en este despliegue, manteniendo visible que no hay recuperación integral verificada.
