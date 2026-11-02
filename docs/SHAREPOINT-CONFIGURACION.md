# Conector SharePoint: configuración y operación

Actualizado: 2 de noviembre de 2026. La implementación mantiene un índice local de textos y referencias. Los originales se descargan temporalmente y se conservan en SharePoint. No se escriben ni se eliminan documentos en Microsoft.

## Preparar el entorno

1. Aplicar la migración `20261102120000_sharepoint_connectors.sql` por el procedimiento normal de despliegue antes de habilitar la función. Mientras siga desactivada se mantiene la compatibilidad del catálogo manual y la exportación con el esquema anterior. No utilizar resets o seeds contra el proyecto Supabase remoto compartido.
2. Registrar una aplicación web en Microsoft Entra ID y conservar su ID y secreto en el servidor. Para el piloto, permitir solo tenants indicados en `MICROSOFT_ALLOWED_TENANTS`. Con un solo tenant se usa directamente su autoridad y puede registrarse una aplicación de ese directorio. Si se autorizan varios tenants, registrar la aplicación para cuentas de varios directorios; la devolución sigue comprobando la lista permitida.
3. Registrar el callback de tipo **Web**, exactamente `${APP_URL}/api/connectors/microsoft/callback`. Para la dirección de producción prevista será `https://auto-email.ebia.cloud/api/connectors/microsoft/callback`; para desarrollo, la URL local de `APP_URL`.
4. Conceder permiso **delegado** de Microsoft Graph `Sites.Read.All` y los permisos de identidad/renovación solicitados en el flujo. No añadir permisos de escritura. El consentimiento o las políticas del tenant pueden requerir a su administrador.
5. Crear una clave independiente de 32 bytes aleatorios, codificada en base64, para `MICROSOFT_TOKEN_ENCRYPTION_KEY`. No reutilizar la clave de Gmail ni pegar secretos en el chat, el repositorio o variables públicas.
6. Completar las variables siguientes en la configuración privada de web y worker. Las plantillas y el reparto de secretos del despliegue ya incluyen estas variables.

```dotenv
SHAREPOINT_ENABLED=true
MICROSOFT_CLIENT_ID=<id de aplicación>
MICROSOFT_CLIENT_SECRET=<secreto de aplicación>
MICROSOFT_TOKEN_ENCRYPTION_KEY=<clave base64 de 32 bytes>
MICROSOFT_ALLOWED_TENANTS=<tenant UUID>[,<otro tenant UUID>]
MICROSOFT_GRAPH_SCOPE=Sites.Read.All
SHAREPOINT_OCR_ENDPOINT=
SHAREPOINT_OCR_KEY=
SHAREPOINT_OCR_DAILY_PAGE_BUDGET=500
```

`npm run env:check` y `npm run production:check` validan la configuración cuando se habilita el conector. No imprimen las claves. Antes de habilitarlo, actualizar la información de privacidad con el tratamiento de los documentos, el índice y los proveedores que se utilicen. La pantalla recoge la autorización para iniciar la conexión Microsoft.

Habilitar `SHAREPOINT_ENABLED` añade al aviso una sección específica de SharePoint y OCR, cambiando su huella de aceptación. Los usuarios deberán aceptar el aviso vigente; se aplican también las pausas/reconexiones del flujo de privacidad existente de Gmail. Con el conector desactivado se conserva la versión del aviso anterior a esta función. Web y worker deben usar la misma configuración y aviso.

Microsoft recomienda OAuth con PKCE y una biblioteca soportada; la implementación utiliza MSAL Node y persiste su caché cifrada por propietario, tenant e identidad. [OAuth de Microsoft](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [caché MSAL](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching).

El perfil `Sites.Selected` también puede configurarse para sitios concedidos explícitamente por el administrador. Requiere preparar la asignación de lectura al sitio y comprobar resolución de sitio, biblioteca y delta en el tenant concreto. No se amplían los permisos automáticamente. No se solicitan permisos Selected a nivel de carpeta ni se modifica su herencia. [Permisos Selected](https://learn.microsoft.com/en-us/graph/permissions-selected-overview).

La selección en Auto Email limita las carpetas que se incorporan; con `Sites.Read.All`, el consentimiento de Microsoft permite leer más sitios de los que se hayan seleccionado. Esa diferencia se explica en la pantalla de conexión. El piloto real del tenant, incluido el perfil Selected si se elige, queda pendiente hasta disponer de sus autorizaciones.

## Conectar y configurar una carpeta

En **Conocimiento → Carpetas de SharePoint**:

1. Autorizar la conexión y seleccionar la cuenta Microsoft.
2. Introducir la URL del **sitio**, por ejemplo `https://empresa.sharepoint.com/sites/Comercial`, abrir una biblioteca y navegar hasta la carpeta deseada. La biblioteca completa también puede seleccionarse como raíz.
3. Indicar nombre de fuente, inclusión de subcarpetas, frecuencia (15 minutos por defecto) y audiencia. Se recomienda limitarla al dominio o destinatario adecuado.
4. Revisar y activar el uso en respuestas. Por defecto, una fuente nueva se incorpora sin habilitar su uso en borradores. Este control es independiente de pausar la sincronización.
5. Configurar **Fuentes y reglas de consulta** con las intenciones, palabras, fuentes principales, de respaldo y excluidas correspondientes. Crear una fuente no crea automáticamente una regla general.

Se pueden conectar varias carpetas. Se rechazan raíces iguales, anidadas o solapadas dentro de la misma conexión. Para cambiar la carpeta raíz se retira el conector anterior y se crea otro. Las excepciones de audiencia por archivo se gestionan en «Ver archivos y errores» y solo pueden restringir la política de su carpeta. Cambiar la audiencia de la carpeta exige resolver cualquier excepción incompatible.

## Procesamiento y cobertura

| Formato | Comportamiento |
| --- | --- |
| PDF con texto, DOCX, TXT | Lectores aislados; PDF conserva páginas y DOCX su estructura de texto |
| XLSX | Hojas, cabeceras, filas, coordenadas y valores guardados; no ejecuta fórmulas; marca fórmulas sin valor disponible |
| CSV | Filas, cabeceras, separadores coma/punto y coma y campos entre comillas |
| PPTX | Texto de diapositivas, tablas y notas, con identificación de diapositiva |
| Markdown/HTML | Texto sin ejecutar scripts ni descargar recursos externos |
| PDF escaneado, PNG/JPEG/BMP/TIFF | OCR si se configura Azure Document Intelligence |
| Imágenes incrustadas en Office | OCR de formatos admitidos, identificado por nombre del recurso incrustado |
| Formatos antiguos, macros, archivos cifrados o corruptos, otros binarios | Omitidos o fallidos con causa visible; no se consideran información consultable |

El formato y el contenido se validan en procesos sin credenciales ni acceso de red. Los límites actuales son 5.000 documentos importados por propietario, 50 MB por archivo, 2 GB de tamaño total de originales representados en el índice activo, 1 millón de caracteres y 2.000 fragmentos por documento. Una exploración admite hasta 50.000 nodos de jerarquía por conector y 20 imágenes incrustadas por archivo. Las subidas manuales mantienen su cuota independiente de 10 documentos de 10 MB.

Los objetos fuera del ámbito solo conservan información mínima de jerarquía y seguimiento, sin texto ni sus metadatos descriptivos una vez reconciliados. No se siguen accesos directos a otros ámbitos. Una pasada terminada puede contener omisiones o errores: el panel muestra cada estado y el archivo afectado.

### OCR

Crear un recurso de Azure Document Intelligence y configurar un endpoint HTTPS de la forma `https://<recurso>.cognitiveservices.azure.com` y su clave. El contenido que necesite OCR se envía a ese recurso. La API utilizada es `2024-11-30` con `prebuilt-read`. [Documentación de Read](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/read?view=doc-intel-4.0.0).

Cada archivo admite hasta 100 páginas OCR; se detecta y rechaza un resultado que exceda ese límite. Con OCR configurado, también se procesan los PDF con texto para cubrir páginas mixtas. Para evitar costes no acotados se reserva presupuesto antes de enviar cada petición: una imagen reserva una página y un PDF reserva conservadoramente 101. Las reservas no se devuelven ante errores o resultados inciertos; `SHAREPOINT_OCR_DAILY_PAGE_BUDGET` controla el máximo diario por usuario en UTC. Al agotarse, el trabajo queda pendiente y reintenta con espera, sin enviar más contenido a Azure. Las cifras con confianza inferior a 0,9 o una confianza media insuficiente quedan pendientes de revisión del original. No se utilizan como evidencia automática.

Los documentos Office con contenido visual que no puede leerse no se presentan como completamente extraídos. Los gráficos, fórmulas sin valor guardado, formatos antiguos y elementos visuales sin texto pueden requerir revisión o conversión del original. No se ejecuta Office ni se recalculan libros.

## Worker, cambios y respuestas

`npm run worker:sync` ejecuta un ciclo independiente de SharePoint además del procesamiento de Gmail. `--once` incluye ambas tareas. Los trabajos de SharePoint tienen su propio presupuesto por ciclo y bloqueo temporal, que se renueva durante operaciones largas.

La exploración usa delta de la **biblioteca**, filtrando las raíces elegidas antes de descargar contenido. Las páginas se guardan junto con el cursor y los trabajos pendientes. Un cursor caducado provoca una reconciliación completa. Las bajas de una exploración completa solo se aplican al terminarla correctamente. [Delta de Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0).

Los cambios de eTag generan trabajo pendiente. Se comparan también los bytes mediante SHA-256: un cambio de metadatos con contenido idéntico conserva el índice sin repetir extracción u OCR. Las versiones nuevas se activan de forma transaccional. Los archivos pendientes, fallidos, retirados o sin acceso no se entregan al modelo aunque exista una versión anterior privada.

Antes de cada llamada lógica de generación/verificación que contenga información externa se revisan acceso, versión y pertenencia a la raíz; se repite la comprobación antes de crear el borrador. Una desconexión o un cambio de política durante la consulta se comprueba de nuevo en la base. Si la comprobación falla se bloquea esa evidencia; no se consulta otra ubicación fuera de las reglas para sustituirla. La ventana entre la última comprobación y una operación externa no puede eliminarse por completo.

La búsqueda utiliza el motor textual existente. Los localizadores incluyen página, sección, hoja/celda o diapositiva en el texto y los títulos del índice; los resultados ofrecen el enlace normal al original. No se han añadido embeddings: su necesidad debe evaluarse con las preguntas reales del piloto, como establece el plan. La información no se usa para entrenar un modelo.

## Errores, retirada y privacidad

- **Necesita reconexión:** volver a conectar la misma identidad Microsoft. Una identidad diferente crea una conexión diferente y no hereda los índices anteriores.
- **Acceso denegado / raíz no disponible:** comprobar la cuenta y sus permisos en Microsoft. No se responde desde una copia antigua.
- **Límites de Microsoft:** respetar `Retry-After`; la cola reintenta fallos transitorios sin repetir escrituras en SharePoint. [Throttling de Graph](https://learn.microsoft.com/en-us/graph/throttling).
- **Omitido o error de extracción:** revisar la causa del archivo; tras corregir el original o configurar OCR, utilizar «Sincronizar ahora y reintentar errores».
- **Pausar sincronización:** conserva el índice y permite su uso solo tras las comprobaciones actuales. Para impedir su uso, deshabilitar la fuente o su configuración de respuestas.
- **Retirar carpeta o cuenta:** desactiva sus fuentes y elimina texto, índice, cursor y credenciales correspondientes; los originales de Microsoft se conservan. Los borradores ya creados en Gmail se conservan para revisión del titular.

La exportación personal incluye conexiones y conectores sin secretos ni cursores, inventario permitido y uso OCR. Conserva el límite explícito del exportador existente de 25 MB. La retirada/baja de la cuenta cancela el trabajo y elimina conexiones y derivados mediante las mismas claves de propietario. La revocación del consentimiento de la aplicación en Microsoft se gestiona también desde el tenant; desconectar localmente no revoca todas las sesiones Microsoft del usuario.

La autorización de privacidad vigente se comprueba antes de cada acceso a Graph y de cada petición OCR. Retirarla desde Ajustes o cambiar el aviso aceptado vacía las credenciales Microsoft, pausa los conectores y cancela sus bloqueos de trabajo. Los derivados permanecen disponibles para exportación o retirada local, pero no se usan para nuevas respuestas; reactivar requiere aceptar el aviso vigente y volver a conectar Microsoft.

## Validación

Pruebas nuevas: OAuth con PKCE y nonce, límites de tenant/URL, descarga sin reenviar bearer, cambios de versión y permisos, referencias eliminadas, CSV/XLSX/PPTX/HTML, OCR y calidad, llamadas sucesivas al modelo y ejecución de la migración en PostgreSQL embebido con RLS/RPC reales. `tests/sharepoint-database.test.ts` utiliza las migraciones documentales reales y representa únicamente las fronteras SQL de auth/storage.

La suite de Supabase completa y E2E requiere Docker local. La prueba real con Microsoft requiere una aplicación Entra, consentimiento y carpeta de prueba; no está acreditada por los dobles ni por PostgreSQL embebido. Antes de habilitar producción: añadir, modificar, renombrar, mover, retirar permisos y borrar archivos de esa carpeta, verificar citas y bloqueos y medir latencia/cobertura/coste con el corpus real.

Comprobación de esta implementación, 2 de noviembre de 2026: `npm run check` completado (formato, lint, TypeScript, 2.318 pruebas en 160 suites con sus umbrales de cobertura y compilación de producción). Dentro de la suite hay 13 casos SQL de SharePoint ejecutados en PostgreSQL embebido, incluida la retirada de privacidad. `npm audit --omit=dev --audit-level=high` informa de cero vulnerabilidades de producción. Docker Desktop no pudo arrancar en este entorno, por lo que no se acredita la ejecución de la suite completa de Supabase ni del recorrido E2E contra ese servicio. Los comandos de verificación se ejecutaron sin conectar Microsoft ni modificar la base remota. SharePoint y OCR permanecen desactivados en la configuración local.
