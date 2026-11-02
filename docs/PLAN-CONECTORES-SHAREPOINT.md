# Plan de implementación de conectores a carpetas de SharePoint

Fecha: **2 de noviembre de 2026**. Estado: **plan propuesto; implementación pendiente**.

## 1. Resultado esperado y punto de partida

El usuario conectará su cuenta de Microsoft 365, elegirá una o varias carpetas de SharePoint Online y podrá usar su contenido y el de sus subcarpetas como fuentes para responder correos. La app incorporará altas y cambios, retirará documentos eliminados o sin acceso y mostrará qué información está disponible y cuál falta por procesar.

Se reutilizará **Conocimiento → Fuentes y reglas de consulta**. Ya permite seleccionar fuentes por intención y palabras o frases, con prioridades, fuentes principales, de respaldo y excluidas. Actualmente esas fuentes agrupan documentos subidos manualmente; el router no navega por SharePoint ni interpreta instrucciones libres para concederse acceso.

Ejemplo del resultado:

| Necesidad del correo | Fuente principal | Fuente de respaldo | Restricción |
| --- | --- | --- | --- |
| Tarifas y precios | SharePoint / Comercial / Tarifas | Catálogo autorizado | Excluir tarifas históricas |
| Condiciones de servicio | SharePoint / Legal / Condiciones | Documentos generales autorizados | Solo documentos vigentes |
| Información de un cliente | Fuente SharePoint de ese cliente | Ninguna | Audiencia limitada a sus destinatarios o dominio |

Referencias de la implementación actual:

- `src/app/app/knowledge-sources-panel.tsx`: interfaz de fuentes y reglas.
- `src/modules/source-router/sources.ts` y `route-sources.ts`: contratos y selección de fuentes.
- `src/db/knowledge-documents.ts` y `src/modules/knowledge/`: documentos, extracción, fragmentación y recuperación.
- `src/modules/response/knowledge-context.ts` y `src/worker/runtime.ts`: conexión con la generación de respuestas.
- `src/modules/knowledge/audience.ts`: límites por destinatario o dominio.

La cuota actual de 10 documentos y 10 MB por archivo está presente en interfaz, TypeScript, SQL y Storage. Se debe adaptar de forma coherente, junto con los límites de texto y fragmentos; cambiar solo el formulario no habilitaría carpetas reales.

## 2. Alcance y significado de «toda la información»

El alcance inicial será SharePoint Online de Microsoft 365 y sus bibliotecas de documentos. Se incluirán todos los archivos accesibles bajo las carpetas seleccionadas, con subcarpetas por defecto. No se ampliará automáticamente a otros sitios, enlaces externos ni carpetas compartidas de otro origen.

La integración será de lectura. La app mantendrá un índice local del contenido permitido y enviará al modelo únicamente los fragmentos necesarios para cada correo. No se cargará la carpeta completa en cada petición ni se entrenará un modelo con ella.

La cobertura se entregará en dos hitos:

| Hito | Contenido |
| --- | --- |
| A: conector funcional | PDF con texto, DOCX y TXT, reutilizando y adaptando los lectores actuales |
| B: cobertura documental ampliada | XLSX, CSV, PPTX, Markdown/HTML y OCR de imágenes y PDF escaneados; texto de imágenes incrustadas cuando corresponda |

El hito A no acredita que se pueda leer toda una carpeta que contenga Excel o escaneos. El hito B forma parte de este plan. En Excel se conservarán hoja, cabeceras, filas, unidades y valores disponibles; las fórmulas no se ejecutarán. Se señalarán valores calculados ausentes o potencialmente desactualizados. En PowerPoint se conservarán diapositivas, tablas y notas; el contenido visual tendrá cobertura explícita. El OCR conservará procedencia y calidad y exigirá revisión cuando el dato sea dudoso.

Los formatos antiguos DOC/XLS/PPT requieren un conversor aislado y pruebas propias si aparecen en el inventario del piloto. Archivos cifrados, protegidos, corruptos, paquetes, audio/vídeo y contenido visual no extraíble tendrán un estado y una causa visibles. No se declarará cobertura completa si existen pendientes, omisiones o errores. Páginas de SharePoint, listas estructuradas, OneNote y SharePoint Server local requerirán adaptadores adicionales si se incorporan al alcance.

## 3. Autenticación y selección del ámbito

La conexión Microsoft será independiente del inicio de sesión de Auto Email y del OAuth de Gmail. Se empleará OAuth de servidor con PKCE mediante MSAL Node. Microsoft documenta ese flujo y recomienda sus bibliotecas de autenticación. [Flujo oficial](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

Propuesta para el primer conector:

- Acceso **delegado**, asociado al usuario de Auto Email y a su identidad Microsoft: la app no accederá a recursos que esa identidad no pueda leer.
- Perfil inicial `Sites.Read.All` delegado para resolver sitios y navegar por sus bibliotecas; permisos de identidad y renovación necesarios para la sesión Microsoft. No solicitar permisos de escritura ni añadir scopes equivalentes sin necesidad. La resolución de un sitio por su URL utiliza `Sites.Read.All`. [Permisos de resolución de sitio](https://learn.microsoft.com/en-us/graph/api/site-getbypath?view=graph-rest-1.0).
- El permiso anterior es más amplio que una carpeta: la selección limita la ingestión y el uso dentro de la app, no el consentimiento de Microsoft. Se explicará esta diferencia al conectar. Las políticas del tenant pueden exigir intervención de su administrador.
- Para organizaciones que exijan restricción en Microsoft, ofrecer un perfil `Sites.Selected` con rol de lectura sobre sitios concretos, previa prueba de compatibilidad. Necesita consentimiento y asignación al recurso; no permite prometer un selector global de sitios. Los permisos Selected a nivel de carpeta se evaluarán aparte porque pueden alterar la herencia de permisos. [Permisos Selected](https://learn.microsoft.com/en-us/graph/permissions-selected-overview).

La primera tarea verificará estos perfiles contra un tenant de prueba. No se cambiará silenciosamente a un permiso más amplio si un endpoint falla.

La caché MSAL se persistirá cifrada por usuario, tenant e identidad Microsoft, con control de concurrencia entre web y worker. MSAL gestiona la renovación; el diseño no dependerá de extraer refresh tokens de su API. [Caché de MSAL Node](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching).

El callback comprobará sesión local, `state`, PKCE, emisor, tenant, identidad y retorno permitido. Una reconexión con otra identidad no heredará automáticamente los índices anteriores. Los secretos y la caché de tokens estarán disponibles solo para backend/worker.

## 4. Modelo de datos propuesto

Se ampliará el modelo existente, conservando sus documentos manuales y reglas.

| Recurso propuesto | Responsabilidad |
| --- | --- |
| `microsoft_connections` | Propietario, tenant, identidad Microsoft estable, cuenta, scopes, estado, versión de autorización y caché cifrada separada de los metadatos públicos |
| `knowledge_connectors` | Fuente asociada, conexión, `site_id`, `drive_id`, `root_item_id`, subcarpetas, filtros, periodicidad, política de uso y estado |
| `sharepoint_sync_cursors` | Cursor por propietario/conexión/biblioteca, ejecución activa, checkpoint, última reconciliación correcta y bloqueo temporal |
| `sharepoint_items` | Identificadores remotos y padre, tipo, versión remota/eTag, URL web, fechas, documento local asociado, resultado de extracción y comprobación de acceso |
| `knowledge_sync_jobs` | Trabajos duraderos de descubrimiento, descarga, indexación, retirada y reconciliación; reintentos y progreso |
| Modelo documental existente | Origen `MANUAL`/`SHAREPOINT`, procedencia, versión activa, disponibilidad y localizador: página, hoja/rango o diapositiva |

Decisiones de consistencia:

- Cada carpeta raíz se asociará inicialmente a una fuente. Una conexión admitirá varios conectores y fuentes con reglas diferentes.
- La identidad remota será `(tenant, drive_id, item_id)`, particionada por propietario y conexión. El nombre o la ruta no serán la clave.
- Rechazar raíces solapadas dentro de una conexión en la primera versión; evita duplicados y políticas de audiencia ambiguas. Una futura relación de pertenencia múltiple requerirá reglas explícitas.
- Añadir claves compuestas, RLS y RPC con verificación de propietario también cuando se use `service_role`; la caché de tokens no será seleccionable por el cliente.
- Preparar una nueva versión de texto e índice y activarla de forma transaccional. Un archivo actualizado cuyo procesamiento falle quedará pendiente/no disponible para respuestas automáticas; no se presentará la versión anterior como vigente.
- Separar cuotas de subida manual y sincronización: archivos, bytes, páginas/celdas, texto, fragmentos, OCR y almacenamiento. Aplicar las mismas reglas en servidor, SQL, Storage y UI; no eliminar todos los límites.

## 5. Sincronización y disponibilidad del conocimiento

Flujo propuesto:

```text
Cuenta Microsoft → carpeta elegida → trabajos de sincronización
→ descarga temporal → extracción por formato → versión del índice
→ fuente autorizada → reglas existentes → fragmentos verificables → borrador
```

### Descubrimiento e importación

1. Resolver una URL normal de sitio/carpeta o navegar por los recursos autorizados; validar que el resultado sea una carpeta del tenant permitido. Los enlaces de compartición se resolverán solo con una operación compatible con el perfil de lectura.
2. Guardar IDs estables y previsualizar alcance, filtros, tipos de archivo y cuotas. La interfaz explicará qué subcarpetas se incluirán.
3. Crear trabajos en segundo plano, con paginación y recuperación tras reinicios. La petición web no realizará la importación completa.
4. Mantener una jerarquía por IDs para decidir pertenencia a la raíz, incluidos movimientos de carpetas. No seguir accesos directos a otros ámbitos de forma automática.

Para el perfil que permita enumerar la biblioteca, usar `GET /drives/{drive-id}/root/delta` desde el inventario inicial y consumir sus páginas hasta obtener el cursor final. La API v1.0 documenta delta en la raíz de la biblioteca; no se asumirá un endpoint delta de carpeta. Se filtrarán las raíces elegidas antes de descargar contenido. Un perfil limitado que no admita esa enumeración requerirá reconciliación recursiva y un estado de cobertura explícito hasta demostrar convergencia. [Delta de driveItem](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0).

La enumeración de biblioteca puede devolver metadatos ajenos a la carpeta elegida: no se descargarán sus contenidos y solo se conservará la información de jerarquía imprescindible. Esta diferencia se incluirá en la documentación de acceso.

### Descarga, extracción y cambios

- Descargar en backend, con límites de tamaño, tiempo y memoria. Las descargas Graph pueden redirigir a URL temporales preautorizadas: no se registrarán, persistirán ni entregarán al cliente, y no se reenviará el bearer token a ese destino. Validar host/destino y redirecciones. [Descarga de contenido](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).
- Ejecutar parsers y conversores en procesos aislados sin credenciales, macros, fórmulas activas ni acceso de red. Borrar temporales. Por defecto, conservar texto/índice y procedencia; la retención de originales importados será una opción explícita.
- Comparar versión/eTag y hash para evitar reprocesar contenido idéntico. Separar cambios de metadatos de cambios de contenido.
- Actualizar altas, modificaciones, renombres y movimientos. Retirar inmediatamente del índice activo los elementos eliminados o que salgan del ámbito; tratar también los descendientes de una carpeta movida o borrada.
- Guardar el checkpoint junto con trabajos duraderos antes de avanzar el cursor. Un reinicio no debe perder cambios ni duplicar versiones. Una pasada incompleta no autoriza a borrar todos los elementos no vistos.
- Recuperar cursores inválidos mediante reconciliación completa, sin escribir cambios en SharePoint. Mantener separados el progreso de descubrimiento y el de indexación. [Recuperación de delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0).
- Respetar `429` y `Retry-After`, con reintentos acotados y espera progresiva; limitar concurrencia por tenant y conexión. [Límites de Microsoft Graph](https://learn.microsoft.com/en-us/graph/throttling).

Propuesta inicial de actualización: cada 15 minutos y botón «Sincronizar ahora», configurable y ajustada al volumen. Es un objetivo del producto, no una garantía de latencia de Microsoft. Las notificaciones de cambios podrán añadirse después como acelerador, manteniendo reconciliación periódica.

### Acceso y frescura al responder

La sincronización de contenido no bastará para acreditar permisos actuales. Antes de entregar fragmentos al modelo se comprobarán con la identidad conectada el acceso al archivo, su versión y su pertenencia a la raíz seleccionada. Se repetirá la comprobación de las referencias utilizadas antes de crear el borrador en Gmail, junto con la versión local de conexión, política e índice.

Si cambia un archivo, pierde acceso, se mueve fuera del ámbito o no puede comprobarse su estado, se retirará esa evidencia y se solicitará revisión o nueva recuperación. No se empleará una copia antigua como respaldo ante un error de permisos o una desconexión. Ninguna comprobación puede garantizar cambios que ocurran después de ella: se minimizará esa ventana y se conservará el momento de verificación.

Todos los accesos a texto, búsqueda, fragmentos y descargas pasarán por estas políticas, no solo la pantalla de conectores. Se impedirán consultas directas al índice que eludan el estado de la conexión. Las copias ya creadas en Gmail seguirán sujetas a revisión del titular; desconectar una fuente no elimina borradores anteriores.

## 6. Integración con reglas y respuestas

Se mantendrá el router actual. Una regla podrá elegir una fuente manual o una fuente de SharePoint sin cambiar su semántica: exclusiones prevalentes, fuente principal, respaldo cuando falte evidencia e intervención si hay insuficiencia o conflicto. Un fallo de autenticación no ampliará el ámbito de búsqueda.

La primera entrega reutilizará la búsqueda textual actual y comprobará su cobertura con preguntas del corpus. La ampliación incorporará búsqueda híbrida textual/semántica cuando sea necesaria para preguntas con sinónimos, idiomas distintos o referencias indirectas. Los filtros de propietario, fuente, audiencia, versión, vigencia y conexión se aplicarán antes de devolver candidatos, tanto al índice textual como al semántico. La indexación semántica tendrá proveedor, retención y presupuesto explícitos.

Cada evidencia conservará archivo, fuente, versión, fecha, enlace normal de SharePoint y página/hoja/rango/diapositiva. Los enlaces se validarán; las referencias serán generadas por la app, no inventadas por el modelo. Habrá que ampliar los esquemas estrictos del retriever y de procedencia para los nuevos localizadores.

El acceso del usuario a un documento Microsoft y la autorización para usarlo en un correo son decisiones diferentes. Antes de activar cada fuente, el titular elegirá su política de audiencia y revisión. Los documentos heredarán esa política, con excepciones más restrictivas por archivo. Se respetarán todos los destinatarios del correo. La configuración inicial de nuevas fuentes requerirá revisión y no supondrá que todos los archivos sean aptos para cualquier destinatario.

Los documentos seguirán tratándose como datos: sus instrucciones internas no podrán ampliar permisos, modificar las reglas ni activar acciones.

## 7. Interfaz, operación y privacidad

En **Conocimiento** se añadirá «Conectar SharePoint»: conectar cuenta → elegir sitio/biblioteca/carpeta → revisar subcarpetas y cobertura → asignar nombre y política de fuente → sincronizar → configurar reglas.

Cada conector mostrará cuenta, carpeta, fuente, estado, última sincronización correcta, próxima ejecución, espacio y conteos de archivos descubiertos, indexados, pendientes, omitidos y fallidos. Los errores estarán asociados al archivo y tendrán acciones de reintento o reconexión. Se diferenciará «sincronización terminada» de «todo el contenido consultable».

Habrá acciones de sincronizar, pausar, reanudar, cambiar alcance y desconectar. Pausar la sincronización y desactivar el uso de la fuente serán controles distintos y explícitos. Al desconectar se deshabilitará su uso inmediatamente; se cancelarán trabajos mediante una versión de autorización y se eliminarán credenciales y copias locales derivadas según la política definida. La retirada de consentimientos del lado Microsoft se documentará por separado.

Ampliar exportación, borrado de cuenta, ledger de supresiones y recuperación de backups para incluir conexiones e índices externos. La exportación no contendrá secretos ni URLs temporales. Registrar solo metadatos operativos mínimos: duración, volumen, estado y códigos de error. Medir coste de almacenamiento, extracción, OCR y búsquedas; definir cuotas antes de habilitar bibliotecas grandes.

## 8. Backlog ordenado y criterios de aceptación

Los identificadores SP son referencias de este plan; no son tickets creados en Jira.

| ID | Entregable | Dependencias | Aceptación principal |
| --- | --- | --- | --- |
| SP-01 | Prueba Graph y decisiones de acceso | Tenant y carpeta de prueba | Conectar, resolver carpeta, enumerar, descargar y comprobar acceso con scopes documentados; inventario de formatos y volumen |
| SP-02 | Modelo, RLS, RPC y cuotas | SP-01 | Migración compatible con documentos manuales; aislamiento entre dos usuarios y dos tenants; límites coherentes |
| SP-03 | OAuth Microsoft y caché cifrada | SP-01, SP-02 | Callback protegido, renovación tras reinicio, concurrencia controlada, reconexión y desconexión verificadas |
| SP-04 | Selección de carpeta y fuente | SP-02, SP-03 | Varias raíces no solapadas; IDs y tenant validados; subcarpetas y alcance visibles |
| SP-05 | Trabajos e importación inicial | SP-04 | Paginación completa, checkpoints, reintentos e idempotencia; reinicio a mitad de importación sin pérdida |
| SP-06 | Indexación de formatos actuales | SP-05 | PDF/DOCX/TXT consultables con procedencia y versiones; fallos aislados por archivo |
| SP-07 | Cambios, retiradas y revalidación | SP-05, SP-06 | Cambios y movimientos reflejados; baja de acceso efectiva antes del prompt y del borrador; recuperación de cursor inválido |
| SP-08 | Reglas, políticas y referencias | SP-06, SP-07 | Selección por necesidad, exclusiones y audiencia verificadas; ninguna respuesta respaldada por una versión retirada |
| SP-09 | Excel, CSV, PowerPoint y texto web | SP-06 | Casos de tablas/cabeceras/unidades, hojas, diapositivas y referencias; sin ejecutar fórmulas ni macros |
| SP-10 | OCR y cobertura visual | SP-09 | Escaneos e imágenes con localizador y calidad; límites de coste; revisión de cifras dudosas y errores visibles |
| SP-11 | Calidad de recuperación a escala | SP-08, SP-09 | Corpus de preguntas y respuestas esperadas; medir cobertura y precisión; habilitar búsqueda híbrida si hace falta |
| SP-12 | Operación, privacidad y piloto | SP-07 a SP-11 | Panel completo, exportación/borrado, alertas, carga y recorrido real desde carpeta a borrador |

**Entrega A:** SP-01 a SP-08, más la parte de operación y privacidad de SP-12 necesaria para esos formatos. **Entrega B:** SP-09 a SP-11 y cierre de SP-12 sobre la cobertura ampliada. Los controles de acceso, retirada y borrado pertenecen a la entrega A.

No se fija una fecha de finalización antes de SP-01: volumen, formatos, requisitos del tenant y necesidad de conversores/OCR condicionan esfuerzo y coste. Tras esa prueba se podrá estimar por entregable con datos del corpus real.

## 9. Pruebas y salida del piloto

1. **Proveedor y sincronización:** paginación, duplicados, renombres, movimientos de carpetas enteras, eliminación, raíces modificadas, `401`, `403`, `404`, `429`, errores transitorios y cursor caducado. Caídas antes y después de guardar trabajos/cursor/índice.
2. **Aislamiento:** dos usuarios y tenants, IDs manipulados, conexión de otro propietario, identidad cambiada al reconectar, archivo fuera de la raíz, destinatarios incompatibles y acceso revocado entre búsqueda y escritura del borrador.
3. **Extracción y recuperación:** archivos reales de prueba con tablas, cifras, versiones contradictorias, fórmulas sin valores guardados, escaneos, documentos extensos y límites excedidos. Preguntas que requieren combinar documentos y preguntas sin respuesta en el corpus.
4. **Privacidad y ciclo de vida:** ausencia de tokens/texto en logs, caché cifrada, borrado de temporales, desconexión durante trabajos activos, supresión de cuenta y recuperación sin reintroducir información suprimida.
5. **Regresión:** documentos manuales, reglas existentes, generación y validación factual. Ejecutar comprobaciones TypeScript/build, pruebas unitarias pertinentes, SQL/RLS, integración y E2E del proyecto. No usar el proyecto remoto compartido para resets o seeds de prueba.
6. **Piloto real controlado:** conectar una carpeta representativa y comprobar que cada archivo descubierto queda contabilizado; añadir, editar, mover, retirar permisos y borrar archivos; verificar citas y bloqueos en borradores. Medir tiempos y coste con un volumen acordado después del inventario.

Para cerrar la entrega se deberá poder explicar por qué cada archivo está o no disponible. Ninguna exclusión, error de formato, falta de permisos o límite de cuota podrá quedar oculto bajo un estado genérico de éxito.

## 10. Cambios previstos en el repositorio

- Nuevos módulos `src/modules/connectors/` y `src/modules/sharepoint/`, adaptador Graph en `src/providers/` y repositorios en `src/db/`.
- Rutas propuestas `/api/connectors/microsoft/{connect,callback,disconnect}` y `/api/knowledge/connectors` con operaciones de selección, configuración, sincronización y estado; todas sujetas a sesión y validación de origen donde corresponda.
- Procesamiento en `src/worker/` mediante trabajos propios y presupuesto separado del correo, evitando que una carpeta grande bloquee la preparación de respuestas.
- Extensiones de `src/modules/knowledge/`, `source-router/`, políticas, contratos de generación, validadores y metadatos de actividad para origen y localizadores externos.
- Interfaz en `src/app/app/` y página de Conocimiento; paginación del catálogo de documentos para no cargar una biblioteca completa en el navegador.
- Nuevas migraciones y pruebas en `supabase/`; revisión de consultas de texto, RLS, Storage, cuotas y generación de tipos. No editar migraciones ya aplicadas para introducir la funcionalidad.
- Configuración Microsoft/Graph y claves en plantillas de entorno y despliegue, feature flag inicialmente desactivado, comprobaciones de configuración y guía de registro en Entra ID. El primer piloto se limitará a tenants autorizados; la apertura a otros tenants tendrá onboarding y consentimiento comprobados.

Este plan amplía el alcance original del MVP, que excluía sincronización con SharePoint. No realiza conexiones reales, solicita consentimientos ni cambia la configuración de producción.
