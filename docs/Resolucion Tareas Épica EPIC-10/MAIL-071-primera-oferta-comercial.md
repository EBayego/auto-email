# MAIL-071 — Preparar la primera oferta comercial

Fecha: 1 de noviembre de 2026. **Oferta, landing y demostración preparadas; venta y cobro reales pendientes.** El propietario ha elegido validar **49 € por cuenta durante 30 días**, más los impuestos aplicables, sin renovación automática. No se ha desplegado la landing en la VPS, abierto un checkout, enviado una oferta a un cliente ni recibido un pago. Los pilotos de MAIL-069/070 aún no se han ejecutado.

## Qué se ha hecho

- Landing pública `/` con propuesta de valor, explicación de Gmail/documentos/estilo, demo, oferta, incorporación y enlace a privacidad.
- Demostración interactiva con datos ficticios: consulta → fuente autorizada → propuesta de borrador. Incluye un segundo recorrido donde falta la tarifa y no hay borrador. No conecta Gmail ni llama a OpenAI. Se identifica como simulación y no sustituye la prueba funcional real.
- Precio y alcance inicial en `src/modules/commercial/offer.ts`, versión `mail071-v1`, compartidos por la landing. No hay formulario de compra ni recogida de datos comerciales.
- Esta guía para presentar, incorporar, atender y cobrar de forma manual cuando corresponda.
- [Plantilla de propuesta y seguimiento de cliente](MAIL-071-propuesta-cliente-plantilla.md) y [modelo de costes y margen](MAIL-071-costes-y-margen.md). Las copias reales se guardan fuera de Git.

La oferta no presenta al producto como verificado por Google, no promete ahorro demostrado y muestra que la contratación/cobro todavía no están disponibles.

## 1. Oferta que se quiere validar

| Concepto                  | Propuesta inicial                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente objetivo          | Profesional o pequeña empresa B2B que responde personalmente consultas repetitivas en Gmail y dispone de documentación propia.                                                                    |
| Nombre                    | Validación profesional.                                                                                                                                                                           |
| Precio base               | **49 € por una cuenta durante 30 días**.                                                                                                                                                          |
| Impuestos                 | Se determinan para el cliente/operador antes de aceptar; comunicar base, impuestos y total. No hay tipo fiscal universal preconfigurado.                                                          |
| Periodo                   | Fechas de inicio y fin acordadas; no empieza por visitar la landing ni por pagar si el servicio aún no está preparado.                                                                            |
| Renovación                | Sin renovación ni cargo automático. Otro periodo requiere nueva confirmación. No se desarrolla un sistema de suscripciones.                                                                       |
| Cuenta                    | Una cuenta Auto Email y una cuenta Gmail por persona, sin buzón o estilo compartidos.                                                                                                             |
| Preparación de respuestas | Borradores con contexto del hilo, perfil individual, preferencias y fuentes elegidas; el titular revisa y envía.                                                                                  |
| Uso inicial               | Configuración de hasta **10 borradores al día UTC**, comprobación propuesta cada 300 segundos. Los dos primeros días de activación pueden limitarse a 5/día según MAIL-070.                       |
| Documentos                | Hasta 10 documentos de 10 MB: PDF con texto, TXT UTF-8 o DOCX. Fuentes/reglas/vigencia configuradas.                                                                                              |
| Incorporación             | Una sesión guiada de hasta 60 minutos usando las pantallas existentes; sin programación específica para cada cliente.                                                                             |
| Soporte                   | Canal privado identificado, horario y objetivo de primera respuesta pactados. Propuesta inicial: atención en días laborables y primera respuesta en un día laborable, sin SLA 24/7.               |
| Revisión de la prueba     | Una revisión de resultados de hasta 30 minutos dentro del periodo; registrar trabajo adicional para valorar viabilidad.                                                                           |
| Exclusiones               | Envío automático, CRM/ERP, Outlook, Drive integrado, OCR, gestión compartida empresarial y desarrollos a medida. Necesidades fuera de alcance se rechazan o presupuestan aparte en otra decisión. |

Este precio es una hipótesis comercial elegida por el propietario, **no un precio validado por compradores**. El piloto de investigación de MAIL-069/070 puede mantener sus condiciones gratuitas acordadas; no se convierte retroactivamente en un servicio de pago por publicar esta propuesta.

No vendas cantidad garantizada de respuestas, exactitud absoluta, cumplimiento certificado, disponibilidad continua, retención cero o ahorro porcentual demostrado. La creación depende de elegibilidad, evidencia y límites. El plazo de respuesta del modelo tampoco equivale a un compromiso de soporte.

### Qué significan realmente los límites

El límite diario, intervalo, tipos de correo, exclusiones y reglas se configuran en **Ajustes**. Los documentos tienen límites técnicos propios. Sin embargo, la aplicación **no tiene planes de facturación, cuota mensual comercial bloqueada ni caducidad automática por impago**. El usuario puede modificar varios de sus ajustes dentro de los máximos técnicos del producto; 10/día es la configuración acordada de esta oferta, no una autorización inmutable almacenada por un sistema de pagos.

El registro de periodos y la revisión de uso son manuales. El monitor operativo no es un motor de control de crédito o de gasto comercial. Si necesitas límites contractuales imposibles de superar o suspensión automática por fecha, queda trabajo adicional antes de ofrecer esa garantía. Tampoco existe una lista positiva de remitentes en la pantalla actual; remítete a los límites explicados en MAIL-069.

## 2. Explicarlo y demostrarlo en tres minutos

Guion breve para presentar la propuesta:

1. **0:00–0:30 · Necesidad.** «Si contestas consultas parecidas y buscas datos en documentos, Auto Email prepara una propuesta en tu Gmail para que tú la revises y envíes».
2. **0:30–1:30 · Flujo.** En la landing, pulsa **Ver cómo funciona**, después **Ver el contexto** y **Ver el resultado**. Explica la consulta ficticia de Atlas y la fuente. La cifra de 125 euros es del ejemplo de negocio ficticio, no otra tarifa de Auto Email.
3. **1:30–2:00 · Límite.** Marca **Probar qué ocurre si falta la tarifa** y repite el recorrido. Explica que una abstención exige atención humana y que un borrador debe revisarse aunque cite una fuente.
4. **2:00–2:30 · Control.** Describe permisos, proveedores informados, pausa, desconexión y borrado. En una sesión real, enseña esos controles sin ejecutar un borrado de demostración sobre su cuenta.
5. **2:30–3:00 · Propuesta.** 49 €/cuenta/30 días más impuestos aplicables, sin renovación automática, configuración y acompañamiento incluidos según alcance. Explica el estado pendiente si todavía no se puede vender.

Para una **demostración funcional real**, utiliza una cuenta de prueba autorizada del operador con mensajes ficticios y el servicio preparado:

- Conecta Gmail por el flujo real y revisa el estilo.
- Sube una ficha ficticia vigente, asígnala a una fuente y regla y comprueba su recuperación.
- Usa un mensaje nuevo de prueba, con límites y automatización configurados para esa cuenta. Comprueba en Actividad el resultado y abre el borrador en Gmail.
- Revisa hilo, destinatario y hechos; no envíes automáticamente ni sobreescribas un borrador manual. Pausa al terminar.
- Si grabas, evita contraseñas, códigos OAuth, tokens y contenido real ajeno. Una grabación con material de participantes exige el permiso correspondiente.

La demo de la landing es local y determinista. No la presentes como una llamada en directo a Gmail/IA ni como el vídeo de verificación de Google. El vídeo y el flujo real que Google pide se preparan según [MAIL-068](MAIL-068-publicacion-google-oauth.md).

## 3. Condiciones antes de comercializar

Estas condiciones siguen pendientes de comprobar en el destino real:

| Área                  | Evidencia necesaria                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operador              | Identidad/razón social, domicilio, contacto de privacidad y soporte y datos de facturación definidos.                                                                        |
| Privacidad            | Información pública, acuerdos y tratamiento real revisados; permisos operativos y derechos de usuarios preparados.                                                           |
| Google                | Autorizaciones aplicables al lanzamiento previsto, incluidos scopes restringidos y evaluación/excepción cuando corresponda. No basta cambiar Audience a In production.       |
| Producción            | VPS, dominio/HTTPS, SMTP, secretos, alertas, backups, restauración y reinicio real revisados según [MAIL-067](MAIL-067-despliegue-produccion.md).                            |
| Evidencia de producto | Al menos la evaluación y decisión de [MAIL-070](MAIL-070-ejecucion-evaluacion-piloto.md) para el alcance que se ofrecerá; ninguna conclusión de utilidad o ahorro inventada. |
| Economía              | Costes conocidos, escenario de soporte/onboarding y presupuesto para requisitos externos. Revisar el [modelo de margen](MAIL-071-costes-y-margen.md).                        |
| Oferta/contrato       | Alcance, precio total/impuestos, periodo, soporte, continuidad, retirada y condiciones de devolución/resolución revisadas para el caso.                                      |
| Operación de cobro    | Identidad fiscal y medio de cobro preparados; procedimiento de conciliación, factura y devolución probado sin dinero real cuando sea posible.                                |

Google exige revisión para los scopes restringidos y, cuando los datos se procesan desde servidores, requisitos adicionales de evaluación de seguridad salvo excepciones aplicables. Ver [verificación restringida](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification). El nombre «oferta de validación» no crea una excepción a esas obligaciones.

## 4. Cómo incorporar a un cliente sin desarrollo personalizado

1. Haz la entrevista y revisión de elegibilidad de [MAIL-069](MAIL-069-preparacion-usuarios-piloto.md). Descarta requisitos esenciales que el producto no cubre; no prometas resolverlos con programación incluida.
2. Rellena una copia privada de la [propuesta](MAIL-071-propuesta-cliente-plantilla.md): cuenta/alcance, casos, documentos, límites, fechas, base, impuestos, total, canal/horario de soporte y condiciones. Envías tú esa propuesta solo cuando corresponda; no se han enviado mensajes desde este trabajo.
3. Recoge aceptación expresa, autoridad profesional y acuerdos aplicables por un canal privado; conserva referencia y versión. No aceptes en nombre del cliente los permisos Gmail/privacidad.
4. Sigue el cobro acordado únicamente cuando se pueda prestar el servicio. Planifica la sesión y el inicio; si no hay condiciones para entregar, no recaudes por adelantado para financiar un bloqueo no resuelto.
5. El cliente crea su propia cuenta y configura **Primeros pasos → Mi estilo → Conocimiento → Ajustes**, con las instrucciones de MAIL-069. La sesión guiada usa funciones ya existentes, no acceso a infraestructura ni una cuenta compartida con el operador.
6. Mantén generación pausada hasta completar las comprobaciones y evaluación acordadas. Activa con 5/día inicialmente cuando proceda y hasta 10/día después de revisar los primeros resultados, sin ampliar todo el alcance a la vez.
7. Registra inicio y fin de los 30 días y programa revisión intermedia y final. La aplicación no fija esas fechas de facturación automáticamente; el operador las controla en el registro privado.
8. Dos días antes del fin, revisa continuidad con el cliente. Sin aceptación de otro periodo, no generes un nuevo cargo ni lo presentes como una renovación. Acordad pausa y gestión de datos; no borres información contractual o del usuario automáticamente por impago.

La intervención del operador es comercial/operativa: propuesta, configuración guiada, seguimiento y conciliación. Si el cliente necesita código a medida para obtener valor, no cumple la oferta inicial y debes detener o replantear ese alta.

## 5. Soporte, consumo e incidencias

Antes de cada alta identifica un canal privado real y su persona responsable; no publiques un correo inventado. El contacto de soporte y privacidad es `ebayego.ia@gmail.com`, publicado en la landing y preparado en la configuración. Siguen pendientes identidad legal, domicilio y revisión; no hay CTA de contratación ni formulario de captación.

Revisa diariamente durante las primeras cuentas: estado Gmail/worker/monitor, errores y omisiones, coste estimado y su cobertura, límites, cambios de configuración, documentos/vigencia y tiempo de soporte. Acordad el presupuesto y un umbral de revisión antes de activarlo. Al alcanzarlo, pausa el alcance afectado y revisa, sin cobrar excesos que no se hayan aceptado previamente. No describas ese control manual como un límite técnico instantáneo en euros.

Para soporte, utiliza alias, ID privado de Actividad, fecha y código, sin cuerpo del correo ni tokens. Sigue las categorías y acciones de MAIL-069/070. Ante datos ajenos, filtración, destinatario erróneo, envío inesperado, duplicado o afirmación crítica sin respaldo, pausa y trata el incidente con el responsable operativo/privacidad. La corrección y revisión preceden a cualquier reanudación. Los fallos de estilo se registran sin ocultar el original y se corrigen dentro de lo que permite la configuración.

Las condiciones de atención y compensación se revisan antes de la venta. No prometas 24/7, reembolsos arbitrarios o exenciones de responsabilidad que no se hayan evaluado. Como propuesta para revisar: si el servicio no puede iniciarse por un bloqueo propio no resuelto, devolver el importe cobrado y confirmar el cierre, respetando las obligaciones aplicables.

## 6. Forma sencilla de cobrar cuando se autorice

### Opción inicial: factura y transferencia

Permite empezar con las primeras cuentas sin guardar tarjetas ni implementar un sistema de suscripciones. Requiere configurar antes al operador y el sistema de facturación apropiado.

1. Confirma con tu asesoría identidad fiscal, impuestos del caso, obligaciones vigentes de factura electrónica/sistema de facturación y conservación. Una hoja o recibo manual no debe darse por suficiente para cualquier situación. Referencia: [AEAT, obligación de facturar](https://sede.agenciatributaria.gob.es/Sede/iva/facturacion-registro/facturacion-iva/obligacion-facturar.html).
2. Con la propuesta aceptada y el servicio entregable, emite la factura/documento procedente en tu herramienta de facturación conforme a esa revisión. Relaciona su referencia con la propuesta, periodo, base de 49 €, impuestos determinados y total. No incluyas IDs Gmail ni contenido de los mensajes.
3. Facilita por un canal privado los datos bancarios verificados del operador y la referencia de pago. No hay un IBAN en el repositorio ni se debe inventar uno. Comprueba cualquier cambio de destino bancario por un segundo canal.
4. Comprueba el abono en el banco; una captura enviada por el cliente no acredita por sí sola la recepción. Registra referencia/importe/fecha, sin copiar extractos completos a soporte o Git.
5. Marca el periodo como pagado una sola vez y realiza el alta guiada según el inicio pactado. El pago no crea cuenta, habilita Gmail ni inicia automatización en el código.
6. Para otro periodo, nueva confirmación y documento/cobro según proceda. Si hay devolución, registra la restitución y el documento rectificativo aplicable; no borres simplemente el registro original.

### Alternativa: pago alojado sin integración propia

Si prefieres tarjeta más adelante, Stripe ofrece [Invoicing para un cliente concreto](https://docs.stripe.com/invoicing) y [Payment Links para pagos mediante enlace](https://docs.stripe.com/payment-links). No se ha creado cuenta, producto, enlace ni credencial en este trabajo.

Configura identidad, banco, moneda EUR, impuestos y un concepto de **pago único de 49 € por 30 días**, con el total que corresponda. Prueba primero en su entorno de pruebas pago correcto, fallo y devolución. Para altas revisadas es preferible un documento/enlace individual, evitando un enlace público que permita pagar a alguien no elegible.

La conciliación inicial puede hacerse manualmente en el panel del proveedor. No actives cuentas por la URL de retorno del navegador ni por un email/captura de «pago correcto». Valida la operación real, importe, moneda, referencia del cliente y que no se haya utilizado antes; luego aplica el mismo alta manual. No envíes a Stripe contenido Gmail, tokens, documentos de conocimiento ni metadatos de mensajes. Si se automatiza en el futuro, habrá que implementar verificación de eventos, idempotencia y acceso comercial; eso no está incluido ni se afirma disponible ahora.

Revisa las comisiones y el coste adicional de facturación del proveedor antes de elegirlo. Un recibo de pago o factura del proveedor no acredita por sí solo el cumplimiento de todas tus obligaciones fiscales locales.

## 7. Lo que tienes que hacer tú, en orden

1. Completar operador, contacto y revisión legal/fiscal. Elegir herramienta de facturación y medio de cobro.
2. Seleccionar e incorporar los participantes con MAIL-069 y ejecutar MAIL-070. Mantener separados resultados del piloto y argumentos de venta todavía hipotéticos.
3. Activar producción y cerrar las autorizaciones del tipo de lanzamiento. La VPS/dominio siguen para el final acordado.
4. Rellenar costes reales y decidir si se sostiene el precio de 49 €, especialmente con solo dos o tres usuarios y el coste de incorporación/evaluación externa.
5. Revisar la plantilla con un primer cliente elegible, completar total/impuestos, condiciones y soporte y obtener aceptación expresa.
6. Probar facturación/conciliación, preparar las fechas de servicio y cobrar solo cuando se pueda entregar.
7. Incorporar sin código específico, observar uso y margen por periodo y decidir si mantener, ajustar o retirar la oferta. Un precio distinto requiere una nueva propuesta aceptada; no cambia silenciosamente una ya acordada.

Si cambias precio/límites de la propuesta futura, actualiza `src/modules/commercial/offer.ts`, el texto de esta guía y la plantilla, comprueba la landing y conserva la versión ya aceptada por cada cliente. Para retirar el aviso de verificación pendiente o abrir contratación hay que revisar evidencias reales; no basta modificar un booleano o una frase.

## Estado de aceptación

Validación local: formato, lint, tipos, cobertura unitaria y compilación correctos; 2.240 pruebas unitarias y 22 end-to-end superadas. La oferta y ambos recorridos de la demo se han comprobado en Chromium a 1280 y 390 píxeles, sin escrituras de red durante la interacción y sin desbordamiento horizontal. Las capturas se han revisado visualmente. Enlaces/tablas de la documentación y aritmética del escenario económico comprobados; los números del escenario siguen siendo hipotéticos.

| Criterio                                 | Preparación realizada                                                                      | Validación externa pendiente                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Explicar/demostrar en pocos minutos      | Landing, demo ficticia y guion de tres minutos.                                            | Prueba funcional en la VPS/cuenta autorizada y respuesta de clientes.     |
| Oferta económica clara                   | 49 €/cuenta/30 días, impuestos por concretar, sin renovación automática, alcance definido. | Total fiscal, condiciones revisadas, aceptación y rentabilidad observada. |
| Incorporación sin desarrollo obligatorio | Recorrido estándar y plantillas de alta/soporte/cobro.                                     | Primeras incorporaciones y conciliación reales, autorizadas.              |

La preparación de MAIL-071 no convierte EPIC-10 en un lanzamiento ya desplegado, verificado o validado comercialmente. Las dependencias externas y el trabajo con usuarios reales están expresamente pendientes. Esta tarea no requiere cambios de esquema ni migraciones Supabase.
