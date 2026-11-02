# MAIL-070 — Ejecutar y evaluar el piloto

Fecha: 1 de noviembre de 2026. **Protocolo y registros preparados; piloto real sin ejecutar.** Todavía no hay participantes seleccionados. La activación de VPS/dominio y los requisitos externos de privacidad, alertas y Google siguen pendientes según MAIL-067–069. No se han leído buzones, generado propuestas con cuentas reales ni registrado resultados comerciales en esta tarea.

Esta guía indica qué debes hacer cuando tengas al menos dos participantes preparados. Usa una copia privada del [registro e informe](MAIL-070-registro-e-informe-plantilla.md). Las pruebas sintéticas del repositorio acreditan comportamiento técnico; no son resultados de usuarios piloto.

## 1. Qué puedes preparar ahora y qué exige usuarios reales

Ahora puedes completar responsables, presupuesto, calendario relativo, criterios de decisión y espacio privado para los registros. Para empezar con datos reales necesitas las fichas de [MAIL-069](MAIL-069-preparacion-usuarios-piloto.md) completas, el servicio y soporte operativos de [MAIL-067](MAIL-067-despliegue-produccion.md), y una modalidad de acceso de Google permitida conforme a [MAIL-068](MAIL-068-publicacion-google-oauth.md).

No conectes buzones para adelantar la evaluación si siguen sin definir el operador o la información de privacidad. La participación en un piloto tampoco autoriza por sí sola a leer cualquier correo para soporte: el titular evalúa sus propuestas y cualquier acceso humano adicional debe estar delimitado y autorizado. Consulta la [política de datos de Google Workspace](https://developers.google.com/workspace/workspace-api-user-data-developer-policy#limited-use-of-user-data).

Antes de arrancar, deja por escrito:

- Dos o tres participantes, responsable operativo y persona que evalúa cada cuenta. Usa alias P-01, P-02 y P-03; conserva los contactos por separado.
- Fechas de inicio/cierre, horario de soporte y mecanismo de pausa. Las 2–3 semanas empiezan cuando se cumplen los requisitos, no desde la fecha de este documento.
- SHA de la versión desplegada, modelo, parámetros, tarifas, revisión del perfil, preferencias y versiones/vigencia de fuentes. Conserva también los cambios durante el piloto.
- Presupuesto máximo aprobado para toda la prueba y por participante, quién lo revisa y cuándo se pausa. Un techo de borradores diario no es un tope monetario: hay llamadas de análisis, clasificación, generación y validación.
- Permisos opcionales concedidos o rechazados, plazos de retención y fecha de limpieza de los registros privados. La comparación de texto y el aprendizaje no se activan por medir resultados.
- Criterios de éxito y de detención acordados **antes de observar los resultados**. Los valores propuestos en la sección 8 se pueden ajustar previamente, dejando motivo y fecha.

## 2. Calendario de trabajo

| Momento relativo | Tu acción | Evidencia |
| --- | --- | --- |
| Preparación | Cerrar MAIL-069 y acordar criterios/presupuesto. Mantener automatización pausada. | Fichas y protocolo fechados. |
| Días 1–3 | Seleccionar y evaluar 30–50 casos retrospectivos autorizados por persona; medir una referencia manual. | Registro de casos, límites de cobertura y evaluación humana. |
| Fin del día 3, o cuando se complete la retrospectiva | Decidir por cuenta si pasa a generación real. | Decisión explícita: activar / corregir y repetir / no activar. |
| Primeros dos días de uso real | Activación acompañada, máximo inicial propuesto de 5 borradores/día UTC. | Revisión de todas las propuestas y anotación diaria. |
| Resto de semanas 1–2 | Si los primeros días son correctos, hasta 10 borradores/día UTC, con revisión humana siempre. | Errores, omisiones, uso, tiempos, fuentes y consumo. |
| Aproximadamente días 7 y 14 | Entrevista breve, revisión de incidencias y configuración. | Cambios versionados y decisiones de continuidad. |
| Hasta día 21, si hace falta y se acuerda | Completar muestra o comprobar correcciones. | Ampliación de plazo y presupuesto; sin ocultar periodos malos. |
| Cierre | Pausar generación, revisar resultados pendientes y emitir informe. | Informe por participante y decisión conjunta. |

Si la retrospectiva se retrasa, desplaza la activación; no la omitas para respetar una fecha. Programa la posible reconexión de Google si se usa audiencia externa en Testing: con los scopes actuales, los refresh tokens caducan a los siete días. Referencia: [caducidad OAuth](https://developers.google.com/identity/protocols/oauth2#expiration).

## 3. Evaluación retrospectiva: 30–50 casos por participante

### Seleccionar antes de ver las respuestas del asistente

Pide al titular que elija una ventana temporal y autorice los casos concretos. Conserva solo referencias privadas, categorías y resultados de la evaluación, sin copiar el buzón al registro. Utiliza hilos distintos y elimina solapamientos con la muestra usada para construir el estilo.

Propuesta para una muestra de **40 casos por persona**:

| Familia | Casos propuestos | Qué se comprueba |
| --- | --- | --- |
| Consultas repetitivas sencillas | 12 | Respuesta útil, completa y sin compromisos inventados. |
| Consultas que necesitan documentos | 8 | Dato, fuente, versión y vigencia; abstención si falta evidencia. |
| Contexto del hilo, destinatario o idioma | 8 | Comprensión temporal y estilo apropiado. |
| Casos que deben omitirse | 6 | Newsletter/no-reply, ya respondido o borrador manual, según disponibilidad. |
| Casos que deben ir a revisión | 6 | Información insuficiente, contradicción, asunto fuera de alcance o adjunto no soportado. |

Si solo hay 30 o hay 50, ajusta las cantidades conservando familias positivas y negativas. Documenta la selección y las sustituciones. No inventes mensajes reales para rellenar categorías: una reproducción sintética se identifica como tal y no cuenta como otro caso real. Tampoco cuentes tres variantes de estilo del mismo hilo como tres ejemplos.

Separa de antemano una parte para diagnóstico y otra para confirmación final, por ejemplo 20 y 20 casos en una muestra de 40. Conserva al menos diez respuestas históricas válidas en cada lote de estilo que vayas a ejecutar. La partición debe respetar la disponibilidad real de los casos; si no cabe, deja el análisis como exploratorio y reserva casos nuevos antes de declarar una mejora confirmada.

Para cada caso, **antes de generar o puntuar**, registra:

1. Mensaje objetivo y momento al que se quiere reconstruir la situación. El evaluador puede consultar la respuesta histórica reservada; el generador no debe recibirla ni recibir mensajes posteriores.
2. Resultado esperado: proponer respuesta / omitir / revisión, y por qué.
3. Hechos que puede afirmar y fuente que estaba disponible y vigente entonces. Una respuesta antigua del titular no es automáticamente correcta.
4. Datos o acciones que no puede inventar y destinatario/idioma esperados.
5. Grupo diagnóstico o confirmación, versión del sistema y método de ejecución.

Mantén el perfil y sus ejemplos anteriores al corte temporal, excluye los hilos evaluados y no ajustes el estilo con las respuestas de confirmación. Evita también filtraciones desde documentos actuales que no existían en la fecha evaluada. Si pruebas con documentos actuales, identifica el caso como escenario actual reconstruido, sin presentarlo como reproducción histórica exacta.

### Herramientas existentes y límites

| Herramienta | Uso real | Límite para este piloto |
| --- | --- | --- |
| `poc:sample` | Muestra de enviados, conserva referencias y estadísticas locales. | Es independiente del onboarding web; usa solo la cuenta/ventana/exclusiones autorizadas. |
| `poc:evaluate-style` | Reconstruye el hilo hasta el objetivo, reserva la respuesta real y compara sin personalización, perfil general y contextual. | Lotes de 10–20 hilos; necesita muestra local previa y al menos diez mensajes válidos de aprendizaje. No reproduce el pipeline completo de documentos, reglas y worker. |
| `poc:validate` | Prueba en seco de 10–20 hilos contra su estado actual y comprueba que no haya escrituras. | No elimina retrospectivamente las respuestas posteriores: un hilo ya contestado puede devolver `ALREADY_ANSWERED`. No sirve para fingir una respuesta antes de que se enviase. |
| `poc:generate` | Generación manual en memoria, sin crear ni enviar mensajes. | Usa el contexto actual; no es una reproducción histórica completa con todas las fuentes de producción. |
| `poc:draft` / `Revisar correos ahora` | Pueden intervenir en la generación real de borradores. | No son un modo seco ni deben utilizarse para repetir casos históricos en el buzón del participante. |

Las CLI PoC requieren **APP_ENV=development y PROVIDER_MODE=live** en la estación administrativa autorizada. No cambies el entorno de la VPS a development para ejecutarlas ni copies secretos a un equipo no preparado. Antes de introducir cuentas reales, el operador debe tener configurado el acceso seguro, las autorizaciones y el presupuesto. La cuenta Gmail debe estar conectada; la automatización del participante se mantiene desactivada durante la retrospectiva.

Consulta primero la ayuda, sin leer correos ni llamar al modelo:

```powershell
npm run poc:sample -- --help
npm run poc:evaluate-style -- --help
npm run poc:validate -- --help
```

### Ejecutar los lotes de estilo

1. Obtén en la sesión autorizada los IDs de Gmail API del hilo, mensaje objetivo y respuesta histórica. Los fragmentos visibles de una URL de Gmail no deben darse por IDs válidos de la API. Si no puedes obtener/validar las referencias, deja ese lote pendiente de preparación técnica.
2. Prepara la muestra local mediante `poc:sample`, usando las fechas UTC y exclusiones de la ficha. El final del aprendizaje debe ser anterior al objetivo más antiguo de **todos** los lotes reservados, no solo al del siguiente lote: así evitas usar respuestas de confirmación al evaluar otro grupo. `--after` incluye el día, `--before` lo excluye. Esta operación consulta enviados y conserva referencias; no llama a OpenAI. No uses las fechas por defecto sin revisarlas. La ayuda muestra las opciones exactas. Si no quedan al menos diez mensajes válidos de aprendizaje, deja la evaluación de estilo pendiente en vez de incluir respuestas reservadas.
3. Forma lotes de 10–20 hilos diferentes. Para 40 casos compatibles con esta herramienta puedes usar dos lotes de 20; si parte de los 40 casos son negativos o necesitan otro método, no los fuerces al corpus de estilo. Registra la cobertura real por familia.
4. Guarda cada lote en un JSON privado fuera del repositorio. Es una lista de objetos con `threadId`, `targetMessageId` y `replyMessageId`. Un objeto tiene esta forma; el archivo real debe contener entre diez y veinte:

```json
[
  {
    "threadId": "ID_REAL_DEL_HILO",
    "targetMessageId": "ID_REAL_DEL_OBJETIVO",
    "replyMessageId": "ID_REAL_DE_LA_RESPUESTA_RESERVADA"
  }
]
```

5. En PowerShell, desde el checkout preparado, adapta las tres primeras variables y ejecuta un lote:

```powershell
$pilotEmail = 'SUSTITUIR_POR_CUENTA_AUTORIZADA'
$batchFile = 'C:\RUTA_PRIVADA\P01-L01.json'
$batchSeed = 'P01-L01'
$batch = @(Get-Content -LiteralPath $batchFile -Raw | ConvertFrom-Json)
if ($batch.Count -lt 10 -or $batch.Count -gt 20) { throw 'El lote debe tener de 10 a 20 hilos.' }
$prepareArguments = @('--email', $pilotEmail, '--prepare', '--seed', $batchSeed)
foreach ($item in $batch) {
    $prepareArguments += @('--case', ('{0}:{1}:{2}' -f $item.threadId, $item.targetMessageId, $item.replyMessageId))
}
npm run poc:evaluate-style -- @prepareArguments
if ($LASTEXITCODE -ne 0) { throw 'Preparación fallida: revisar antes de generar.' }
npm run poc:evaluate-style -- --email $pilotEmail --run --review --with-preferences
if ($LASTEXITCODE -ne 0) { throw 'Evaluación incompleta: conservar el motivo y no marcarla como pasada.' }
npm run poc:evaluate-style -- --email $pilotEmail --report
```

`--run --review` hace llamadas de pago y muestra conversación/propuestas en el terminal para puntuar saludo, formalidad, vocabulario, longitud e idioma, además de aceptabilidad y seguridad. Usa una sesión privada con el titular o evaluador autorizado y sin grabación/transcripción del terminal; no redirijas esa sesión a logs. No sustituye las puntuaciones humanas por `--auto-review` para concluir utilidad comercial. Una semilla fija el orden, no garantiza salidas idénticas del modelo.

La herramienta guarda un corpus y un informe por cuenta: **el siguiente `--prepare` reemplaza el corpus y elimina el informe anterior**. Antes del siguiente lote, conserva el informe de metadatos/puntuaciones y la correspondencia de casos en el almacenamiento privado acordado. Los IDs `case-01`, etc. vuelven a empezar: identifica siempre participante + lote + caso. No reconstruyas un mismo lote repetidamente hasta obtener una respuesta buena sin registrar los intentos y costes.

### Completar la parte factual y de integración

Para cada salida disponible, el titular verifica hechos, omisiones y compromisos contra las fuentes autorizadas, y registra la revisión aunque el estilo sea bueno. Un `READY`, una puntuación automática o una similitud alta no acreditan exactitud.

La aplicación **no ofrece ahora una pantalla de replay histórico integral** que inyecte arbitrariamente todos los documentos/reglas de una fecha pasada. Por eso:

- Anota método por caso: revisión del caso histórico, evaluación automática de estilo con revisión humana, prueba en seco del estado actual, reproducción sintética o uso real posterior. Un caso no ejecutado se registra como pendiente; no se convierte en aprobado por revisión del texto esperado.
- Para omisiones, contradicciones y controles documentales, reproduce el escenario con contenido ficticio en una cuenta de prueba del operador mediante el flujo real de la aplicación, sin copiar datos de clientes ni crear borradores históricos en sus buzones. Comprueba estado, fuente y ausencia/presencia del borrador esperado. Son evidencias técnicas complementarias, no usuarios ni casos reales adicionales.
- Si una necesidad requiere reproducción histórica exacta de todo el pipeline, queda pendiente de soporte técnico específico. No actives esa familia como validada solo con el comparador de estilo. Puede acotarse el piloto a familias ya comprobadas, con la exclusión registrada; si eso elimina su valor, no se activa.

Al acabar la retrospectiva debes poder explicar qué se probó de verdad, qué quedó fuera y por qué es razonable pasar a uso limitado. No sumes revisión manual y ejecución como si fueran dos casos independientes.

## 4. Puntuar y decidir el paso a uso real

El titular evalúa cada propuesta a partir de la versión que vio primero:

| Resultado humano | Definición |
| --- | --- |
| Útil sin cambios | Podría usarla tras revisar destinatario y hechos, sin corregir contenido. |
| Útil con cambios menores | Ajustes locales de tono/forma; sin cambiar el sentido ni corregir datos. |
| Requiere cambio importante | Reescritura, omisión esencial, dato incorrecto o compromiso no autorizado. |
| Descartada | No aporta una base utilizable para ese caso. |
| No evaluada | No se pudo ver/evaluar; indicar causa, sin contar como éxito o rechazo. |

Separadamente, puntúa estilo 1–5 y marca hechos respaldados, cobertura de preguntas, destinatario correcto y gravedad del error. Una propuesta útil puede tener un fallo que obligue a detenerla; el juicio de seguridad prevalece.

Antes de activar cada cuenta, comprueba: retrospectiva registrada, cero incidentes graves sin resolver, familias autorizadas comprobadas, límites y fuentes revisados, presupuesto disponible y participante capaz de revisar/pausar. Anota fecha, versión, alcance permitido y confirmación del participante. Si falta evidencia esencial, corrige y evalúa casos nuevos o mantén la cuenta en pausa.

## 5. Activación controlada y rutina diaria

1. En **Ajustes** (`/settings`), comprueba las exclusiones, temas bloqueados, fuentes obligatorias y selección acordadas en MAIL-069. Inicialmente conserva **Solo no leídos de la bandeja de entrada**, intervalo **300 segundos** y máximo **5 borradores/día UTC**.
2. Si Gmail está en pausa, **Reactivar cuenta Gmail** cuando corresponda. Marca **Activar automatización** y pulsa **Guardar configuración** solo después de la decisión anterior. Comprueba en **Actividad** el estado y la cuenta correcta. Si hay que reconectar OAuth, revisa de nuevo qué cuenta se autoriza.
3. Acompaña las primeras propuestas. El titular revisa cada borrador en Gmail; enviar sigue siendo una acción suya. No le pidas que envíe una propuesta incorrecta para obtener una comparación.
4. Tras dos días de uso correcto, puedes subir a **10/día UTC** con acuerdo y evidencia de revisión. No amplíes contactos, temas, fuentes y límite simultáneamente: registra cada cambio para poder interpretar sus efectos.
5. Todos los días de uso, el participante dedica unos minutos a revisar propuestas y completar el registro. El operador revisa incidencias, errores/omisiones, consumo y alertas; el soporte recibe solo metadatos por defecto.

La pausa es **desmarcar Activar automatización → Guardar configuración**; también existe **Pausar cuenta Gmail**. Una petición ya iniciada puede terminar y un borrador existente no desaparece al pausar. No conviertas **Revisar correos ahora** en una supuesta selección individual: puede iniciar procesamiento real conforme a las reglas guardadas.

La interfaz no tiene una lista positiva de remitentes permitidos. Las exclusiones y la selección de no leídos tampoco garantizan que solo se consulte contenido elegido uno a uno. Si necesitas ese aislamiento, usa una cuenta dedicada apropiada o pospón la activación de esa cuenta/familia hasta implementar y comprobar el control necesario.

## 6. Qué registrar y cómo medirlo

Usa el [registro privado](MAIL-070-registro-e-informe-plantilla.md) por participante y fecha. Conserva IDs completos solo en la referencia privada; en un informe compartido usa alias de caso sin asuntos ni contenido.

### Calidad, cobertura y uso

| Métrica | Cálculo y límite |
| --- | --- |
| Utilidad humana | (Útiles sin cambios + útiles con cambios menores) / propuestas evaluadas. Mostrar también no evaluadas. |
| Precisión factual | Propuestas factuales revisadas sin errores / propuestas factuales revisadas. Mostrar denominador y gravedad de los fallos. |
| Cobertura de elegibles | Casos realmente elegibles con borrador / casos realmente elegibles de una muestra revisada por el titular. La elegibilidad esperada se fija sin ver la decisión del sistema. |
| Omisiones incorrectas | Casos que debían atenderse pero quedaron sin propuesta por clasificación, filtro u otro fallo / casos elegibles auditados. Distinguir abstención justificada. |
| Propuestas indebidas | Borradores en casos que debían omitirse o revisarse / casos negativos auditados. Registrar cada uno, aunque el porcentaje parezca pequeño. |
| Uso observado del panel | Envíos confirmados de esos borradores / borradores creados del mismo periodo de creación. Es observación de envío, no satisfacción declarada. |
| Edición observada | Enviados con cambios / envíos comparados. Informar además comparados / envíos confirmados. Sin permiso de comparación, no hay tasa de edición observable. |

Para detectar lo que el sistema no vio, el titular revisa una muestra consecutiva de entrantes dentro del alcance en días/horarios fijados previamente, incluyendo mensajes sin trabajo en Actividad. No se puede medir la cobertura usando solo los trabajos que ya generó el sistema. En las primeras 20–30 entradas por participante que audites, incluye todas las elegibles, negativas y dudosas; no elijas solo borradores buenos.

No mezcles oportunidades únicas con intentos/reintentos. Una respuesta independiente, un borrador desaparecido o un caso pendiente no demuestra rechazo. Las señales de cambio factual del comparador requieren revisión humana y no son un recuento automático de errores reales.

En **Métricas** (`/analytics`) selecciona **Últimos 7/30/90 días** y pulsa **Actualizar métricas**. El panel usa Europe/Madrid, el último día es parcial y resultados de borradores antiguos pueden actualizarse cuando se envíen después. El límite diario de generación usa UTC. Guarda inicio/fin y fecha/hora de cada captura; no restes dos ventanas móviles diferentes para inventar una cohorte exacta. Si el periodo deseado no cabe en esos filtros, utiliza el registro de casos con fechas y conserva por separado la captura del panel.

Al cerrar la generación, toma una captura de metadatos y revisa de nuevo pendientes unas 72 horas después o en el plazo acordado, sin pedir al titular que fuerce envíos. No reactives procesamiento solo para cerrar números. Lo que siga indeterminado se informa como tal; nunca se transforma en aceptación o rechazo por silencio.

### Tiempo de trabajo real

Acuerda una muestra de al menos **10 tareas manuales y 10 con asistencia por persona**, de familias y complejidad comparables. Son objetivos de medición, no muestras ya disponibles.

- Cronometra desde que empieza a comprender/preparar la respuesta hasta dejarla lista para enviar. En manual incluye consulta de fuentes y redacción; con asistencia incluye lectura, verificación de fuentes, edición o descarte y redacción de reemplazo si la necesita.
- Usa tareas distintas pero comparables y alterna el orden de las condiciones cuando sea posible. Repetir el mismo correo después de haberlo contestado introduce aprendizaje; si ocurre, márcalo y no lo presentes como comparación independiente.
- Registra interrupciones y tiempo de espera por separado. No borres los tiempos negativos o casos con reescritura. Aparte mide recepción → borrador si puedes contrastar esas horas; duración del modelo no equivale a latencia total.
- Si hay parejas comparables predefinidas, calcula por pareja `manual − asistencia`; presenta mediana, rango y número de parejas, además del total observado. Si no hay parejas, presenta por separado las distribuciones y su diferencia descriptiva; no la atribuyas de forma causal al asistente.

La **Simulación de tiempo** del panel aplica hipótesis introducidas por el usuario y distancia de edición; no es un cronómetro. No sumes otra vez la edición si tu tiempo medido de asistencia ya la incluye y no extrapoles ahorro a mensajes no medidos ni a semanas de poco uso.

### Utilidad de fuentes y costes

Por propuesta factual, registra qué fuente se consultó, cuál respaldó realmente la afirmación y si era correcta/vigente. Pide al titular que marque si habría necesitado consultar esa fuente para resolver la tarea. Así puedes distinguir fuente simplemente consultada de fuente útil. Varias fuentes pueden contribuir a un caso; sus conteos no se suman como usuarios o respuestas adicionales.

Revisa el subtotal de **Consumo y coste estimado**, su cobertura y los intentos fallidos. El panel atribuye a generaciones de respuesta con tarifa guardada su consumo registrado, incluida validación; **no representa toda la factura**. Añade por separado análisis de estilo, clasificación, otras llamadas, infraestructura y tiempo de soporte, y concilia con los proveedores cuando tengas la factura. Datos sin tarifa o uso conocido son desconocidos, no coste cero. No confundas coste de investigación retrospectiva con coste de operación habitual.

## 7. Entrevistas, incidentes y correcciones

Haz revisiones de unos 15 minutos a mitad de prueba y al cierre:

1. ¿En qué dos casos ayudó más y en cuáles estorbó? Referencias privadas, sin pedir reenvío de mensajes.
2. ¿Qué cambiaste: tono, falta de información, dato erróneo o compromiso? ¿Cómo afecta a tu confianza?
3. ¿Qué documento fue decisivo y qué información siguió faltando?
4. ¿Qué parte de revisar/corregir te llevó más tiempo? ¿Has dejado de usarlo en algún tipo de mensaje?
5. ¿Querrías seguir usándolo, para qué tareas y bajo qué condiciones? ¿Qué alternativa emplearías? Una intención verbal no equivale a compra ni valida un precio.

Registra también a quien abandona o casi no lo usa y su motivo; no lo elimines del informe para mejorar las tasas.

Clasifica los problemas:

| Gravedad operativa | Ejemplos | Acción |
| --- | --- | --- |
| Crítica | Datos ajenos, filtración, destinatario incorrecto, envío inesperado, duplicado o afirmación crítica sin respaldo. | Pausa inmediata del alcance afectado; contención global si procede y gestión de seguridad antes de reanudar. |
| Alta | Dato factual incorrecto no crítico, omisión esencial repetida, fallo de fuentes o acceso. | Excluir/pausar la familia afectada, corregir y comprobar antes de continuar. |
| Calidad | Tono, saludo, longitud o preferencia no representada. | Registrar y priorizar sin ocultar el resultado original. |

Un solo incidente crítico no se compensa con muchos borradores buenos. Aplica MAIL-062/067 para contención y recuperación cuando corresponda; las notificaciones aplicables se valoran con el responsable de privacidad. No incluyas secretos/cuerpos en incidencias ordinarias.

Por cada corrección guarda problema, hipótesis, cambio de código/configuración/documento, versión, fecha y evidencia de regresión. Si cambia código, ejecuta las comprobaciones del repositorio apropiadas al cambio. Repite el caso diagnóstico y comprueba casos distintos de confirmación; el resultado malo original permanece. Una corrección de tarifa se verifica contra el documento correcto, no solo contra una respuesta que ahora suena mejor. La cuenta/familia se reanuda después de la revisión acordada, nunca por cerrar el ticket del bug.

## 8. Decisión final: ampliar, ajustar o detener

Propuesta inicial para acordar antes de empezar; **no son resultados obtenidos ni requisitos de Google**:

| Dimensión | Criterio de decisión propuesto |
| --- | --- |
| Seguridad | Cero incidentes críticos sin resolver; cualquier reanudación con evidencia de corrección y revisión. |
| Cobertura de evaluación | 30–50 casos retrospectivos clasificados por persona con método y alcance explícitos. Casos no ejecutados o áreas esenciales sin comprobar impiden afirmar validación integral. |
| Uso real | Al menos 20 oportunidades elegibles auditadas y 10 propuestas evaluadas por persona durante la observación. Si no se alcanzan, resultado de utilidad insuficiente y extensión acotada o nueva selección. |
| Utilidad | Al menos 70 % de propuestas evaluadas útiles sin cambios o con cambios menores, por persona. Informar cantidades y no evaluadas. |
| Hechos | Al menos 95 % de propuestas factuales revisadas sin error y ningún error crítico tolerado. Si son menos de 20, informar todos los casos y no declarar precisión estabilizada. |
| Tiempo | Medición de al menos 10 tareas por condición/persona y señal positiva de ahorro descriptivo, sin degradar seguridad. Mostrar también pérdidas. |
| Continuidad | Ambos participantes pueden describir un uso valioso y quieren continuar en un alcance concreto; registrar cualquier desacuerdo. |
| Operación | Incidencias prioritarias resueltas o fuera del alcance, coste/consumo y soporte compatibles con el presupuesto, fuentes mantenibles. |

Con muestras pequeñas las tasas son descriptivas. Presenta `n/N`, no solo porcentajes, y no extrapoles de dos profesionales a todo un sector. Una métrica desconocida no pasa por ausencia de fallos detectados.

Posibles decisiones:

- **Ampliar de forma limitada:** evidencia suficiente por ambos usuarios y alcance, seguridad resuelta y capacidad operativa. Definir cuántas personas, tareas y presupuesto para la siguiente etapa. No implica publicación OAuth aprobada ni lanzamiento comercial público.
- **Ajustar y repetir:** hay valor plausible pero faltan casos, cobertura, tiempo positivo o fiabilidad. Especificar hipótesis, responsable, fecha, límite de gasto y evidencia nueva necesaria. No extender indefinidamente sin decisión.
- **Detener o cambiar el enfoque:** riesgo no controlado, falta de utilidad, incompatibilidad con el tratamiento permitido o coste/soporte inviable. Acordar pausa, desconexión/datos y comunicación al participante.

## 9. Informe y cierre

Completa el informe de la [plantilla](MAIL-070-registro-e-informe-plantilla.md) con alcance, selección, resultados individuales, errores/omisiones, tiempos, fuentes, coste parcial/total conocido, entrevistas, cambios y limitaciones. Identifica las evidencias privadas y una versión resumida sin datos identificativos para compartir si corresponde.

Al terminar, deja la generación en pausa salvo acuerdo explícito de continuidad, confirma con cada titular qué conservar/exportar/borrar y aplica los plazos de la política y de las notas de investigación. Quitar un tester de Google no borra datos de la aplicación; la desconexión tampoco elimina sus correos/borradores Gmail.

Cuando ya hayas guardado la evidencia mínima autorizada y corresponda retirar las referencias locales de evaluación, el operador puede ejecutar estos comandos con la misma cuenta seleccionada y configuración administrativa. Eliminan el corpus/informe de estilo y la muestra local de esa cuenta; no son un borrado de cuenta de Auto Email ni eliminan las copias privadas que hayas creado aparte:

```powershell
npm run poc:evaluate-style -- --email $pilotEmail --remove
if ($LASTEXITCODE -ne 0) { throw 'No se ha confirmado la eliminación del corpus local.' }
npm run poc:sample -- --email $pilotEmail --delete
if ($LASTEXITCODE -ne 0) { throw 'No se ha confirmado la eliminación de la muestra local.' }
```

Verifica el resultado y registra también la limpieza de las copias privadas conforme a lo acordado. No borres evidencias necesarias de una incidencia sin revisar antes su conservación con el responsable.

MAIL-070 puede cerrar con una conclusión negativa si existe evidencia real suficiente y una decisión fundada. **Hoy no se cumple esa aceptación:** no hay participantes ni observaciones reales. Lo entregado es el procedimiento y los registros para ejecutarlo; no hacen falta cambios de código ni nuevas migraciones Supabase para esta preparación documental.
