# Módulos del monolito

La estructura sigue [MAIL-003](<../../docs/Resolucion Tareas Épica EPIC-00/MAIL-003-functional-architecture.md>). MAIL-005 reserva los directorios; la lógica se incorporará conforme avance cada ticket.

| Módulo          | Responsabilidad                                                   |
| --------------- | ----------------------------------------------------------------- |
| `auth`          | Identidad y sesión de la aplicación, separadas del OAuth de Gmail |
| `gmail`         | Autorización offline, lectura y creación de borradores            |
| `workflow`      | Orquestación, estados, idempotencia y revalidación                |
| `classifier`    | Intención y necesidad aparente de respuesta                       |
| `identity`      | Perfil de estilo y selección contextual de ejemplos               |
| `knowledge`     | Evidencia factual autorizada y vigente                            |
| `source-router` | Selección y prioridad de fuentes permitidas                       |
| `policy`        | Elegibilidad, riesgos, restricciones y autorización               |
| `response`      | Redacción a partir de estilo, contexto y evidencias               |
| `validator`     | Comprobaciones de formato, hechos y restricciones                 |
| `analytics`     | Métricas y metadatos operativos minimizados                       |

## Límites comunes

- Los módulos exponen contratos explícitos e inyectables; no dependen de detalles internos de otros módulos.
- El dominio compartido debe ejecutarse desde la web y desde un worker Node.js sin depender de React, handlers HTTP o `next/headers`.
- Identidad aporta estilo; conocimiento aporta hechos; políticas deciden qué acciones están permitidas. El modelo no concede permisos.
- La integración de Gmail solo permitirá las operaciones autorizadas por MAIL-003. No se implementarán envío, actualización de borradores ajenos ni borrado de mensajes.
- Cada operación privada comprueba el propietario, también desde el backend y el worker. Los detalles de persistencia y aislamiento se implementarán en MAIL-006/008.
- Los cuerpos de email, los ejemplos recuperados y los prompts se procesan de forma efímera; no se guardan en bases o logs por defecto. Solo se persistirán los datos mínimos permitidos por EPIC-00.
- Las credenciales se mantienen en backend/worker y no se exportan al navegador.
- Los correos y los documentos son datos no confiables; nunca sustituyen las instrucciones del sistema ni autorizan acciones.

Los contratos TypeScript de MAIL-003 son conceptuales. No se crean implementaciones vacías ni clientes de proveedores durante MAIL-005.
