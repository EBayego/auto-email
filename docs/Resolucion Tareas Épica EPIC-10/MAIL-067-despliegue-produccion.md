# MAIL-067 — Preparación del despliegue de producción

**Actualización operativa:** copias aplazadas con `BACKUP_MODE=deferred` en la configuración privada local. Este documento conserva las instrucciones completas para reactivar backups (`required`, valor por defecto); el helper permite aplazarlos explícitamente y el job programado omite la copia sin detener procesos. Sigue [la guía activa](../DESPLIEGUE-VPS-EBIA.md) para el despliegue actual y el [TODO](../../TODO-PROXIMOS-PASOS.md), cuyo primer punto es la recuperación pendiente. El ledger persistente y las claves siguen siendo necesarios.

Fecha: 1 de noviembre de 2026. DNS de `auto-email.ebia.cloud` creado y comprobado; contacto `ebayego.ia@gmail.com` configurado. La VPS se ha inspeccionado exclusivamente en lectura, sin despliegue. Los archivos privados y pendientes actuales están en la [guía específica](../DESPLIEGUE-VPS-EBIA.md); esta página conserva el procedimiento técnico y de recuperación.

## Qué se ha implementado

| Elemento           | Resultado                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imágenes           | `deploy/Dockerfile`: aplicación Next.js standalone y herramientas de operaciones. Bases fijadas por digest, Node 24, cliente PostgreSQL 17 y Restic.                                         |
| Procesos           | `deploy/compose.yaml`: web, worker y monitor separados, sin depender del ordenador de desarrollo.                                                                                            |
| Aislamiento        | UID/GID 10001, sistema de archivos raíz de solo lectura, temporales limitados, sin capabilities adicionales, logs con rotación y secretos por proceso.                                       |
| Proxy compartido   | Web escucha por defecto en `127.0.0.1:3087`. Hay ejemplos para el Caddy/Nginx existente y una red externa opcional para un proxy Docker. No se ocupan los puertos 80/443 de otros proyectos. |
| Salud y reinicios  | `/api/health/live`, `/api/health/ready`, latidos y watchdog. Docker reinicia procesos caídos; el watchdog termina un proceso cuyo latido deja de actualizarse.                               |
| Migraciones        | Servicio de operaciones que ejecuta `supabase db push` contra el proyecto conocido, con Vault y seed excluidos.                                                                              |
| Copias             | Base, objetos reales de documentos y registro cifrado de supresiones; manifiesto SHA-256; cifrado y almacenamiento externo con Restic. Verificación y exportación para recuperación.         |
| Despliegue         | `deploy/release.mjs`: bloqueo de operaciones, preflight, parada, backup, migraciones, arranque y espera de salud. Un fallo después de parar deja el servicio detenido para revisión.         |
| Rollback           | Vuelta a imágenes inmutables anteriores, con revisión explícita de compatibilidad del esquema. Conserva las referencias seleccionadas en la configuración.                                   |
| Copias programadas | `backup-job.mjs` y unidades systemd: paran solo los servicios propios que estaban activos, hacen/verifican la copia y arrancan esos mismos contenedores, incluso ante fallo del backup.      |
| CI y publicación   | CI de calidad y recuperación; workflow manual que publica exactamente las imágenes probadas de un SHA completo. No hay despliegue automático a la VPS.                                       |

El proyecto Supabase continúa siendo **uno solo para desarrollo, staging y producción**, por decisión del propietario: `zbcexekelujsqkkynsog`. La base Docker de las pruebas es independiente. Este ticket no añade esquema ni requiere migraciones nuevas.

## Qué queda por hacer por tu parte

Cuando decidamos activar producción, habrá que:

1. Ya comprobados dominio, puerto 3087, Ubuntu x86_64, Docker y Traefik/privnetproxy. No hay que volver a elegirlos.
2. Completar identidad y revisión de privacidad. Nombre/razón social, dirección y texto revisado siguen pendientes; contacto preparado: `ebayego.ia@gmail.com`.
3. Crear el cliente Google de producción y configurar URLs/SMTP en Supabase. OpenAI y precios ya tienen valor privado; falta comprobar facturación/acceso y generación real.
4. Preparar el receptor HTTPS de alertas; el bearer ya está generado en `.production/operator.json`.
5. Elegir almacenamiento externo de backups y conservar sus credenciales, contraseña de cifrado y claves de la aplicación en un lugar recuperable fuera de la VPS.
6. Publicar las imágenes revisadas, preparar directorios/secretos, probar el despliegue y habilitar HTTPS y las copias programadas.
7. Hacer las pruebas reales y el reinicio de la VPS indicados al final. La apertura pública requiere además completar MAIL-068.

Sigue primero la guía específica para completar los valores pendientes. Los comandos siguientes son instrucciones para ejecutar posteriormente; no se han aplicado en la VPS.

## 1. Preparar servidor e imágenes

Estas instrucciones usan una VPS Linux con systemd y Docker Engine/Compose. El workflow de GitHub usa `ubuntu-24.04` y produce imágenes **linux/amd64**. Comprueba `uname -m`: para una VPS ARM hay que construir y ejecutar la misma suite en un runner de esa arquitectura antes de publicar sus imágenes.

Comprueba Docker/Compose y que el puerto elegido esté libre:

```bash
docker version
docker compose version
uname -m
ss -ltn
```

No reinstales el proxy ni cambies globalmente la versión de Node que utilizan otros proyectos. Los helpers de despliegue necesitan Node 24 en el host; instala su distribución oficial correspondiente a la arquitectura bajo `/opt/auto-email-node`, verificando el checksum publicado por Node. El ejecutable esperado por systemd es `/opt/auto-email-node/bin/node`. Las aplicaciones ejecutan su propio Node dentro de las imágenes.

Revisa memoria y espacio con el administrador de la VPS: los límites de web/worker/monitor son 1 GiB, 1 GiB y 256 MiB, más margen para Docker, backups y tus demás proyectos. La zona de staging debe poder alojar la base y los documentos completos y, durante una comprobación, su copia restaurada. La compilación se hace en CI.

Revisa/guarda los cambios del repositorio en Git y sube el commit cuando corresponda. Configura el entorno GitHub `production-release` con los revisores y restricciones de ramas que quieras aplicar. Ejecuta **Preparar imágenes de producción** indicando el SHA de 40 caracteres. Primero puedes usar `publish=false`; para publicar, repítelo con `publish=true`.

El workflow ejecuta calidad, SQL, integración, navegador, auditoría y recuperación antes de publicar. Guarda el artefacto `production-release`, que contiene `production-release.json` con los digests. Comprueba que los paquetes de GHCR tienen la visibilidad y acceso privados previstos; el workflow no cambia sus permisos. Da a la VPS únicamente acceso de lectura a las imágenes privadas mediante una credencial adecuada de GHCR, introducida con `docker login --password-stdin` sin dejarla en el historial. No copies el token de CI al servidor.

Sitúa el checkout del **mismo commit revisado** en `/opt/auto-email`. No hace falta instalar las dependencias npm en la VPS para ejecutar los helpers `.mjs`: Docker contiene las dependencias de aplicación y operaciones.

## 2. Directorios y configuración privada

Ejecuta con los privilegios del administrador del servidor:

```bash
sudo install -d -m 0700 /etc/auto-email-prod
sudo install -d -m 0700 /srv/auto-email-prod
sudo install -d -m 0700 -o 10001 -g 10001 /srv/auto-email-prod/erasures
sudo install -d -m 0700 -o 10001 -g 10001 /srv/auto-email-prod/backup-staging
sudo cp /opt/auto-email/deploy/deployment.env.example /srv/auto-email-prod/deployment.env
sudo chmod 0600 /srv/auto-email-prod/deployment.env
```

Completa `deployment.env` con los digests exactos del artefacto:

```dotenv
COMPOSE_PROJECT_NAME=auto-email-prod
APP_IMAGE=ghcr.io/ebayego/auto-email-app@sha256:DIGEST_REAL_DE_APP
OPS_IMAGE=ghcr.io/ebayego/auto-email-ops@sha256:DIGEST_REAL_DE_OPS
WEB_BIND_PORT=3087
SECRETS_DIRECTORY=/etc/auto-email-prod
ERASURE_LEDGER_HOST_PATH=/srv/auto-email-prod/erasures
BACKUP_STAGING_HOST_PATH=/srv/auto-email-prod/backup-staging
```

Es un archivo de datos sin secretos. No lo ejecutes con `source`. Los helpers rechazan imágenes sin digest, variables desconocidas, rutas relativas y proyectos Compose ajenos al prefijo `auto-email-`. Si el proxy está en Docker, añade también `PROXY_NETWORK_NAME` según la sección del proxy.

Copia `deploy/operator.example.json` a un archivo privado fuera del checkout, por ejemplo `/root/auto-email-operator.json`, con permisos 0600. Completa sus valores. **No compartas el JSON completo** con web, worker o monitor: el comando siguiente lo separa por roles.

| Variables                                       | Qué debes completar                                                                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`, `GOOGLE_REDIRECT_URI`                | Origen HTTPS definitivo y ese mismo origen seguido de `/api/gmail/callback`.                                                                                                      |
| `SUPABASE_*`                                    | URL del proyecto compartido y claves correspondientes. Claves secretas solo en servidor.                                                                                          |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`      | Cliente web de producción y callback exacto; procedimiento en MAIL-068.                                                                                                           |
| `GMAIL_TOKEN_ENCRYPTION_KEY`                    | Clave existente si hay cuentas conectadas. No regenerarla para migrar de servidor.                                                                                                |
| `OPENAI_*`                                      | Clave, modelo, esfuerzo, límite y precios por millón reales para el modelo elegido. Los precios estándar iniciales ya están preparados; confirmar modalidad aplicable.            |
| `PRIVACY_*`                                     | Identidad, domicilio, correo, alojamiento, tratamiento real, regiones/transferencias, proveedores, plazos y revisión. `PRIVACY_REVIEW_APPROVED=true` únicamente tras completarla. |
| `ERASURE_LEDGER_*`                              | Directorio interno `/var/lib/auto-email/erasures` y clave de 32 bytes en base64. Conservar la existente si el registro ya existe.                                                 |
| `ALERT_WEBHOOK_*`                               | Destino HTTPS real, token opcional y timeout. Preflight bloquea la producción si no hay destino válido.                                                                           |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | Administración necesaria para migraciones; solo llega al contenedor de esa operación.                                                                                             |
| `PGSERVICE*`, `RESTIC_*`, `AWS_*`               | Acceso a base y almacenamiento de backups según la sección siguiente.                                                                                                             |

Las opciones de worker/observabilidad de `.env.production.example` pueden añadirse al JSON si necesitas ajustar los valores por defecto. Todos los valores del JSON de configuración deben ser strings. No copies archivos `.env.local`, credenciales OAuth o claves privadas al directorio de código ni al contexto de imagen.

Si es la **primera** instalación y no existe ninguna clave anterior, genera cada clave de cifrado de 32 bytes por separado en un terminal privado, por ejemplo con `openssl rand -base64 32`, e incorpórala al archivo protegido. Guarda claves y contraseña Restic en un gestor/depósito cifrado independiente. Una clave nueva no descifra datos anteriores.

Genera los seis archivos en un directorio nuevo y vacío:

```bash
sudo /opt/auto-email-node/bin/node /opt/auto-email/deploy/secrets.mjs --input /root/auto-email-operator.json --output /etc/auto-email-prod/generated
sudo install -m 0400 -o 10001 -g 10001 /etc/auto-email-prod/generated/web.json /etc/auto-email-prod/web.json
sudo install -m 0400 -o 10001 -g 10001 /etc/auto-email-prod/generated/worker.json /etc/auto-email-prod/worker.json
sudo install -m 0400 -o 10001 -g 10001 /etc/auto-email-prod/generated/monitor.json /etc/auto-email-prod/monitor.json
sudo install -m 0400 -o 10001 -g 10001 /etc/auto-email-prod/generated/preflight.json /etc/auto-email-prod/preflight.json
sudo install -m 0400 -o 10001 -g 10001 /etc/auto-email-prod/generated/migrate.json /etc/auto-email-prod/migrate.json
sudo install -m 0400 -o 10001 -g 10001 /etc/auto-email-prod/generated/backup.json /etc/auto-email-prod/backup.json
```

Compose monta archivos individuales como secretos. Con archivos locales, no se debe confiar en que las opciones `uid`/`mode` de Compose sustituyan a los permisos del host: por eso se fija propietario 10001 y modo 0400. El directorio padre permanece accesible solo al administrador. Para rotar, genera otra carpeta vacía, detén los servicios de Auto Email y sustituye sus archivos antes de recrearlos; no mezcles generaciones mientras sigan funcionando.

El registro de supresiones debe tener un único almacenamiento persistente compartido por web y worker. **No lo sustituyas por un registro vacío ni por uno antiguo durante un rollback o restauración**. Debe sobrevivir a la restauración de Supabase y conservarse fuera de la VPS con una frecuencia acorde a las solicitudes de borrado. Si se pierde su versión más reciente, mantén el bloqueo de recuperación hasta reconciliar las supresiones; un backup diario antiguo no demuestra que no haya borrados posteriores.

## 3. Preparar backups externos

Elige un repositorio Restic fuera de la VPS: S3 compatible con HTTPS, SFTP o REST con HTTPS. El ejemplo usa S3. Restringe la credencial al bucket/prefijo de Auto Email y configura en el JSON el endpoint, bucket/prefijo y región reales. El mecanismo de retención necesita listar, escribir y borrar sus propios objetos. Evita reglas de ciclo de vida que destruyan bloques todavía referenciados por Restic. No establezcas un bloqueo de objetos incompatible con su purga sin diseñar antes esa combinación.

Prepara estos archivos privados:

- `/etc/auto-email-prod/database.conf`, a partir de `deploy/database.conf.example`: host y usuario de **Session pooler** del proyecto que muestra Supabase Connect, puerto 5432, contraseña y `sslmode=verify-full`. También puede usarse la conexión directa si la red la permite, con el usuario/host exactos de Connect. No uses el pooler de transacciones para este procedimiento.
- `/etc/auto-email-prod/database-ca.crt`: certificado CA correcto del proyecto/proveedor para verificar la conexión. No desactives TLS para hacer pasar la copia remota.
- `/etc/auto-email-prod/backup-password`: contraseña fuerte y exclusiva del repositorio Restic, guardada también en el gestor externo.

Los tres deben ser legibles por UID 10001 y tener modo 0400. Se montan con esos nombres bajo `/run/secrets`. La contraseña PostgreSQL no se pasa por argumentos de proceso.

El dump incluye `public`, `private`, `worker_private`, `auth`, `storage` y `supabase_migrations`. Los documentos se descargan de Storage y se comprueban por tamaño y SHA-256; el catálogo de Storage por sí solo no contiene sus bytes. La copia incluye el registro de supresiones cifrado, pero no su clave ni las claves de proveedores. La contraseña Restic, las claves y las credenciales deben poder recuperarse por separado.

**Proyecto compartido:** durante copias coherentes, despliegues y recuperación no debe haber otros procesos de desarrollo/staging escribiendo en el mismo Supabase. Los helpers detienen únicamente sus tres servicios Compose. No pueden detener otros ordenadores: acuerda y verifica esa parada antes de la operación. Tampoco debe existir un segundo worker remoto con un registro de supresiones distinto.

Revisa además en Supabase los backups administrados/PITR que tenga tu plan y su retención real. No se ha contratado ni activado una ampliación de plan. Los [backups de base de Supabase](https://supabase.com/docs/guides/platform/backups) no sustituyen la copia de los archivos de Storage.

## 4. Preparar proxy, dominio y autenticación

El A de `auto-email.ebia.cloud` ya resuelve a `194.164.72.105`. No hay que crearlo de nuevo. Conserva los demás DNS y utiliza el archivo Traefik ya preparado `deploy/proxy.traefik.ebia.yaml` según la [guía específica](../DESPLIEGUE-VPS-EBIA.md); no instales otro proxy.

**Proxy en el host:** usa `deploy/proxy.caddy.example` como nuevo sitio de Caddy, o `deploy/proxy.nginx.example` dentro de un virtual host HTTPS de Nginx. Sustituye dominio/puerto. Valida la configuración y recarga el servicio mediante el procedimiento de tu instalación; no reemplaces la configuración global. El destino es `127.0.0.1:3087`.

**Proxy en Docker:** el loopback de ese contenedor no es el host. Identifica su red existente y añade al `deployment.env`:

```dotenv
PROXY_NETWORK_NAME=NOMBRE_REAL_DE_LA_RED_DEL_PROXY
```

Los helpers incluyen automáticamente `compose.proxy-network.yaml`, que conecta solo web a esa red externa. Usa como upstream `auto-email-prod-web:3000` si conservas ese nombre de proyecto. El worker y el monitor no se conectan a la red compartida del proxy. No crees otra instancia de proxy en 80/443. Comprueba que el alias no colisiona con un servicio existente.

Para operaciones manuales define esta función en Bash, desde una sesión administrativa. No carga el archivo como código:

```bash
dc() {
  docker compose --env-file /srv/auto-email-prod/deployment.env -f /opt/auto-email/deploy/compose.yaml "$@"
}
```

Si utilizas el proxy Docker, define en su lugar:

```bash
dc() {
  docker compose --env-file /srv/auto-email-prod/deployment.env -f /opt/auto-email/deploy/compose.yaml -f /opt/auto-email/deploy/compose.proxy-network.yaml "$@"
}
```

En Supabase Auth configura el Site URL definitivo, `https://auto-email.ebia.cloud/auth/callback`, confirmación de correo y SMTP propio para producción. Al compartir proyecto, cualquier cambio afecta también a desarrollo/staging: conserva únicamente los retornos que sigan siendo necesarios y evita comodines amplios. Revisa las opciones de seguridad del plan, incluida la protección de contraseñas filtradas, antes de abrir el registro. La revisión de puesta en marcha ha confirmado que todavía no está implementado el flujo de recuperación de contraseña: SMTP no añade esa pantalla/acción; debe implementarse y probarse antes de considerarlo disponible. Ver la [guía maestra](../PUESTA-EN-MARCHA-PRODUCCION.md).

Configura el cliente Google con el callback `/api/gmail/callback`; las instrucciones, verificación de dominio y limitaciones de Testing están en [MAIL-068](MAIL-068-publicacion-google-oauth.md). Supabase Auth y la conexión a Gmail tienen callbacks diferentes.

## 5. Inicializar y desplegar

Mantén el nuevo sitio en mantenimiento en el proxy hasta completar la validación. El helper no cambia el proxy compartido. Desde la sesión administrativa con acceso a Docker:

```bash
dc config --quiet
dc pull web worker monitor preflight ledger-init backup migrate
dc run --rm ledger-init
dc run --rm backup backup init
dc run --rm preflight
```

Inicializa Restic solo si es un repositorio nuevo; no repitas `init` sobre uno existente ni lo reemplaces para resolver un error. `ledger-init` verifica y conserva el registro ya inicializado si la clave corresponde.

Preflight valida configuración del servidor, proyecto Supabase conocido, revisión de privacidad, precios, alertas, modo de mantenimiento y registro persistente. No realiza una generación de pago ni acredita OAuth remoto. Resolverá como pendientes la identidad y el webhook mientras sigan sin definir.

Consulta el plan y, cuando se haya revisado, ejecuta el despliegue:

```bash
/opt/auto-email-node/bin/node /opt/auto-email/deploy/release.mjs --config /srv/auto-email-prod/deployment.env --action plan
/opt/auto-email-node/bin/node /opt/auto-email/deploy/release.mjs --config /srv/auto-email-prod/deployment.env --action deploy --confirmed
dc ps
curl --fail http://127.0.0.1:3087/api/health/live
curl --fail http://127.0.0.1:3087/api/health/ready
```

El despliegue exige backup previo, ejecuta migraciones sin seed/Vault, espera salud y guarda referencias en `/srv/auto-email-prod/releases/`. Las referencias de imágenes se conservan también en `deployment.env`. Si falla después de detener los servicios, corrige el motivo y repite el procedimiento; no abras el proxy por ver un contenedor arrancado.

`ready` requiere acceso a la base, su estado de monitorización y disponibilidad del registro de supresiones; devuelve únicamente `ok` o `unavailable`. Worker y monitor publican latidos de proceso. Un fallo remoto de Google/OpenAI se detecta con las alertas operativas, no enviando datos reales desde una sonda de salud.

Docker `restart: unless-stopped` recupera un proceso que termina. El watchdog supervisa el latido y termina el hijo bloqueado para que Docker reinicie el contenedor. Un `docker stop`/parada manual se respeta. Activa Docker al arranque de la VPS y comprueba posteriormente el reinicio real del host. Referencias: [reinicios Docker](https://docs.docker.com/engine/containers/start-containers-automatically/), [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## 6. Programar y vigilar las copias

Prueba primero una ejecución manual:

```bash
/opt/auto-email-node/bin/node /opt/auto-email/deploy/backup-job.mjs --config /srv/auto-email-prod/deployment.env
sudo install -m 0644 /opt/auto-email/deploy/systemd/auto-email-backup.service /etc/systemd/system/auto-email-backup.service
sudo install -m 0644 /opt/auto-email/deploy/systemd/auto-email-backup.timer /etc/systemd/system/auto-email-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now auto-email-backup.timer
sudo systemctl list-timers auto-email-backup.timer
sudo journalctl -u auto-email-backup.service --since today
```

La programación es diaria a las **03:15 UTC**, con hasta diez minutos de variación y recuperación de una ejecución omitida al volver a arrancar. Ajusta el horario si es necesario: no se interpreta como hora local de Madrid. La copia hace una parada breve planificada de los servicios de Auto Email que estaban activos. No enciende servicios que ya estaban detenidos y no recrea sus imágenes. Mantenimientos y copias comparten un bloqueo para no migrar simultáneamente.

Los backups se cifran con Restic, se retienen entre 1 y 30 días según configuración y se verifica una restauración a archivos temporales con hashes y lectura del catálogo PostgreSQL. La restauración completa a una base temporal se prueba en la suite de despliegue; no se ejecuta diariamente contra el proyecto real.

Con una copia diaria, el objetivo inicial de recuperación de datos es hasta 24 horas, condicionado al éxito de las copias y a conservar el registro de supresiones actualizado. Mide el tiempo real de recuperación con el volumen de producción; no hay un RTO garantizado por estas pruebas locales.

Configura tu monitorización externa para detectar fallos de `auto-email-backup.service`, copias antiguas, disco y falta de respuesta HTTPS. El fallo del job devuelve código distinto de cero y queda en journal; **no se entrega automáticamente al webhook de alertas de aplicación**. El monitor de MAIL-066 cubre la aplicación, el worker y proveedores. Prueba su destino HTTPS cuando lo elijas y revisa sus propias alertas de entrega.

Si el host cae durante una operación, revisa `/srv/auto-email-prod/.auto-email-operation.lock`: elimina un bloqueo huérfano solo después de confirmar que no hay copia, despliegue o recuperación en marcha. No borres locks del repositorio Restic a ciegas. Retira de staging cualquier exportación de recuperación en claro después del uso y conforme a la política de conservación.

## 7. Rollback de aplicación

Elige un registro de una versión que funcionaba y revisa que ese código sigue siendo compatible con el esquema actual. Las migraciones aplicadas permanecen. Con mantenimiento en el proxy:

```bash
/opt/auto-email-node/bin/node /opt/auto-email/deploy/release.mjs --config /srv/auto-email-prod/deployment.env --action rollback --release /srv/auto-email-prod/releases/REGISTRO_ANTERIOR.json --schema-compatible --confirmed
dc ps
curl --fail http://127.0.0.1:3087/api/health/ready
```

El helper arranca las imágenes anteriores y persiste sus digests. No vuelve a un esquema anterior ni sustituye el registro de supresiones. Si una migración es incompatible, mantén el servicio cerrado y prepara una corrección hacia delante o la recuperación de datos validada con el proveedor. Las claves y configuración deben seguir siendo compatibles con la versión elegida.

## 8. Recuperación de base y documentos

La recuperación afecta al **único Supabase compartido**. Detén y aísla todos sus consumidores antes de modificar datos, incluidos procesos de otros entornos. Preserva el registro de supresiones más reciente y sus claves fuera de la restauración.

1. Pon el proxy en mantenimiento, detén el timer y web/worker/monitor. Actualiza los JSON privados con `SECURITY_MAINTENANCE_MODE=true`, siguiendo la rotación por generaciones; conserva el resto de secretos.
2. Ejecuta contención. Si Supabase está caído, mantén el aislamiento externo y repite contención en cuanto se recupere el acceso.

```bash
sudo systemctl stop auto-email-backup.timer
dc stop --timeout 90 web worker monitor
dc run --rm security security-contain
```

3. Elige el snapshot identificado en el resultado del backup y verifica/extrae sus archivos. Si no conoces el ID del último snapshot, `dc run --rm backup backup verify` lo verifica y muestra su ID. La exportación exige un ID explícito, crea una carpeta nueva protegida y nunca se copia automáticamente sobre datos vivos:

```bash
dc run --rm backup backup verify ID_SNAPSHOT
dc run --rm backup backup export ID_SNAPSHOT
```

La salida indica `directory` dentro de `/var/lib/auto-email/backups/`; en el host corresponde al mismo sufijo bajo `/srv/auto-email-prod/backup-staging/`. Allí están `database.dump`, `manifest.json`, `storage/` y `ledger/`. La exportación queda en claro y con acceso restringido; no la adjuntes a incidencias ni la subas a Git.

4. Restaura la base mediante el procedimiento administrado compatible de Supabase, coordinado con el proveedor/administrador, y aplica las migraciones de la versión que recuperarás. El dump nativo incluye esquemas administrados, funciones y privilegios: la suite demuestra su restauración en una base local limpia y compatible, con extensiones y rol administrador disponibles. **No ejecutes `pg_restore --clean` indiscriminadamente sobre el proyecto gestionado activo**. Antes de usar ese archivo como recuperación remota, ensaya con el mismo motor, extensiones y roles y acuerda el procedimiento soportado. No se crean proyectos de pago automáticamente.
5. Después de recuperar la base, aplica migraciones, vuelve a contener, reaplica las supresiones y comprueba su resultado **antes de restaurar archivos de documentos**:

```bash
dc run --rm migrate
dc run --rm security security-contain
dc run --rm security security-restore
```

El servicio `security-restore` vuelve a borrar cuentas/datos que reaparezcan en un backup antiguo, utilizando el registro persistente actual. **No sustituyas ese registro por `ledger/` del snapshot** salvo recuperación reconciliada de su almacenamiento, preservando también todos los borrados posteriores. Si falta esa evidencia, no retires el bloqueo.

6. Restaura los objetos de documentos conservando bucket y clave `usuario/documento`, contrastando el manifiesto y los hashes. Recupera únicamente objetos que sigan perteneciendo a cuentas y documentos activos después de las supresiones. La copia del catálogo de Storage no restaura los bytes y los archivos de una cuenta borrada no deben volver a publicarse.

7. Revisa credenciales afectadas, permisos, recuentos, acceso de dos usuarios, documentos, supresiones y alertas. Ejecuta `security-release` solo después de esa revisión:

```bash
dc run --rm security security-release
```

8. Retira `SECURITY_MAINTENANCE_MODE` mediante una generación completa de secretos, ejecuta preflight y arranca los servicios con las imágenes/esquema comprobados. Gmail y automatización permanecen pausados por la contención; revisa y reactiva las cuentas expresamente. Comprueba HTTPS y salud, toma una nueva copia, reanuda el timer y abre el proxy. Limpia la exportación privada conforme a la política.

El helper de seguridad protege las supresiones, pero no restaura por sí mismo PostgreSQL ni contrata backups administrados. La contraseña Restic y las claves de cifrado son imprescindibles para una recuperación útil.

## Validación realizada y prueba final en tu VPS

La suite `npm run test:deployment` construye las imágenes, arranca procesos con datos sintéticos y Supabase local, verifica salud, acceso autenticado y el parser de documentos, provoca caídas de web/worker, comprueba su reinicio y crea/verifica/exporta una copia Restic. Restaura PostgreSQL en una base temporal distinta, comprueba datos y restricciones de acceso, contrasta los bytes de Storage y descifra el registro de supresiones restaurado. No resetea el proyecto remoto ni reinicia Docker globalmente. Su evidencia queda en `coverage/deployment-report.json` y en los artefactos de CI.

Resultado local de esta entrega: recuperación completa correcta (`passed=true`), 2.238 pruebas unitarias con cobertura, formato/lint/tipos/build correctos y cero vulnerabilidades en la auditoría de dependencias de producción. Las 41 pruebas específicas de despliegue, preflight y salud pasan tras los últimos ajustes. Se han validado los dos modos de configuración Compose. Supabase remoto está al día según `db push --linked --dry-run --skip-vault`; no se han añadido migraciones para MAIL-067.

En la VPS, antes de abrir el acceso, tendrás que comprobar:

- HTTPS y certificado del dominio definitivo, incluida renovación; portada y privacidad sin sesión.
- Registro/login y confirmaciones con SMTP real; aislamiento entre dos cuentas de prueba. La recuperación de contraseña requiere implementar el flujo pendiente y probarlo además.
- Autorización Gmail real, generación de un borrador y revisión en Gmail, sin envío automático.
- Carga, descarga y borrado de un documento; retirada de permisos y borrado de una cuenta de prueba.
- Entrega de alertas y detección de fallo del job de backups en tu monitorización externa.
- Copia/recuperación con el destino remoto, volumen real y claves custodiadas.
- Reinicio controlado de la VPS y recuperación de web, worker, monitor y timer. Comprueba también los demás proyectos del servidor.
- Rollback hacia una versión conocida con esquema compatible, todavía en mantenimiento.

La preparación del repositorio no acredita estas pruebas del servidor real. Su activación queda pendiente por decisión del propietario, junto con los datos legales, el destino de alertas y los servicios externos todavía sin configurar.
