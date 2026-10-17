# MAIL-001 — Especificación funcional del MVP Gmail AI

**Versión:** 1.0 · **Fecha:** 14/10/2026 · **Estado:** Decisión de producto adoptada (pendiente de validación en piloto) · **Prioridad:** P0

## 1. Propósito y posicionamiento

Crear una **capa de preparación de correspondencia** conectada a Gmail: para emails elegibles, decide si requieren respuesta, recupera contexto autorizado, imita la forma profesional de expresarse del titular y deja un borrador listo en el hilo original. El titular **siempre revisa y envía desde Gmail**. No se construye un cliente de correo ni se promete una copia exacta del estilo.

**Promesa provisional:** «Abre Gmail y encuentra las respuestas ya preparadas, con tu estilo y la información correcta». La diferenciación es **identidad × destinatario × conocimiento × reglas**, no solo redacción.

**Referencias de origen:** análisis de mercado adjunto, páginas 5, 9–14 y 21–23 (estrategia draft-first, Style Memory y separación de capas).

## 2. Público objetivo y objetivo de validación

- Persona principal: profesional de servicios B2B que recibe solicitudes repetitivas de clientes y consulta documentación para contestarlas (consultoría, asesoría, pequeña gestoría o distribución B2B).
- Primer piloto: una cuenta individual de Gmail autorizada; después, **2–3 profesionales** con cuentas independientes. No administrar organizaciones ni compartir memorias de estilo.
- Requisito de uso: volumen recurrente de correo y disponibilidad de algunos documentos de conocimiento del usuario.
- No priorizar: correo personal doméstico, atención masiva de ecommerce, sectores regulados con información especialmente sensible sin evaluación específica.

## 3. Alcance en tres niveles

### 3.1 PoC local (primera prueba técnica)

1. Autenticación OAuth de un desarrollador/tester autorizado.
2. Análisis de una muestra **orientativa de 200–500 emails enviados**: ventana por defecto de 12 meses, configurable y con exclusiones. Se ajustará el tamaño a lo disponible; un número pequeño reduce la confianza en el perfil.
3. Perfil de estilo general derivado, no fine-tuning.
4. Selección **manual** de un `threadId` para generar una respuesta.
5. Llamada a OpenAI con conversación, estilo y las instrucciones básicas.
6. Creación de **un único borrador** en el hilo original de Gmail mediante API.
7. Prueba en 10–20 conversaciones históricas/actuales seleccionadas con permiso.

**No incluye:** web multiusuario, worker, OCR, Drive, autoenvío, facturación, búsqueda vectorial.

### 3.2 Alpha técnica para uso continuado

1. Inicio de sesión en la aplicación y conexión OAuth por usuario.
2. Una cuenta Gmail por usuario; acceso a hilos y enviados.
3. Perfil general más variantes por contacto/grupo cuando existan muestras suficientes.
4. Recuperación de ejemplos mediante identificadores Gmail y lectura *bajo demanda* (sin crear un repositorio persistente de textos completos de email).
5. Worker con consulta periódica, filtrado, cola, reintentos e idempotencia.
6. Clasificación `REPLY_REQUIRED` / `NO_REPLY` / `UNCERTAIN`.
7. Fuentes documentales elegidas y subidas por el usuario (PDF con texto extraíble, TXT, DOCX); búsqueda textual, fragmentos y procedencia.
8. Reglas de consulta y restricciones por tema.
9. Generación con salida estructurada, comprobación de datos, abstención y borrador en Gmail.
10. Web mínima para conectar, pausar, ajustar estilo, documentos y visualizar estados.
11. Evidencias operativas sin almacenar cuerpos íntegros de Gmail por defecto.

### 3.3 Beta de validación

1. Observabilidad, seguridad y políticas de conservación verificadas.
2. Métricas de uso, utilidad y errores con límites de información personal.
3. Comparación de correcciones **solo cuando esté autorizada**, con almacenamiento temporal limitado y eliminación.
4. Piloto acotado en 2–3 profesionales conocidos y explícitamente autorizados.
5. Decisión documentada de seguir, cambiar o detener el producto.

## 4. Reglas funcionales vinculantes

- **No autoenvío**. Solo se invoca `users.drafts.create`; las funciones de `send`, `delete` o modificación de mensajes originales quedan prohibidas en la lógica del producto. El permiso `gmail.compose` sí tiene poder técnico de enviar, por lo que esta regla se aplica con controles de código, pruebas y auditoría, no por limitación de OAuth.
- **No sobrescritura** de borradores del usuario o ajenos al sistema. Si existe uno, marcar `SKIPPED_EXISTING_DRAFT`.
- **No respuesta duplicada** por correo objetivo; revalidar justo antes de crear el borrador.
- **Respuesta simple** al remitente directo del último mensaje elegible; no añadir Cc/Bcc o responder a todos en el MVP. Los hilos multiparte o remitentes ambiguos van a revisión.
- **Información factual**: comprobar con fuentes válidas; no asumir como vigente un precio o condición visto en emails antiguos.
- **Si faltan datos esenciales**: estado `REVIEW_REQUIRED`, sin redactar afirmaciones inventadas ni crear un borrador arriesgado.
- **Idioma**: mismo idioma que el último mensaje relevante, salvo instrucción explícita válida o contexto consistente contrario.
- **Riesgo alto**: condiciones contractuales, decisiones legales/fiscales, datos bancarios, ofertas vinculantes, descuentos no confirmados, RR. HH. o salud → revisión manual, sin promesas no verificadas.
- **Privacidad**: el historial de Gmail se consulta con fines de la función de usuario; no se exporta, vende, comparte con otros clientes ni se usa para entrenar modelos generales.
- **Permisos**: cada operación se ejecuta sobre la cuenta OAuth del usuario y documentos de los que es propietario. No hay índice compartido entre clientes.

## 5. Elegibilidad de mensajes por defecto

**Candidatos:** mensajes nuevos que llegan a `INBOX` de la cuenta conectada y que podrían necesitar respuesta, no enviados por el usuario; en piloto automático, solo remitentes/dominios incluidos en una lista autorizada cuando así se configure.

**Exclusiones automáticas:** spam, papelera, mensajes `no-reply`, newsletters, autoresponders, respuestas ya emitidas, hilos con draft manual, hilos con destinatarios ambiguos, emails cuyo contenido dependa de adjuntos no soportados, mensajes masivos, conversaciones sensible/restringidas, solicitudes de acciones externas imposibles de verificar.

**Regla ante duda:** `UNCERTAIN`→ `REVIEW_REQUIRED` u omisión documentada; no generar un borrador que aparente disponer de información completa.

## 6. Límites iniciales recomendados (configurables, no restricciones de Gmail)

| Parámetro | Valor piloto recomendado | Motivo |
|---|---:|---|
| Cuentas por usuario | 1 | Aislamiento simple |
| Usuarios piloto | 2–3 | Control de calidad y consentimiento |
| Escaneo de correo nuevo | Cada 5 minutos | Bajo coste de ingeniería |
| Historial para inferir estilo | Hasta 500 enviados, por defecto últimos 12 meses | Muestreo manejable |
| Conversación en prompt | Hasta 20 mensajes recientes relevantes | Coste/contexto acotados; si hay ambigüedad, abstenerse |
| Documentos cargados | Hasta 10 por usuario, 10 MB por documento | Piloto pequeño |
| Tipos documentales | PDF de texto, DOCX, TXT | Sin OCR inicial |
| Borradores automáticos | Límite configurable (propuesta: 30/día) | Evitar bucles/costes |
| Reintentos | 3 para errores transitorios, con backoff | Estabilidad |

Los límites deben exponerse en configuración y revisarse con mediciones, no asumirse como restricciones normativas.

## 7. Funciones excluidas expresamente

WhatsApp, Outlook, sincronización de Google Drive/SharePoint, extracción OCR, lectura semántica de adjuntos entrantes, redacción de nuevos emails fuera del contexto de un hilo, envío automático, modificaciones en correos recibidos, respuesta a todos por defecto, agenda, CRM/ERP, agentes con capacidad de ejecutar acciones, colaboración empresarial, suscripciones, precio dinámico, extensión Chrome, entrenamiento de modelos generalistas y constructor visual de workflows.

## 8. Requisitos no funcionales

- **Exactitud antes que cobertura**: fallo seguro y abstención.
- **Seguridad**: cifrado de tokens, límites de roles, no logs con cuerpos, auditoría de escrituras.
- **Fiabilidad**: reintentos, idempotencia, reconciliación, estados trazables.
- **Rendimiento objetivo, no SLA**: para los candidatos no omitidos, borrador en ~15 min (p95) desde recepción en piloto de poco volumen, sujeto al polling y cuotas.
- **Coste**: registrar tokens, coste estimado y duración por etapa; umbral de presupuesto por usuario.
- **Disponibilidad**: procesos reanudables tras reinicios y desconexiones.
- **Observabilidad**: metadatos y códigos de resultado; nunca cuerpo íntegro en logs por defecto.

## 9. Aceptación de MAIL-001

- [x] Definido el valor que aporta y a quién va dirigido.
- [x] Descrito el flujo principal y sus etapas.
- [x] Definidas funciones PoC, Alpha y Beta.
- [x] Documentadas exclusiones y límites iniciales.
- [x] Determinado que toda salida visible es un draft revisable desde Gmail.
- [x] Documentados comportamientos de exclusión, abstención y no autoenvío.

**Estado:** documentación cerrada; hipótesis de métricas y límites por validar mediante el piloto.
