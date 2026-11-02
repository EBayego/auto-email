# MAIL-068 — Preparación de la publicación de Google OAuth

Estado a 1 de noviembre de 2026: **dominio y contacto configurados en el repositorio; verificación externa y apertura pública pendientes**. El propietario ha creado el DNS de `auto-email.ebia.cloud`, comprobado hacia la VPS. Soporte y privacidad: `ebayego.ia@gmail.com`. No se ha enviado una solicitud, publicado el proyecto Google, desplegado en la VPS ni contratado una evaluación. El estado y los archivos privados actuales están en la [guía de despliegue](../DESPLIEGUE-VPS-EBIA.md).

## Qué está preparado

- Portada `/` y política `/privacy` accesibles sin sesión. La portada describe Gmail, los borradores, la comunicación con OpenAI y los controles del usuario. Muestra que el acceso está en pruebas y que la verificación está pendiente.
- La política existente explica acceso, tratamiento, proveedores, retención, derechos, borrado, límites de `gmail.compose` y Limited Use. Sigue bloqueada la concesión de permisos si faltan identidad del operador y revisión de privacidad. No se han inventado datos legales.
- Solo se solicitan `gmail.readonly` y `gmail.compose`, definidos en `src/config/google.ts`. La integración crea borradores; el envío automático no está implementado. `gmail.compose` **sí concede capacidad de envío en Google**: la limitación a borradores procede del código, no del alcance OAuth.
- Plantilla de expediente `google/publication.example.json`, justificaciones y guion de demostración incluidos abajo.
- Comando `npm run google:release:check`: contrasta expediente, configuración del servidor y JSON del cliente. Detecta cambios de permisos, callbacks locales en el cliente de producción, URLs inconsistentes, contactos incompletos y ausencia de evidencias. Opcionalmente consulta las dos páginas públicas sin cookies, credenciales ni seguimiento de redirecciones.
- Pruebas de los controles y regresión de las páginas públicas. No se requieren cambios de base de datos ni migraciones Supabase para esta tarea.

## Lo que tienes que hacer, en este orden

### 1. Elegir el destino y completar la privacidad

El destino es `https://auto-email.ebia.cloud`, con DNS ya creado. Las URLs de las plantillas y del expediente privado están preparadas. La VPS comparte otros proyectos: añade únicamente el sitio de esta app al Traefik existente.

Configura HTTPS y estas variables en la configuración privada del servicio:

```dotenv
APP_ENV=production
PROVIDER_MODE=live
APP_URL=https://auto-email.ebia.cloud
GOOGLE_REDIRECT_URI=https://auto-email.ebia.cloud/api/gmail/callback
```

El correo `PRIVACY_CONTACT_EMAIL=ebayego.ia@gmail.com` y el alojamiento Hostinger/París ya están preparados. Completa `PRIVACY_OPERATOR_NAME`, `PRIVACY_OPERATOR_ADDRESS` y `PRIVACY_PROCESSING_DISCLOSURE`. Esta última debe recoger el tratamiento efectivo, proveedores, regiones, transferencias, bases jurídicas, contratos y retención de proveedores/copias. Revisa los acuerdos con Google, OpenAI, Supabase y el alojamiento. Establece `PRIVACY_REVIEW_APPROVED=true` solo tras completar la revisión correspondiente. El texto técnico de la política no sustituye esa revisión.

La identidad y el domicilio siguen sin definir, tal como indicaste. Con los valores actuales no se puede cerrar la publicación.

### 2. Verificar el dominio con tu cuenta de Google

1. Entra en [Google Search Console](https://search.google.com/search-console) con una cuenta que tenga rol Owner o Editor en el proyecto `auto-email-511915`.
2. Añade una propiedad de tipo **Dominio**, `ebia.cloud`, o comprueba si ya eres propietario verificado de la existente.
3. Copia exactamente el TXT que Google proporcione y **añádelo** al DNS. Conserva los registros TXT, MX y demás entradas de tus otros proyectos. No hay un token fijo que se pueda preparar desde el repositorio.
4. Pulsa Verificar y conserva la verificación. Registra la evidencia en un archivo privado.
5. En Google Auth Platform, autoriza el dominio registrable correspondiente. No pongas una URL con `https://`, una ruta ni un comodín. El comprobador local comprueba la correspondencia del hostname; no consulta la titularidad de Search Console ni determina por sí solo los dominios registrables.

Fuente: [verificación de propiedad en Search Console](https://support.google.com/webmasters/answer/9008080). La propiedad DNS cubre los subdominios sin modificar la aplicación.

### 3. Completar Google Auth Platform

Selecciona siempre el proyecto [auto-email-511915](https://console.cloud.google.com/auth/overview?project=auto-email-511915).

| Pantalla                                                                                                  | Configuración que debes introducir o revisar                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=auto-email-511915) | API habilitada.                                                                                                                                                                                                                                                                                                                                                                         |
| [Branding](https://console.cloud.google.com/auth/branding?project=auto-email-511915)                      | Nombre `Auto Email`; correo de soporte `ebayego.ia@gmail.com`; contactos del desarrollador con ese mismo correo; dominio autorizado `ebia.cloud`, pendiente de verificar; portada `https://auto-email.ebia.cloud/`; privacidad `https://auto-email.ebia.cloud/privacy`. Las condiciones actuales están en esa misma página. Logo propio si lo aportas, sin insinuar respaldo de Google. |
| [Audience](https://console.cloud.google.com/auth/audience?project=auto-email-511915)                      | Audiencia External para clientes de distintas organizaciones. Mantén Testing y los testers explícitos mientras preparas la revisión. No uses Internal para eludir la verificación de un SaaS externo.                                                                                                                                                                                   |
| [Data Access](https://console.cloud.google.com/auth/scopes?project=auto-email-511915)                     | Declara exactamente los dos scopes de la tabla siguiente. No añadas `mail.google.com`, `gmail.modify`, `gmail.send`, Drive, Calendar ni permisos de inicio de sesión que no utiliza esta integración.                                                                                                                                                                                   |
| [Clients](https://console.cloud.google.com/auth/clients?project=auto-email-511915)                        | Cliente **Web application dedicado a producción**, con un único redirect URI: `https://auto-email.ebia.cloud/api/gmail/callback`. Este flujo de servidor no necesita Authorized JavaScript origins; pueden quedar vacíos.                                                                                                                                                               |

Descarga el JSON del cliente de producción y configura su `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en los secretos de web y worker. No publiques el JSON ni lo incluyas en imágenes. Conserva las claves de cifrado y el registro de supresiones existentes; no regeneres claves para cambiar de dominio. Un cambio de cliente OAuth puede exigir que las cuentas vuelvan a autorizar Gmail; no presupongas que un refresh token se puede trasladar a otro cliente.

El callback de Gmail es `/api/gmail/callback`. No lo confundas con el callback de la autenticación de Supabase. El acceso a Auto Email usa la cuenta de la aplicación; conectar Gmail es una autorización posterior independiente.

Revisa **todos los clientes** del proyecto: la revisión de Google puede abarcarlos. Retira clientes obsoletos únicamente después de comprobar sus dependencias; conserva y demuestra los que sigan utilizándose. El comprobador de este ticket contrasta el JSON del cliente elegido, no enumera los demás clientes remotos. Si más adelante se decide separar el proyecto Google de producción, habrá que revisar también `google/project.json` y las credenciales; no se ha creado otro proyecto ahora.

Fuentes: [requisitos de verificación](https://support.google.com/cloud/answer/13464321), [verificación de marca](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification).

### 4. Justificación de permisos para el formulario

Los dos permisos son **Restricted** según la [clasificación oficial de Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).

| Scope                                            | Uso en Auto Email                                                                                                                                                                                                                          | Por qué un permiso menor no basta                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://www.googleapis.com/auth/gmail.readonly` | Consultar identidad Gmail, mensajes e hilos, contexto y enviados autorizados para clasificar, preparar respuestas y personalizar el estilo de esa cuenta. También detectar respuestas y cambios para las funciones opcionales consentidas. | `gmail.metadata` no proporciona los cuerpos necesarios. Los permisos de add-on se limitan a la interacción dentro de un add-on; este producto tiene web y worker propios.                   |
| `https://www.googleapis.com/auth/gmail.compose`  | Consultar y gestionar los borradores necesarios, evitar duplicados y crear propuestas de respuesta en el hilo correcto para revisión en Gmail.                                                                                             | No existe un permiso de Gmail API limitado a crear borradores para este flujo de servidor. `gmail.send` no permite gestionarlos; `gmail.modify` amplía innecesariamente el acceso al buzón. |

Texto preparado en inglés para adaptar al formulario de Google después de comprobar que refleja la versión desplegada:

> Auto Email is a user-facing email productivity assistant. After connecting their own Gmail account and granting the in-app data-use authorization, users can request reply drafts based on the relevant thread, their account-specific writing preferences and documents they choose to upload. Users review and send messages in Gmail.
>
> gmail.readonly is required to read the message and thread context needed by these features. Metadata-only access cannot provide the message bodies. Optional analysis of sent messages and comparison of edits have separate in-app controls. We do not automatically download Gmail attachments.
>
> gmail.compose is required to inspect relevant drafts, prevent duplicate drafts and create reply drafts in Gmail. This scope technically permits sending; our integration does not implement sending. A send-only scope would not support draft management, and broader mailbox modification permissions are unnecessary.
>
> Relevant message excerpts and context are transferred to the OpenAI API for the disclosed account-specific classification and generation features with user authorization. Supabase stores encrypted OAuth credentials, configuration, derived profiles, operational references and user-uploaded documents. Retrieved email bodies are processed in memory; optional generated-text retention has a separate, time-limited authorization. Data is not used for advertising or general-purpose model training. Users can withdraw authorization, disconnect Gmail, export their data and delete their account.

No afirmes que OpenAI tiene retención cero por usar `store: false`, que nunca se almacenan datos derivados ni que OAuth impide el envío. Adjunta los acuerdos y el mapa de datos efectivo si Google los solicita. Revisa las restricciones sobre IA, transferencias y acceso humano de la [política de Google Workspace](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) y el [Limited Use](https://developers.google.com/terms/api-services-user-data-policy).

### 5. Grabar la demostración real

Usa una cuenta Gmail de prueba autorizada, mensajes sintéticos y la versión que vas a presentar. Configura el consentimiento de Google en **inglés**. No uses capturas de la interfaz simulada como evidencia de autorización real.

Guion:

1. Mostrar dominio HTTPS, portada, identidad de la aplicación y política pública sin iniciar sesión.
2. Acceder a la cuenta de Auto Email. Mostrar la información previa de Gmail/OpenAI y aceptar la autorización de la aplicación de forma explícita.
3. Pulsar conectar Gmail. Mostrar el flujo completo de Google, nombre de la aplicación, ambos permisos y client ID visible en la barra de direcciones cuando Google lo muestre. No grabar contraseñas, secretos, códigos ni tokens del callback.
4. Volver a Auto Email y mostrar la cuenta conectada. Si se usa análisis inicial de enviados, mostrar su permiso y selección de alcance. Mostrar también los controles separados antes de activar retención de texto o aprendizaje de saludos/despedidas.
5. Mostrar un mensaje sintético, su procesamiento y la propuesta de respuesta. Abrir Gmail y comprobar que existe **un borrador** en el hilo correcto. No enviar un mensaje como parte de una supuesta función automática.
6. Mostrar las preferencias y una fuente de conocimiento usada por la propuesta; explicar qué fragmentos se comunican a OpenAI y dónde se informa al usuario.
7. Mostrar pausa, retirada de autorización y desconexión. Comprobar con la cuenta de prueba que los nuevos trabajos dejan de acceder a Gmail. Mostrar dónde exportar/borrar los datos y dónde revocar acceso en Google.
8. Si quedan varios clientes OAuth activos en el proyecto, demostrar los flujos de cada uno o atender el alcance que indique el revisor.

Sube la grabación a YouTube como **Unlisted / Oculto**, accesible al revisor sin pedir permiso adicional. Copia su enlace `https://www.youtube.com/watch?v=...` en `demoVideoUrl`. Verifica el enlace desde una sesión sin autenticar. El comprobador valida su forma, no la visibilidad del vídeo ni lo que demuestra.

Prepara un acceso de revisión con datos sintéticos e instrucciones para repetir el flujo y con las restricciones de registro/confirmación resueltas. Comprueba el acceso antes de marcar `reviewerAccessTested`. No guardes la contraseña de revisión en el expediente, Git, el vídeo o tickets públicos; utiliza el canal privado que indique Google.

Fuente: [requisitos de la demostración](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

### 6. Rellenar el expediente privado y ejecutar la comprobación

Copia `google/publication.example.json` a un archivo privado fuera del repositorio, por ejemplo `/etc/auto-email-prod/publication.json`. Existe también una exclusión Git para `google/publication.local.json`; eso no convierte el checkout en un almacén de secretos. El expediente no contiene credenciales: guarda los JSON OAuth y del servidor por separado, con permisos restringidos.

Completa las URLs, el dominio, contactos y vídeo. Marca cada campo de `evidence` únicamente después de realizar esa comprobación. Mantén `review.status=not_submitted`, listas/fechas de aprobación vacías y evaluación `not_started` hasta que existan evidencias reales.

Desde el checkout de la versión que se presentará, con Node 24 y dependencias instaladas:

```bash
npm run google:release:check -- --submission /etc/auto-email-prod/publication.json --credentials /etc/auto-email-prod/google-production.json --runtime-config /etc/auto-email-prod/web.json
```

`web.json` es la configuración privada por servicio preparada en MAIL-067. También puede usarse un JSON propio con variables del servidor como claves y valores string. Si omites `--runtime-config`, se carga el entorno del proceso y los archivos de entorno de Next; una configuración local de desarrollo fallará deliberadamente la comprobación de producción.

Después de publicar el sitio HTTPS, añade la comprobación de páginas:

```bash
npm run google:release:check -- --submission /etc/auto-email-prod/publication.json --credentials /etc/auto-email-prod/google-production.json --runtime-config /etc/auto-email-prod/web.json --check-public-pages
```

- `submissionReady=true`: las comprobaciones ejecutadas y las declaraciones del expediente están completas para preparar el envío. **Sin** `--check-public-pages` todavía no se ha comprobado el sitio publicado.
- `pending`: códigos de configuración o evidencias que faltan, sin valores privados.
- `launchPending`: incluye además aprobación de Google, evaluación y comprobación pública cuando falten.
- `remoteApprovalValidated=false`: siempre. Este comando no autentica contra Google Cloud, no comprueba Gmail API habilitada, propiedad del dominio, visibilidad del vídeo, contenido de la resolución ni la autenticidad de las evidencias administrativas. Las comprobaciones de texto de las páginas son indicios técnicos; revisa también su contenido en el navegador.

Se devuelve código 1 si falta preparación; código 0 no publica nada. `--help` muestra las opciones sin leer credenciales ni hacer peticiones. No subas los archivos privados a CI para pasar esta comprobación.

### 7. Iniciar la revisión y atender a Google

Cuando estén completos los pasos anteriores:

1. Revisa el resumen en Google Auth Platform / Verification Center, marca, Data Access y todos los clientes del proyecto.
2. Sigue el asistente de Google para presentar la verificación de marca y de scopes restringidos. Si el asistente requiere cambiar Audience a producción para enviar la solicitud, hazlo en ese momento y mantén el acceso al producto limitado al grupo autorizado mientras no haya aprobación. El estado In production por sí solo **no significa verificación concedida**.
3. Adjunta justificación, vídeo y acceso/instrucciones de revisión. Declara el procesamiento en servidor y la transferencia a OpenAI de forma exacta.
4. Envía la solicitud. Registra la referencia privada y pasa `review.status` a `pending`.
5. Vigila los correos de soporte/desarrollador y el centro de verificación. Ante observaciones, usa `changes_requested`, registra cada requisito, cambio aplicado, prueba y respuesta. Corrige y vuelve a presentar por el canal de Google. No declares resuelta una observación por haber cambiado solo este JSON.

Fuente: [envío de una aplicación para verificación](https://support.google.com/cloud/answer/13461325).

### 8. Evaluación de seguridad y autorización final

El diseño actual accede a datos restringidos desde el backend y los comunica para procesamiento. Para un SaaS externo público hay que **prever la evaluación de seguridad exigida por Google**, salvo excepción confirmada para el caso concreto. No se ha contratado ni presupuestado una evaluación. Las pruebas de MAIL-062–067 no equivalen a esa evaluación independiente.

Cuando Google indique el alcance y momento, solicita presupuesto a un evaluador admitido, confirma alcance, requisitos, coste y renovación; contrata solo después de aprobar el presupuesto. Resuelve sus observaciones y conserva la carta de validación/aceptación que corresponda. Google utiliza CASA; el nivel lo asigna el proceso, no este proyecto. La [información vigente de Google sobre evaluaciones](https://support.google.com/cloud/answer/13465431) exige renovación anual e indica que su equipo comunica cuándo iniciarla.

En `review.securityAssessment`, usa `passed` con referencia y `validUntil` reales. Si Google confirma una excepción, usa `exempted_by_google` con referencia y fecha de revisión de la excepción, no una autoexención. Mantén estas evidencias en privado y programa su revisión antes del vencimiento. El comprobador rechaza evaluaciones caducadas y, para `passed`, vigencias superiores a un año desde la comprobación.

Después de recibir aprobación efectiva, registra `review.status=approved`, `caseReference`, `approvedScopes` y `approvalDate` exactos. Comprueba que la resolución cubre los dos scopes y los clientes que se utilizarán. Actualiza entonces el aviso de pruebas de la portada según el lanzamiento aprobado y ejecuta:

```bash
npm run google:release:check -- --submission /etc/auto-email-prod/publication.json --credentials /etc/auto-email-prod/google-production.json --runtime-config /etc/auto-email-prod/web.json --check-public-pages --require-approval
```

Esta opción exige evidencias locales completas; sigue sin certificar la resolución remota. Revisa además la política pública y las condiciones legales, el despliegue, la operativa y las pruebas reales de Gmail antes de abrir el registro público. Cambios de marca, permisos, clientes o tratamiento pueden requerir nueva revisión.

## Mientras siga en Testing

Añade explícitamente las cuentas piloto en Audience y comunica que están en pruebas. Con estos scopes, las autorizaciones de proyectos externos en Testing pueden caducar a los siete días; el estado de pruebas tampoco elimina las políticas de los administradores de Workspace. No uses la lista de testers para comercializar acceso público sin las autorizaciones correspondientes. Consulta las [excepciones de verificación](https://support.google.com/cloud/answer/13464323) para el caso concreto y las [causas de caducidad de tokens](https://developers.google.com/identity/protocols/oauth2).

## Cierre del ticket

Validación local realizada: formato, lint, tipos, cobertura unitaria y compilación correctos; 58 pruebas específicas de expediente/páginas y 20 pruebas end-to-end correctas, incluida la consulta real de disponibilidad a Supabase sin sesión. Las imágenes de aplicación y operaciones compilan. El contraste con el cliente existente y la plantilla incompleta devuelve los pendientes esperados sin revelar secretos. La comprobación remota de migraciones (`--linked --dry-run --skip-vault`) confirma que Supabase está al día. Estas pruebas usan datos sintéticos y no sustituyen la demostración con Google real.

Queda preparada la parte implementable en el repositorio. La aceptación externa de MAIL-068 permanece pendiente hasta que existan: dominio y sitio reales, identidad y revisión de privacidad, configuración remota comprobada, vídeo, solicitud enviada, observaciones resueltas, evaluación/excepción aplicable y autorización de Google. No se presenta la aplicación como verificada ni se considera completada la apertura pública.
