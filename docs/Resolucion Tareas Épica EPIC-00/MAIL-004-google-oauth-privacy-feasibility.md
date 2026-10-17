# MAIL-004 — Informe de viabilidad: Google OAuth, políticas de Gmail, privacidad y lanzamiento

**Fecha de verificación:** 14/10/2026 · **Versión:** 1.0 · **Tipo:** Spike de investigación · **Estado:** investigación concluida; aprobaciones externas y asesoramiento jurídico pendientes.

> **Resultado:** técnicamente viable y el caso de uso encaja de forma razonable en la categoría de aplicaciones que mejoran la productividad del email. **La distribución pública de un SaaS que lee y procesa correos en servidores externos NO debe presupuestarse como un trámite menor**: necesitará verificación de scopes restringidos y normalmente evaluación de seguridad de un tercero aprobado por Google, además de la conformidad contractual y legal. Esta conclusión no constituye aprobación de Google ni dictamen jurídico.

## 1. ¿Está permitido el producto conforme a la política de Gmail?

**Sí, como hipótesis razonable sujeta a revisión.** La política oficial autoriza, entre otros, clientes de correo y aplicaciones que mejoran la experiencia de correo con fines de productividad, incluyendo aplicaciones CRM, envío diferido y resúmenes de IA generativa. Nuestro producto se describe como «preparación automatizada de borradores para el titular de Gmail», no como exportación masiva ni venta de datos. La plataforma debe operar con fin visible para el usuario y dentro de los permisos autorizados.

**No permitimos:** venta/reventa de mensajes, publicidad basada en mensajes, determinar solvencia, scraping, crear bases de datos permanentes de emails, entrenar/mejorar modelos generales con el historial de usuario, o personalización de otros clientes utilizando datos de una cuenta.

Fuente: https://developers.google.com/workspace/workspace-api-user-data-developer-policy

## 2. Scopes concretos (decisión)

| Scope | Clasificación Google | Para qué | Decisión |
|---|---|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | Restringido | Leer enviados, inbox, cuerpos e hilos | **Pedir** |
| `https://www.googleapis.com/auth/gmail.compose` | Restringido | Crear/consultar drafts; también permite enviar | **Pedir** |
| `https://www.googleapis.com/auth/gmail.modify` | Restringido | Leer, enviar, gestionar/modificar correo más ampliamente | **No pedir** |
| `https://mail.google.com/` | Restringido | Acceso amplio con borrado permanente | **Nunca pedir en MVP** |
| `https://www.googleapis.com/auth/gmail.send` | Sensible | Enviar; sin lectura ni finalidad de draft | **No pedir** |
| `https://www.googleapis.com/auth/gmail.metadata` | Restringido | Metadatos, no cuerpo; no basta para aprender estilo | **No pedir** |
| `https://www.googleapis.com/auth/drive...` | Según scope | Integración futura Drive | **No pedir aún** |

**Matiz muy importante:** Google **no ofrece un permiso OAuth restringido exclusivamente a crear borradores y que impida técnicamente enviarlos** en este flujo. `gmail.compose` autoriza administrar drafts **y enviar**. Nuestra garantía de «no autoenvío» se implementará por diseño: no incluir `users.messages.send` o `users.drafts.send`, denegar acciones peligrosas en el servicio de Gmail, tests de contrato y auditoría. Nunca afirmar al usuario que el token es «sin permisos de enviar».

Fuente scopes: https://developers.google.com/workspace/gmail/api/auth/scopes

Comprobaciones de endpoints:
- Leer mensajes: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- Crear draft: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create
- Responder en hilo: https://developers.google.com/workspace/gmail/api/guides/threads

### Por qué no usar un Gmail Add-on para reducir scopes

Los scopes de add-on que actúan **cuando el usuario interactúa con el complemento** no reemplazan automáticamente el requisito del producto de analizar el historial de enviados y preparar borradores en segundo plano, incluso con Gmail cerrado. Un add-on manual sería un producto con experiencia de uso diferente. **Decisión:** API Gmail + OAuth de servidor.

## 3. Configuración OAuth de desarrollo y producción

### 3.1 Desarrollo / PoC

1. Google Cloud Project **solo de desarrollo**.
2. Activar Gmail API y configurar Google Auth Platform.
3. Audiencia `External` con estado `Testing` para cuentas externas autorizadas; agregar los testers explícitamente.
4. Crear OAuth Client ID adecuado (web para backend o cliente instalado para script local de prueba); configurar redirect URIs legítimas.
5. Solicitar únicamente `gmail.readonly` y `gmail.compose`, además de los mínimos identificadores de login necesarios cuando se habilite sesión web.
6. Solicitar `access_type=offline` para disponer de refresh token en worker; almacenar cifrado en el backend y no en navegador.
7. Probar rechazo de scopes, reconexión, revocación y expiración.

**Limitaciones documentadas:** OAuth `External` + `Testing` admite hasta **100 usuarios de prueba**, y los refresh tokens suelen expirar a los **7 días** si se solicitan scopes de Gmail (no solamente perfil básico). Existen excepciones y posibles controles administrativos de Workspace (por ejemplo, configuración `Trusted`); no asumirlas aplicables a todas las cuentas.

Fuentes:
- https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- https://developers.google.com/identity/protocols/oauth2/
- https://developers.google.com/identity/protocols/oauth2/web-server

### 3.2 Producción pública

1. Proyecto Google Cloud de **producción independiente**; no reutilizar callbacks de localhost.
2. Dominio propio validado; web pública que describa el producto, acceso a privacidad y datos de soporte.
3. Política de privacidad coherente con acceso, uso, almacenamiento, proveedores, borrado y Limited Use.
4. Branding OAuth publicado y verificado; scopes correctamente declarados y justificados.
5. Vídeo de demostración **real** de conexión y uso de **cada scope**; Google puede exigir mostrar consentimiento y funcionalidades en inglés durante revisión.
6. Solicitud de verificación restringida y respuesta a observaciones de Google.
7. Si el sistema accede a datos restringidos **desde o a través de servidores de terceros** y no aplica una excepción reconocida, **evaluación de seguridad por tercero aprobado por Google** con marco CASA. En general se reevalúa **al menos cada 12 meses**.
8. Verificar política de Workspace de clientes empresariales; los administradores de dominio pueden bloquear apps externas aun verificadas.

**Plazo:** Google indica que la verificación restringida puede tardar **varias semanas**; no se garantiza una duración ni precio fijo. La auditoría de seguridad añade presupuesto externo cuya cuantía exige cotización actual. El riesgo económico NO está cerrado hasta recibir confirmación/cotización del evaluador correspondiente.

Fuentes:
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance

## 4. Política de Google Workspace «Limited Use» aplicada al MVP

Con los datos obtenidos de Gmail:

- Utilizarlos **únicamente** para generar y mejorar las respuestas y funciones visibles para ese usuario concreto.
- Transferirlos a OpenAI **solo** en la medida necesaria para la función y con información/consentimiento del usuario conforme a los requisitos de Google; documentar proveedor y usos en privacidad.
- No permitir lectura humana del contenido salvo consentimiento expreso para casos específicos, seguridad o cumplimiento legal (y demás excepciones de la política).
- No crear bases de datos permanentes de mensajes ni conservar cachés más tiempo del permitido.
- No reutilizar perfiles, ejemplos o correcciones de un cliente para otro, ni entrenar modelos generales con contenido procedente de Gmail.
- Sí se contempla la **personalización individual** del usuario en el caso de uso permitido, sin inferir que esa excepción autoriza retener cualquier cantidad de contenido indefinidamente.
- Incluir declaración de Limited Use en política/sitio web.

**Decisión técnica derivada:** no copiar el buzón a Supabase. Mantener resumen de estilo minimizado y referencias a emails; recuperar ejemplos pertinentes bajo demanda. Todo lo extraído de Gmail para procesar un trabajo queda en memoria temporal y se descarta tras completar el trabajo, salvo metadatos mínimos justificados. Diseño sujeto a revisión para confirmar periodos y adecuación de perfiles derivados.

Fuente: https://developers.google.com/workspace/workspace-api-user-data-developer-policy

## 5. OpenAI API y condiciones de tratamiento

- Según OpenAI, los datos enviados a la API **no se utilizan para entrenar modelos por defecto**, salvo adhesión explícita a compartirlos.
- La API puede mantener **logs de prevención de abuso hasta 30 días** con ciertas excepciones; no confundir «no entrenamiento» con «retención cero».
- Con `/v1/responses`, utilizar `store: false` para evitar mantener el estado de aplicación cuando sea compatible. Esto **no elimina** por sí solo la retención asociada a logs de abuso ni todos los mecanismos de procesamiento/caché.
- Valorar elegibilidad de **Zero Data Retention**/Modified Abuse Monitoring según el perfil de cliente, sin asumir que está disponible para toda cuenta o endpoint.
- Evitar estados persistentes de conversaciones y vector stores del proveedor para datos Gmail en esta primera versión.
- Revisar documentación contractual, ubicación de procesamiento, posibles transferencias y subencargados antes del uso con datos reales de clientes.

Fuentes:
- https://developers.openai.com/api/docs/guides/your-data
- https://openai.com/es-ES/enterprise-privacy/

## 6. RGPD: mapa de responsabilidad y bases legales

**Modelo B2B esperado:**
- La **empresa cliente** suele determinar para qué trata datos de su correspondencia profesional; normalmente será **responsable del tratamiento** de los emails profesionales que controla.
- Nuestra empresa suele tratar esos datos **por cuenta del cliente**, por lo que actuará como **encargada** del tratamiento para la función de correos. También puede ser responsable independiente de datos propios de facturación/operación (analizar por flujo).
- OpenAI, alojamiento y almacenamiento son proveedores relevantes, con relaciones de encargo/subencargo que deben documentarse en acuerdos adecuados.
- El **consentimiento OAuth del titular** autoriza técnicamente a la app ante Google, pero **no sustituye automáticamente** la base jurídica del RGPD para tratar datos de remitentes, destinatarios, terceros o empleados.
- La base jurídica concreta depende del contexto (contrato, interés legítimo con ponderación, consentimiento cuando proceda, etc.); debe establecerla el responsable con asesoramiento aplicable. Una cuenta personal plantea un mapa diferente del correo empresarial.

**Documentación jurídica y contractual para antes del piloto externo:**
1. Identificación de responsables y encargados por flujo.
2. Acuerdo de encargo art. 28 RGPD entre cliente y operador, cuando corresponda, con subencargados.
3. Registro de actividades y obligaciones de información pertinentes.
4. Base jurídica y evaluación del interés legítimo cuando se utilice.
5. Análisis de transferencias fuera del EEE y garantías (adecuación/SCC y otras medidas según sea necesario).
6. Análisis de riesgos y **EIPD** si el tratamiento presenta alto riesgo; no declarar EIPD universal obligatoria sin valorar contexto, sensibilidad y escala.
7. Procedimientos de ejercicio de derechos y eliminación, incluidas copias de respaldo.
8. Medidas organizativas de confidencialidad y acceso humano restringido.

Fuentes:
- https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en
- https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en
- https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/realizacion-de-evaluaciones-de
- https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en

## 7. Retención — política técnica PROPUESTA para el piloto (sujeta a evaluación legal)

| Categoría | Decisión inicial | Borrado/desconexión | Observaciones |
|---|---|---|---|
| Cuerpos y MIME de Gmail | **No persistir**; procesamiento efímero | Descartar al finalizar trabajo | Nunca guardar en logs/APM |
| Ejemplos de estilo | Referenciar IDs; extraer bajo demanda | Dejar de acceder tras revocación | Texto de ejemplo solo en memoria |
| Perfil de estilo derivado | Guardar versión y preferencias minimizadas mientras se use el servicio | Borrar cuando lo pida el usuario; al desconectar, ofrecer borrado inmediato | Puede contener datos personales; no entrenamiento cruzado |
| IDs Gmail, jobs, drafts | Guardar referencias necesarias; objetivo provisional **90 días** para diagnóstico | Purga según instrucción válida y política | Justificar y reducir si la evaluación lo exige |
| Logs operativos sin contenido | Máximo provisional **30 días** | Purga automatizada | Incluye errores categóricos; no prompts |
| Documentos subidos manualmente | Mientras estén activos o hasta baja | Borrar objeto y chunks | No son copias automáticas de Gmail |
| Credenciales OAuth | Mientras cuenta conectada y habilitada | Revocación y eliminación segura | Tokens cifrados y acceso limitado |
| Backups de datos propios | Ventana máxima propuesta **30 días** | Expiración/propagación de supresión documentada | Evitar restaurar datos eliminados |
| Textos para comparar ediciones | **Deshabilitado por defecto** durante PoC; habilitar solo con autorización y retención específica en Beta | Purga automática | Evaluar si se puede medir sin almacenar contenido íntegro |

**Estos plazos son decisiones provisionales de diseño, no reglas impuestas por Google o el RGPD.** Deben ajustarse tras evaluación de necesidad, cachés autorizadas y acuerdos antes de tratar cuentas comerciales.

## 8. Medidas de seguridad que condicionan la arquitectura

1. HTTPS/TLS, secretos en gestor adecuado, refresh tokens cifrados, rotación y revocación.
2. Separar entornos dev/staging/prod con credenciales y bases distintas.
3. Validar propietario y acceso a fuentes **en cada consulta**; RLS y checks server-side.
4. No exponer payloads de Gmail en logs, traces, error tracking ni herramientas de analítica.
5. No permitir al LLM ejecutar métodos de Gmail ni invocar herramientas no autorizadas.
6. Bloquear `send` a nivel de código/API propia y mediante tests de integración; no afirmar que OAuth lo impide.
7. Listas de exclusión, whitelist opcional de remitentes, modo pausa, limites diarios y kill switch.
8. Datos de prueba sintéticos o anonimizados por defecto; acceso explícito y auditado al contenido real cuando sea imprescindible.
9. Backups cifrados, prueba de restauración y procedimiento de gestión de incidentes.
10. Permitir al usuario controlar el análisis inicial del historial (ventana temporal, fuentes, exclusiones y solicitud de eliminación).

## 9. Registro de riesgos y decisión

| ID | Riesgo | Impacto | Probabilidad inicial | Mitigación | Puerta de decisión |
|---|---|---|---|---|---|
| R-01 | Auditoría Google costosa o lenta | Alto | Media/alta | Cotizar evaluación y revisar alcance pronto | **No abrir públicamente sin presupuesto y verificación** |
| R-02 | OAuth externo testing caduca cada 7 días | Medio | Alta en pruebas | Reautorización prevista; casos excepcionales Workspace según corresponda | No confundir piloto con producción |
| R-03 | Permisos `gmail.compose` incluyen envío | Alto | Inherente | No implementar send, pruebas y auditoría | Ningún método send en servidor |
| R-04 | Copia permanente de correos contraria a políticas | Alto | Media sin mitigación | Procesar efímero, perfiles derivados, no sync masivo persistente | Revisar modelo de datos |
| R-05 | Transferencias a OpenAI sin documentación suficiente | Alto | Media | DPA, información, consentimiento aplicable, retención configurada | Validación previa al piloto |
| R-06 | Emails de terceros contienen datos sensibles | Alto | Media | Exclusiones, minimización, segmentación del piloto | Evitar salud/otros casos de riesgo elevado inicialmente |
| R-07 | Conocimiento no actualizado provoca promesas falsas | Alto | Media | Reglas de fuentes, vigencia, abstención | Bloquear drafts críticos no fundamentados |
| R-08 | Aislamiento insuficiente entre usuarios | Crítico | Baja/media sin tests | FKs, RLS, server checks, fixtures multicliente | Pruebas bloqueantes |
| R-09 | Un admin Workspace bloquea acceso | Medio/alto | Variable | Detectar política administrativa, instrucciones al cliente | Elegibilidad del piloto |
| R-10 | EIPD o requisitos laborales/sectoriales | Medio/alto | Variable | Análisis jurídico por cliente y sector | Antes de sectores sensibles |

## 10. Plan operativo de verificación (concreto)

### Antes de escribir la integración (P0)
- [x] Identificados los scopes y su clasificación.
- [x] Justificado el caso de productividad.
- [x] Identificada la obligación probable de evaluación de seguridad para un SaaS público con backend.
- [x] Definido diseño de minimización, restricciones del modelo y política técnica provisional.

### En Google Cloud, cuando se creen credenciales (MAIL-011/012)
- [ ] Crear proyecto de desarrollo con scopes escogidos.
- [ ] Registrar testers; verificar consentimientos y caducidad real de refresh tokens.
- [ ] Probar Gmail `messages.list`, `threads.get`, `drafts.create` con cuenta de prueba.
- [ ] Comprobar Workspace admin policies si un piloto usa dominio corporativo.
- [ ] Comprobar comportamiento de revocación/desconexión.

### Antes del piloto externo (MAIL-061/062/069)
- [ ] Revisión jurídica de rol, bases legales, contratos y transferencia internacional.
- [ ] Política de privacidad y Limited Use statement visibles.
- [ ] DPA/subencargados/retención de OpenAI/Supabase revisados.
- [ ] Validación de protección de datos: eliminación y aislamiento entre usuarios.
- [ ] Confirmar si cuentas piloto y modalidad constituyen entorno de prueba permitido y qué excepciones aplican.

### Antes del lanzamiento público (MAIL-068)
- [ ] Branding, dominio y privacy policy verificados.
- [ ] Vídeo real y justificación de scopes preparados.
- [ ] Solicitud de verificación de Google completada y aprobada.
- [ ] Evaluación CASA completada si se exige; plan de reevaluación anual.
- [ ] Administradores de Workspace informados de permisos y políticas.
- [ ] Costes de cumplimiento incluidos en proyección económica.

## 11. Decisión final y preguntas que no se pueden cerrar documentalmente

**GO para PoC local con cuentas de prueba autorizadas.**

**GO CON CONDICIONES para piloto privado acotado:** acuerdos y controles apropiados, participantes autorizados, valoración de tratamiento y límites de Google.

**NO-GO para comercialización pública hasta verificación de OAuth, seguridad y condiciones legales aplicables.**

**Queda expresamente pendiente (no investigable solo mediante documentación pública):** aprobación específica de la app por Google, cotización concreta de evaluador CASA, evaluación contractual efectiva de cada proveedor/cliente, base jurídica de cada cliente, si se exige EIPD en su contexto particular y configuración de la cuenta Google Workspace administrada. Ninguna de estas decisiones puede declararse resuelta sin terceros o datos futuros.

## 12. Fuentes oficiales consultadas (14/10/2026)

1. Gmail OAuth scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
2. Gmail API developer policy: https://developers.google.com/workspace/workspace-api-user-data-developer-policy
3. Verificación scopes restringidos: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
4. OAuth estado de la aplicación: https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
5. OAuth tokens y caducidad: https://developers.google.com/identity/protocols/oauth2/
6. OAuth para servidores: https://developers.google.com/identity/protocols/oauth2/web-server
7. API Gmail drafts: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create
8. OpenAI API, uso de datos y retención: https://developers.openai.com/api/docs/guides/your-data
9. OpenAI, privacidad empresarial: https://openai.com/es-ES/enterprise-privacy/
10. Comisión Europea, roles GDPR: https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en
11. Comisión Europea, bases jurídicas: https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en
12. AEPD, evaluación de impacto: https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/realizacion-de-evaluaciones-de
13. Comisión Europea, transferencias internacionales: https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/rules-international-data-transfers_en
