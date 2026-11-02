# MAIL-071 — Costes y margen de la oferta de 49 €

Precio elegido: **49 € de base por cuenta y periodo de 30 días**, antes de impuestos y sin renovación automática. **El margen real todavía es desconocido:** no hay piloto ejecutado, facturas de operación conciliadas ni cotización de los requisitos externos que permita validarlo. Este documento define el cálculo y muestra un escenario hipotético, no una previsión de beneficio.

## Qué debes medir

Todos los costes deben referirse al mismo periodo de 30 días y a la misma moneda. Convierte costes mensuales/anuales de forma documentada, con criterio constante. Si hay USD, guarda importe original, tipo y fecha de conversión a EUR; no asumas paridad. Los impuestos se tratan según su recuperación y situación real con la asesoría, no se incluyen automáticamente como ingreso propio.

| Partida | Cómo obtenerla | Estado actual |
| --- | --- | --- |
| IA por persona | Consumo de clasificación, generación/validación, análisis de estilo y otras llamadas, con tarifas reales del modelo. Conciliar con proveedor. | Desconocido; las tarifas de ejemplo no están rellenadas. |
| Infraestructura fija | Parte atribuible de VPS, dominio, monitorización, herramientas y operación. Tener VPS para varios proyectos no implica coste cero. | Pendiente de reparto y costes reales. |
| Supabase y Storage | Plan, consumo incremental, almacenamiento y transferencia atribuibles. Un único proyecto compartido exige un reparto sin doble conteo. | Pendiente. |
| Backups | Almacenamiento externo, tráfico/operaciones, restauraciones de comprobación y custodia de claves. | Destino/costes pendientes. |
| Evaluación y cumplimiento | Evaluación de seguridad de Google cuando corresponda, renovaciones, asesoría y otros costes aplicables. Cotización y asignación documentadas. | No contratado ni cotizado; no tratarlo como cero. |
| Cobro | Comisiones reales, costes de factura/proveedor, devoluciones y contracargos si existen. | Medio pendiente. |
| Soporte recurrente | Minutos reales por usuario × coste/hora del operador. Incluye diagnóstico y mantenimiento de fuentes. | Sin medir. |
| Incorporación | Sesión inicial y preparación real por usuario, valoradas a coste/hora. | Sin medir; no asumir retención de varios periodos para repartirla. |
| Coste de investigación | Pruebas retrospectivas, entrevistas y correcciones de producto separadas del uso habitual. | Sin medir. |

El panel de Métricas contiene un subtotal estimado de generaciones con tarifa y cobertura conocida, no toda la factura de IA ni todos los costes del negocio. No sumes ese subtotal otra vez al total conciliado del proveedor. Una generación sin consumo/tarifa es dato desconocido, no coste cero. Un borrador creado tampoco es necesariamente usado ni útil.

## Fórmulas

Para un periodo de 30 días:

- `P = 49`: ingreso base por cuenta, antes de impuestos.
- `N`: cuentas que pagan ese periodo, no candidatos ni usuarios gratuitos.
- `V`: coste variable recurrente por cuenta: IA + parte variable de almacenamiento/backups + cobro + soporte recurrente + otros costes atribuibles por cuenta.
- `F`: costes fijos atribuibles del periodo, incluidos requisitos externos amortizados con un criterio explícito.
- `O`: coste de incorporación de una cuenta nueva.
- `I`: investigación/desarrollo extraordinario del periodo, separado de lo recurrente.

```text
Contribución por cuenta antes de fijos = P − V
Coste recurrente completo por cuenta = V + F / N
Resultado recurrente por cuenta = P − V − F / N
Margen recurrente = (P − V − F / N) / P
Resultado del primer periodo por cuenta nueva = P − V − F / N − O
Resultado conjunto del periodo = N × (P − V) − F − nuevas_cuentas × O − I
Punto de equilibrio recurrente = techo(F / (P − V)), solo si P > V
```

Si `N=0`, no hay margen por cuenta calculable. Si `P<=V`, incorporar más cuentas no resuelve el coste variable: hay que cambiar precio, coste o alcance. Si falta una partida esencial, informa el subtotal conocido y deja el margen completo como **no disponible**. Distingue margen operativo de beneficio fiscal o caja; este modelo no los certifica.

## Ejemplo exclusivamente hipotético

Supuestos inventados para comprobar la aritmética; **no son tarifas de proveedores ni datos del piloto**:

- IA y procesamiento variable: 3 €/cuenta/periodo.
- Almacenamiento/tráfico variable: 1 €.
- Cobro: 1 €.
- Soporte recurrente: 20 minutos a 30 €/hora = 10 €.
- Total variable `V = 15 €`.
- Costes fijos atribuibles supuestos `F = 150 €` por 30 días. Este número representa un supuesto completo: habría que sustituirlo por VPS/repartos/operación/evaluación y demás importes reales; si una partida está sin cotizar, no está validado.
- Incorporación `O = 60 minutos × 30 €/hora = 30 €` por cuenta nueva.
- Investigación extraordinaria no incluida en la tabla; se restaría aparte al resultado conjunto.

| Cuentas de pago N | Coste fijo por cuenta F/N | Coste recurrente completo | Resultado recurrente por cuenta | Margen recurrente | Resultado del primer periodo con incorporación |
| --- | --- | --- | --- | --- | --- |
| 2 | 75,00 € | 90,00 € | −41,00 € | −83,67 % | −71,00 € |
| 5 | 30,00 € | 45,00 € | 4,00 € | 8,16 % | −26,00 € |
| 10 | 15,00 € | 30,00 € | 19,00 € | 38,78 % | −11,00 € |

En ese escenario, el equilibrio recurrente sería `techo(150 / 34) = 5` cuentas. **No** incluye recuperar automáticamente la incorporación o el desarrollo. Con diez cuentas nuevas, el resultado conjunto antes de investigación sería `10 × 34 − 150 − 10 × 30 = −110 €` en su primer periodo. El resultado positivo recurrente presupone que vuelven a pagar otro periodo y que se mantienen los costes; esa continuidad no está validada.

Si el coste de evaluación/cumplimiento real o el tiempo de soporte son mayores, puede cambiar por completo la decisión. No uses este ejemplo para afirmar que con cinco clientes ya es rentable el negocio real.

## Hoja de trabajo para copiar al registro privado

| Campo | Valor real por completar | Evidencia y periodo |
| --- | --- | --- |
| Cuentas pagadoras / nuevas / gratuitas | Pendiente | Pendiente |
| Ingreso base cobrado y devoluciones | Pendiente | Facturas y conciliación |
| Coste IA y cobertura desconocida | Pendiente | Proveedor y registros |
| Otros variables y comisiones | Pendiente | Facturas/reparto |
| Horas de soporte recurrente y coste/hora | Pendiente | Registro de tiempos |
| Costes fijos atribuibles completos | Pendiente | Repartos, contratos y cotizaciones |
| Incorporación real | Pendiente | Minutos por alta |
| Investigación/desarrollo separado | Pendiente | Registro propio |
| Tipo de cambio y tratamiento de impuestos/costes | Pendiente | Criterio documentado |
| Resultado por cuenta y conjunto | No calculable todavía | Completar tras las partidas anteriores |
| Decisión sobre precio/alcance | Pendiente | Responsable y fecha |

Revisa el cálculo antes de la primera venta y al cierre de cada uno de los primeros periodos. Si el precio no se sostiene, ajusta una oferta futura, alcance o costes con evidencia; no ocultes el trabajo del operador ni cambies condiciones ya aceptadas sin acuerdo.
