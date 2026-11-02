# Puesta en marcha: configuración y pasos pendientes

**Actualización operativa:** las copias están aplazadas por decisión del operador con `BACKUP_MODE=deferred` en la configuración privada local. El despliegue omite la copia previa y el job programado no detiene procesos ni declara copias realizadas. Este documento conserva el procedimiento completo de backups para retomarlo. Para los pasos actuales, sigue [la guía activa](DESPLIEGUE-VPS-EBIA.md) y el primer punto del [TODO visible](../TODO-PROXIMOS-PASOS.md). Mantén el ledger vigente y sus claves; no se acredita recuperación integral hasta probar las copias.

Revisión: **1 de noviembre de 2026**. Esta es la lista de entrada para pasar del repositorio preparado a usuarios reales. Las tareas externas, la activación de la VPS, las pruebas reales y los pilotos no se han ejecutado por haber preparado sus tickets. La inspección posterior por SSH fue únicamente de lectura; no se han modificado la VPS, los DNS ni los proveedores.

**Para tu servidor `194.164.72.105` y dominio `ebia.cloud`, empieza por [la guía específica de la VPS](DESPLIEGUE-VPS-EBIA.md).** Incluye el estado comprobado, el DNS ya confirmado y la configuración exacta para el Traefik existente. Esta guía maestra conserva el detalle de cómo obtener los datos de cada proveedor.

## 1. Estado real y documentos de referencia

El repositorio tiene implementación y pruebas locales. **No está acreditado un lanzamiento al 100 %**: faltan datos del operador, configuración externa, despliegue, autorizaciones y evidencia con usuarios. Además, la revisión detecta un flujo de recuperación de contraseña que todavía hay que implementar, no solo configurar.

| Tema                                                   | Guía detallada                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| VPS, secretos, imágenes, proxy, backups y recuperación | [MAIL-067](<Resolucion Tareas Épica EPIC-10/MAIL-067-despliegue-produccion.md>)                                   |
| Google Cloud, dominio, permisos, vídeo y verificación  | [MAIL-068](<Resolucion Tareas Épica EPIC-10/MAIL-068-publicacion-google-oauth.md>)                                |
| Seleccionar e incorporar dos o tres profesionales      | [MAIL-069](<Resolucion Tareas Épica EPIC-10/MAIL-069-preparacion-usuarios-piloto.md>) y su ficha                  |
| Ejecutar y evaluar el piloto de 2–3 semanas            | [MAIL-070](<Resolucion Tareas Épica EPIC-10/MAIL-070-ejecucion-evaluacion-piloto.md>) y su registro/informe       |
| Oferta de 49 €, soporte y cobro                        | [MAIL-071](<Resolucion Tareas Épica EPIC-10/MAIL-071-primera-oferta-comercial.md>), costes y propuesta individual |

El chequeo ejecutado ahora en el **entorno local** devuelve:

```text
ready: false
ALERT_WEBHOOK_URL
APP_ENV
PRIVACY_CONFIGURATION_AND_REVIEW
```

Se comprobó solo presencia de variables, sin mostrar secretos. Gmail OAuth, OpenAI, claves Supabase y las dos claves de cifrado ya tienen valor local. Ya se han rellenado dominio, correo de soporte/privacidad, alojamiento y precios. Se ha preparado `.production/operator.json`, privado e ignorado por Git, copiando las claves locales existentes. Quedan identidad/domicilio/texto de privacidad, webhook, administración Supabase y destino de backup externo; el cliente Google de producción debe obtenerse y reemplazar los valores provisionales del cliente local. `SUPABASE_ACCESS_TOKEN` y `SUPABASE_DB_PASSWORD` no están en ese entorno; podrían existir en un gestor o autenticación CLI distinta. Esto **no es una inspección de las consolas remotas** ni acredita claves vigentes o configuración de la VPS.

## 2. Define el destino y guarda los datos en un solo sitio privado

El destino ya es `https://auto-email.ebia.cloud`, el soporte/privacidad es `ebayego.ia@gmail.com` y se ha comprobado el DNS hacia `194.164.72.105`. La VPS usa Ubuntu x86_64 y Traefik en `privnetproxy`, con el puerto loopback 3087 libre en la inspección.

La configuración privada de trabajo está preparada en `.production/operator.json`, con credenciales existentes copiadas y datos públicos completados. No crees otra copia desde cero ni conviertas `.env.local` a producción. Consulta [la guía específica](DESPLIEGUE-VPS-EBIA.md) para los valores pendientes, archivos exactos y traslado a `/root/auto-email-operator.json`. SMTP se configura en Supabase; los datos fiscales van al registro comercial privado.

Conserva los valores ya utilizados que correspondan al mismo servicio. **No regeneres las claves de cifrado ni vacíes el registro de supresiones para hacer el despliegue.** En particular, se necesita trasladar la versión actual completa del registro persistente, no solo su ruta o su clave.

## 3. Datos legales y privacidad

| Variable                        | De dónde sale                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRIVACY_OPERATOR_NAME`         | Nombre legal o razón social de quien presta el servicio, conforme a su situación real.                                                                                                 |
| `PRIVACY_OPERATOR_ADDRESS`      | Domicilio que corresponda declarar como operador; confirmar con la revisión legal/fiscal.                                                                                              |
| `PRIVACY_CONTACT_EMAIL`         | Ya configurado: `ebayego.ia@gmail.com`.                                                                                                                                                |
| `PRIVACY_HOSTING_PROVIDER`      | Empresa que aloja la VPS y localización/servicio aplicables, según contrato/panel.                                                                                                     |
| `PRIVACY_PROCESSING_DISCLOSURE` | Texto revisado sobre tratamiento, proveedores, bases jurídicas, regiones, transferencias, conservación, copias y derechos para tu uso real. No es una clave que entregue un proveedor. |
| `PRIVACY_REVIEW_APPROVED`       | Dejar `false` hasta completar y revisar lo anterior; después `true`. No es una aprobación administrativa obtenida automáticamente.                                                     |

Pasos:

1. Determina quién será el operador; los datos siguen sin definir según tu última respuesta.
2. Prueba recepción y respuesta desde `ebayego.ia@gmail.com`, ya configurado para soporte y privacidad. No hace falta crear un buzón en ebia.cloud para ello.
3. Revisa contratos/DPA de proveedores y condiciones del uso profesional. Supabase está configurado como proyecto en `eu-west-1`; eso no demuestra que todo el procesamiento de Google/OpenAI/VPS ocurra en esa región.
4. Completa el texto con los plazos y regiones efectivos, con la revisión jurídica que corresponda.
5. Configura las variables, despliega y comprueba `/privacy` sin sesión. Debe mostrar identidad/contacto reales y desaparecer el aviso de información incompleta.
6. Comprueba que el usuario acepta la información de la aplicación antes de conceder OAuth; el permiso técnico de Google no sustituye el resto de obligaciones.

No hay un trámite universal que convierta la aplicación en «certificada RGPD» al marcar una variable.

## 4. Supabase: claves, base, Auth y correo

Se mantiene el proyecto compartido `zbcexekelujsqkkynsog`; no necesitas crear otro para seguir esta preparación. Todos sus consumidores remotos comparten datos y configuración: coordina cambios y no ejecutes resets/seeds remotos.

### Credenciales y acceso PostgreSQL

1. Abre [el proyecto](https://supabase.com/dashboard/project/zbcexekelujsqkkynsog).
2. En **Connect** confirma URL y datos de conexión. `SUPABASE_URL` es `https://zbcexekelujsqkkynsog.supabase.co`.
3. En **Settings → API Keys**, localiza o crea las claves publishable y secret adecuadas. Copia `sb_publishable_…` a `SUPABASE_PUBLISHABLE_KEY` y `sb_secret_…` a `SUPABASE_SECRET_KEY`. El código valida esos formatos; no sustituyas estos valores por JWT antiguos anon/service_role. Referencia: [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
4. Para migraciones, crea un token personal en la sección **Access Tokens** de tu cuenta Supabase, guárdalo como `SUPABASE_ACCESS_TOKEN` y restringe su custodia. Es distinto de las dos claves del proyecto. No se entrega a web, worker o monitor.
5. Recupera la contraseña PostgreSQL del gestor donde se guardó al crear el proyecto. Connect muestra parámetros, no recupera por ti la contraseña perdida. Si hace falta resetearla en Database Settings, coordina antes la rotación con todos los consumidores del proyecto compartido. Su valor va a `SUPABASE_DB_PASSWORD` para las migraciones.
6. Para backups, en Connect selecciona **Session pooler** y copia host, puerto, usuario y base exactos a `database.conf`, a partir de `deploy/database.conf.example`. Normalmente el puerto de sesión es 5432; no uses el pooler de transacciones para este procedimiento. La conexión directa es otra opción si la red permite llegar a ella.
7. Descarga la CA desde la sección SSL de Database Settings y guárdala como `database-ca.crt`; configura `sslmode=verify-full` y `sslrootcert=/run/secrets/database-ca.crt` en ese archivo. Ver [conexiones y SSL](https://supabase.com/docs/guides/database/connecting-to-postgres#ssl).

Las claves secretas son de servidor y el acceso administrativo de migraciones se separa por rol. No las coloques en variables `NEXT_PUBLIC_*`.

### URLs y confirmaciones Auth

1. En **Authentication → URL Configuration**, configura Site URL como `https://auto-email.ebia.cloud`.
2. Autoriza el retorno exacto `https://auto-email.ebia.cloud/auth/callback`. Conserva los retornos de desarrollo que todavía necesites en este proyecto compartido, sin abrir comodines amplios. Referencia: [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
3. Comprueba Email/password y la confirmación de correo requerida. Revisa las plantillas y su URL de retorno para el flujo PKCE existente; no pegues una plantilla de otro flujo sin probarla.
4. Prueba alta con una dirección externa, recepción, confirmación en el mismo navegador e inicio/cierre de sesión.
5. Revisa Security Advisor, límites de Auth y protección de contraseñas filtradas según disponibilidad/plan; comprueba las advertencias actuales antes de abrir usuarios reales. La revisión anterior no activó automáticamente funciones del plan.

**Gmail se conecta mediante el OAuth propio de la aplicación. No necesitas activar el proveedor de login Google de Supabase para esa integración.** Sus callbacks son distintos.

### SMTP para los usuarios de la aplicación

1. Elige tu servicio SMTP existente u otro de correo transaccional.
2. Verifica el dominio de envío en ese servicio. Publica exactamente los registros DNS de verificación/SPF/DKIM/DMARC que indique; conserva la configuración válida de otros proyectos, no crees registros SPF contradictorios ni reemplaces el DNS completo.
3. Crea un remitente como `acceso@auto-email.ebia.cloud` o el buzón apropiado verificado. Obtén **host SMTP, puerto, usuario, contraseña/API key SMTP y remitente** en su panel.
4. En **Authentication → Email/SMTP Settings** de Supabase activa Custom SMTP e introduce esos datos. No son variables `SMTP_*` de este repositorio.
5. Revisa restricciones del proveedor y límites de envío de Supabase, y prueba con una cuenta que no sea del equipo del proyecto. El correo incorporado de Supabase no debe utilizarse como correo de producción: tiene restricciones de destinatarios y capacidad. Ver [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

**Pendiente técnico descubierto:** hay alta, login y callback de confirmación; no hay pantalla/acción de «Olvidé mi contraseña» ni actualización de contraseña por recuperación. Para completar ese servicio hay que implementar y probar solicitud, enlace/callback de recuperación y nueva contraseña, incluidos enlaces inválidos/caducados. SMTP o una plantilla de Supabase por sí solos no lo resuelven. Referencia: [autenticación con contraseña](https://supabase.com/docs/guides/auth/passwords). Esta revisión no ha añadido ese código.

## 5. OpenAI: proyecto API, modelo y precios

La plantilla utiliza `gpt-6-luna`, `OPENAI_REASONING_EFFORT=none` y `OPENAI_MAX_OUTPUT_TOKENS=2048`. Son valores iniciales, no evidencia de que el modelo/clave estén autorizados en tu cuenta o de que ese límite sirva para todos los casos.

1. Entra en [OpenAI Platform](https://platform.openai.com/) con la organización que pagará la API.
2. Selecciona un proyecto adecuado para Auto Email. En la configuración del proyecto revisa miembros, modelos y facturación; habilita el medio/saldo de API que corresponda.
3. En **API keys**, crea o recupera del gestor una credencial de servidor del proyecto y guárdala en `OPENAI_API_KEY`. No se introduce en el navegador ni se envía al usuario. Ver [OpenAI Docs: quickstart](https://developers.openai.com/api/docs/quickstart).
4. Comprueba acceso al modelo y su soporte para Responses, JSON Schema estricto y esfuerzo elegido. Mantén el modelo de la plantilla salvo que decidamos cambiarlo y probarlo; ver [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
5. `OPENAI_INPUT_USD_PER_MILLION=0.10` y `OPENAI_OUTPUT_USD_PER_MILLION=0.50` ya están preparados; confirma que esa tarifa es aplicable. A fecha de esta revisión, la tarifa estándar publicada de GPT-6 Luna indica **0.10 USD de entrada y 0.50 USD de salida por millón** para el tramo correspondiente. Reconfirma modalidad/contexto y posibles recargos antes de usar esos números. La aplicación registra una estimación con dos precios, no replica toda la facturación por tramos, caché o modalidades. Fuente: [precios oficiales](https://developers.openai.com/api/docs/pricing).
6. En **Project settings → Limits**, configura presupuesto/alertas y, si quieres interrupción de tráfico y tienes permiso, **Enforce a hard limit**. Una alerta de gasto solo avisa; el límite duro puede interrumpir producción y admitir un pequeño exceso mientras se propaga. Ver [Spend limits](https://developers.openai.com/api/docs/guides/spend-limits).
7. Revisa las condiciones/retención/regiones efectivas e incorpóralas a la información de privacidad. `store: false` no acredita retención cero; consulta [controles de datos](https://developers.openai.com/api/docs/guides/your-data).
8. Cuando el servicio esté preparado, prueba una generación pequeña con datos ficticios y confirma acceso, formato, consumo y ausencia de secretos en logs. Esa prueba puede consumir API; no se ha ejecutado ahora.

No hace falta modificar el modelo ni contratar otro producto para rellenar las variables de precio. La credencial API ya tiene valor local; su traslado/custodia o sustitución por una dedicada a producción debe ser deliberada.

## 6. Google OAuth y dominio

Sigue [MAIL-068](<Resolucion Tareas Épica EPIC-10/MAIL-068-publicacion-google-oauth.md>); este es el orden resumido:

1. Entra en [Google Auth Platform del proyecto `auto-email-511915`](https://console.cloud.google.com/auth/overview?project=auto-email-511915).
2. Confirma Gmail API habilitada. En Branding completa nombre `Auto Email`, soporte y contacto `ebayego.ia@gmail.com`, portada `https://auto-email.ebia.cloud/` y privacidad `https://auto-email.ebia.cloud/privacy`.
3. En [Search Console](https://search.google.com/search-console), verifica la propiedad del dominio con una cuenta Owner/Editor del proyecto Google. Añade al DNS el TXT exacto que te entregue Google; no hay un token que se pueda inventar en el repositorio. Conserva los otros registros y el token verificador. Ver [propiedad del dominio](https://support.google.com/webmasters/answer/9008080).
4. Declara el dominio autorizado y exactamente `gmail.readonly` y `gmail.compose`. No añadas permisos de Drive, calendario o envío adicionales.
5. En Clients, prepara un cliente **Web application de producción**, con redirect URI exacto `https://auto-email.ebia.cloud/api/gmail/callback`. Guarda client ID y secreto en `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; descarga su JSON privado.
6. El `GOOGLE_REDIRECT_URI` de aplicación debe coincidir con ese callback; `APP_URL` es el mismo origen. El callback `/auth/callback` de Supabase no se registra como callback de Gmail.
7. Para pruebas que cumplan el régimen de Google, configura Audience/Testing y los usuarios concretos; respeta también las políticas Workspace. No deduzcas una excepción comercial por tener pocos usuarios. Un cambio de cliente OAuth puede exigir reconexión: no asumas portabilidad de refresh tokens.
8. Para apertura pública, prepara el vídeo funcional real, justificaciones y acceso de revisión; rellena una copia privada de `google/publication.example.json` y presenta la verificación en Google. Completa evaluación de seguridad/excepción aplicable y observaciones. El formulario o estado In production no son una aprobación. Ver [scopes restringidos y evaluación](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
9. Registra resolución, scopes y vigencias reales. Solo después actualiza el aviso de pruebas de la landing para reflejar el lanzamiento aprobado. La demo ficticia de la landing no sustituye el vídeo que demuestra OAuth real.

Para contrastar el expediente y las páginas, usa el comando exacto de MAIL-068 con `--submission`, `--credentials`, `--runtime-config`, `--check-public-pages` y, al final, `--require-approval`. Esa comprobación declara `remoteApprovalValidated=false`: no consulta ni certifica la resolución de Google.

## 7. Alertas: URL y recepción efectiva

No existe aún un destino elegido. El monitor envía un POST HTTPS con JSON propio y puede añadir `Authorization: Bearer TOKEN`. No es seguro que un webhook de Slack/Teams/otro servicio acepte directamente este formato.

1. Elige un receptor de alertas que acepte ese JSON o prepara un adaptador hacia tu correo/chat/sistema de guardia. También puede ser un endpoint de tu infraestructura, pero debe poder avisarte de la caída de la aplicación.
2. Crea el endpoint/integración y obtén su URL HTTPS. Si usa bearer, genera/obtén su credencial en ese receptor. Configura `ALERT_WEBHOOK_URL` y `ALERT_WEBHOOK_BEARER_TOKEN` cuando corresponda. Una URL con token incrustado también es un secreto.
3. Asegura que responde 2xx sin redirección, valida la autenticación y deduplica por `eventId`.
4. Adapta campos a tu destino. Ejemplo de estructura, con datos ficticios:

```json
{
  "version": 1,
  "eventId": "ID_ALERTA:FECHA_APERTURA",
  "alertId": "UUID_ALERTA",
  "kind": "WORKER_STALLED",
  "stage": "WORKER",
  "severity": "critical",
  "affectedCount": 1,
  "executionId": null,
  "openedAt": "FECHA_ISO"
}
```

5. En un ensayo controlado verifica entrega y recepción humana, y qué pasa cuando falla el receptor; no basta que la variable sea válida. Nunca incluyas cuerpos Gmail en las alertas.
6. Configura monitorización externa de HTTPS/host y fallos de `auto-email-backup.service`. Esos fallos del job quedan en journal; no se remiten automáticamente al webhook de aplicación.

Los `OBSERVABILITY_*` y timeout tienen valores por defecto. No necesitas inventar números nuevos para arrancar; revisa su adecuación durante las pruebas reales.

## 8. Backups y claves recuperables

### Almacenamiento externo

La ruta más preparada es S3 compatible con HTTPS:

1. Elige proveedor/almacenamiento separado de la VPS y crea un bucket o prefijo propio para Auto Email.
2. En su panel crea una credencial restringida a ese destino con los permisos necesarios para backup/lectura/purga de Restic. Obtén **endpoint HTTPS, bucket, prefijo, access key, secret key y región**. En un proveedor S3 compatible la región la indica su documentación; no supongas que es la región Supabase.
3. Configura `RESTIC_REPOSITORY=s3:https://HOST_REAL/BUCKET_REAL/auto-email-prod`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y `AWS_DEFAULT_REGION`.
4. Genera una contraseña fuerte del repositorio y guárdala en `/etc/auto-email-prod/backup-password`; en el JSON la ruta interna es `RESTIC_PASSWORD_FILE=/run/secrets/backup-password`. Conserva copia en un gestor externo.
5. Configura `BACKUP_DIRECTORY=/var/lib/auto-email/backups`, `BACKUP_RETENTION_DAYS=30`, `PGSERVICEFILE=/run/secrets/database.conf` y `PGSERVICE=auto_email_backup`.
6. Prepara `database.conf` y la CA del paso Supabase. Revisa permisos 0400/UID 10001 para esos archivos montados.
7. Inicializa el repositorio solo si es nuevo y comprueba creación, verificación y restauración con los comandos de MAIL-067. Las exportaciones de recuperación quedan en claro y se custodian/limpian.

Restic también soporta otros backends, pero SFTP/REST requieren su propia preparación de credenciales/montajes; no basta cambiar el prefijo en un despliegue que solo monta los archivos S3 actuales. Ver [repositorios Restic](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html).

### Cifrado y supresiones

- `GMAIL_TOKEN_ENCRYPTION_KEY`: ya existe localmente. Es necesaria para descifrar las credenciales Gmail guardadas. Conservarla al migrar o planificar una rotación con migración/reconexión, no reemplazarla al azar.
- `ERASURE_LEDGER_ENCRYPTION_KEY`: ya existe localmente y corresponde al registro actual de supresiones. Conservar clave y directorio completo, incluidos `.ledger` y archivos `.erasure`.
- `ERASURE_LEDGER_DIRECTORY`: dentro del contenedor será `/var/lib/auto-email/erasures`, respaldado por `ERASURE_LEDGER_HOST_PATH=/srv/auto-email-prod/erasures` en la VPS.
- Solo para una instalación nueva sin datos cifrados ni claves anteriores, cada clave nueva sería un valor aleatorio independiente de 32 bytes en base64. El caso actual no justifica regenerarlas.

Guarda claves y contraseña Restic fuera de la única VPS y fuera del backup al que dan acceso. La copia diaria antigua del ledger no basta para acreditar que se preservaron supresiones posteriores. Asegura una protección independiente del registro actualizado y ensaya su recuperación. La copia de PostgreSQL no incluye por sí sola los bytes de Storage; el procedimiento de MAIL-067 los copia aparte.

## 9. Imágenes, directorios, proxy y despliegue

Consulta los comandos completos y permisos en MAIL-067:

1. Comprueba Linux, Docker/Compose, arquitectura y espacio de la VPS. Las imágenes del workflow actual se prueban en linux/amd64; una VPS ARM necesita build/pruebas apropiados. No actualices globalmente Node de otros proyectos: los helpers usan `/opt/auto-email-node/bin/node` de Node 24.
2. Revisa y guarda/sube los cambios a Git cuando se vaya a publicar. Hay trabajo local sin publicar; un SHA antiguo no incluye estas tareas.
3. En GitHub configura `production-release` y ejecuta **Preparar imágenes de producción** con SHA completo, primero sin publicación si procede y después `publish=true`. Guarda el artefacto y sus referencias por digest.
4. Para descargar paquetes privados desde la VPS, obtén una credencial de GitHub con acceso de lectura a los paquetes: la documentación actual de GHCR utiliza PAT classic con `read:packages` para ese acceso fuera de Actions. Respeta las políticas/SSO que correspondan. Úsala con `docker login --password-stdin` sin incluirla en código, historial o JSON de aplicación. El workflow usa su propio `GITHUB_TOKEN`. Ver [GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
5. Copia el mismo checkout a `/opt/auto-email` y prepara `/etc/auto-email-prod` y `/srv/auto-email-prod` conforme a MAIL-067.
6. Rellena `deployment.env` desde `deploy/deployment.env.example`: `APP_IMAGE` y `OPS_IMAGE` con los digests reales; proyecto, puerto y rutas. Si el proxy existente está en Docker, añade su `PROXY_NETWORK_NAME`; los helpers incluyen el override preparado.
7. Completa el JSON privado y separa secretos con `deploy/secrets.mjs` en una carpeta nueva vacía. Instala los seis JSON por rol con propietario 10001 y modo 0400, y archivos auxiliares de backup. No montes el JSON completo del operador en todos los procesos.
8. Migra/preserva el registro de supresiones vigente antes de `ledger-init`. Inicializa Restic solo si es nuevo. Ejecuta **preflight** y resuelve todos los pendientes.
9. El registro A ya está creado y resuelve a la VPS. Añade el sitio al proxy existente, configura HTTPS y el upstream: `127.0.0.1:3087` con proxy en host o `auto-email-prod-web:3000` sobre la red externa elegida con proxy Docker.
10. Mantén el nuevo sitio en mantenimiento mientras despliegas. Ejecuta `deploy/release.mjs --action plan` y, revisado, `--action deploy --confirmed` con el archivo de configuración. El helper hace backup antes de migrar, no carga seed y espera salud.
11. Comprueba web, worker y monitor. Habilita Docker al arranque y el timer de backups de la guía. No reinicies el daemon de Docker compartido sin acordar su efecto en los demás proyectos.

Para las operaciones siguientes define `dc` según tu proxy, exactamente como explica MAIL-067. En una instalación con proxy en host sería:

```bash
dc() {
  docker compose --env-file /srv/auto-email-prod/deployment.env -f /opt/auto-email/deploy/compose.yaml "$@"
}
dc ps
dc run --rm preflight
curl --fail http://127.0.0.1:3087/api/health/live
curl --fail http://127.0.0.1:3087/api/health/ready
```

Si tienes proxy Docker, incluye también `-f /opt/auto-email/deploy/compose.proxy-network.yaml` en la función. No expongas directamente 3087 a Internet ni reemplaces los virtual hosts de otros proyectos.

No ejecutes `npm run production:check` en tu checkout de desarrollo esperando certificar la VPS: allí lee el entorno local. En el despliegue, `dc run --rm preflight` carga el JSON y montajes adecuados. Un resultado correcto no comprueba OAuth remoto, envío SMTP, recepción de alertas o restauración externa; esas pruebas siguen siendo necesarias.

## 10. Lo que aún es código u operación manual, no variables

| Elemento                                 | Estado y decisión necesaria                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recuperación de contraseña               | Falta el flujo de solicitud/retorno/nueva contraseña y sus pruebas. Resolver antes de declarar completo un servicio público de cuentas.                                                                                                                |
| Admisión de un piloto cerrado            | No hay lista interna de invitados implementada. Los testers OAuth limitan Google, no todo el registro web. Si se requiere admisión cerrada, preparar y probar el control de acceso/registro correspondiente; no limitarse a ocultar el enlace de alta. |
| Lista positiva de remitentes             | No existe en Ajustes. Si es requisito del usuario, implementar/verificarla o acotar la prueba a una cuenta apropiada.                                                                                                                                  |
| Cuotas comerciales, caducidad y pagos    | No hay suscripciones, bloqueo inmutable por plan, caducidad de 30 días o activación por pago. La oferta inicial es de operación/cobro manuales. Si quieres automatizarlos, es trabajo adicional.                                                       |
| Replay histórico integral con documentos | La herramienta retrospectiva de estilo no reproduce todo el worker con todas las fuentes de una fecha pasada. No declarar validadas áreas no probadas; seguir las limitaciones de MAIL-070.                                                            |
| Alertas de backup/host                   | El webhook de aplicación no monitoriza por sí solo que la VPS esté caída ni el fallo de systemd. Preparar monitor externo.                                                                                                                             |
| Restauración gestionada real             | Se ha ensayado localmente. Hay que probar el destino remoto/volumen/roles/procedimiento compatible; no restaurar a ciegas el dump sobre el proyecto gestionado vivo.                                                                                   |

Estos límites no deben convertirse en promesas comerciales por cambiar el texto de la landing. No se han implementado como parte de esta revisión de configuración.

## 11. Pruebas que completan la puesta en marcha

Antes de usuarios externos:

- Alta con correo externo → confirmación real → login/logout → sesión caducada; recuperación de contraseña cuando se implemente.
- Dos cuentas distintas sin acceso cruzado a perfil, documentos, actividad o exportaciones.
- Consentimiento de privacidad, OAuth real en el régimen autorizado, conexión y reconexión Gmail.
- Análisis de estilo con muestra autorizada, confirmación del perfil y carga/indexación/reglas de documentos.
- Borrador ficticio en el hilo y destinatario correctos, sin envío automático; abstención cuando falta evidencia y respeto a borradores manuales.
- Pausa, retirada de permiso, desconexión, exportación y borrado completo de una cuenta de prueba.
- Caída/reinicio de procesos y reinicio de la VPS, preservando también el resto de proyectos del servidor.
- Entrega real de alertas y fallo controlado del canal receptor; detección externa de indisponibilidad y backup fallido.
- Backup externo, verificación y recuperación con claves custodiadas; prueba de rollback compatible.
- Revisión de seguridad y costes del entorno realmente desplegado. No sustituirla por el resultado de los tests sintéticos.

Después, incorpora dos o tres profesionales según MAIL-069 y evalúa durante 2–3 semanas según MAIL-070. La información de evaluación se guarda en privado y la automatización empieza limitada. Al concluir, documenta si ampliar, corregir o detener.

Para cobrar, completa además MAIL-071: datos fiscales, impuestos/total, condiciones, medio de pago, factura/conciliación, soporte y costes reales. El precio elegido es 49 €/cuenta/30 días más impuestos aplicables, sin renovación automática. El registro y cobro inicial son manuales; no se han creado pagos ni enlaces en este trabajo.

## 12. Qué puedes recopilar ya

Sin publicar secretos aquí, prepara este paquete de información:

1. Ya resueltos: dominio `auto-email.ebia.cloud`, VPS Hostinger x86_64, Traefik/Docker en `privnetproxy`. No es necesario volver a elegirlos.
2. Faltan identidad del operador, domicilio y revisión del tratamiento; contacto ya configurado: `ebayego.ia@gmail.com`.
3. Acceso a los paneles Supabase, Google Cloud, DNS, OpenAI y repositorio GitHub.
4. Credenciales existentes localizadas en tu gestor; decisión de cuáles serán dedicadas a producción y claves de cifrado/ledger preservados.
5. Servicio SMTP, credenciales y dominio remitente verificado.
6. Endpoint receptor de alertas compatible y canal/horario de soporte.
7. Proveedor de backup externo, bucket/prefijo y credenciales; contraseña Restic ya generada en `.production/backup-password`, pendiente de custodiar fuera.
8. Usuarios piloto candidatos y disponibilidad; no pedirles datos del buzón antes de cerrar los requisitos.
9. Herramienta fiscal/cobro y datos reales de costes, cuando se vaya a comercializar.

Orden recomendado: **datos/pendientes técnicos → secretos y proveedores → despliegue y pruebas → piloto autorizado → verificación/apertura pública → cobro**. La preparación de Google y del dominio puede avanzar en paralelo; la autorización aplicable debe existir antes del tipo de acceso que se habilite. No se ha aplicado ninguna migración ni cambio remoto en esta revisión.
