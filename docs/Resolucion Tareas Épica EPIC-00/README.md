# EPIC-00 — Definición funcional y alcance de Gmail AI

**Fecha:** 14 de octubre de 2026 · **Versión:** 1.0 · **Origen:** análisis de mercado suministrado + documentación oficial contrastada.

## Archivos

| Ticket | Documento | Estado |
|---|---|---|
| MAIL-001 | [MAIL-001-mvp-scope.md](MAIL-001-mvp-scope.md) | Especificación funcional y exclusiones decididas |
| MAIL-002 | [MAIL-002-use-cases-and-business-rules.md](MAIL-002-use-cases-and-business-rules.md) | 35 escenarios y reglas de aceptación definidos |
| MAIL-003 | [MAIL-003-functional-architecture.md](MAIL-003-functional-architecture.md) | Diagrama, módulos, contratos y persistencia definidos |
| MAIL-004 | [MAIL-004-google-oauth-privacy-feasibility.md](MAIL-004-google-oauth-privacy-feasibility.md) | Investigación oficial completada; verificaciones y asesoría pendientes |

## Principales decisiones aprobadas de producto

1. Solo Gmail, un usuario por cuenta y hasta una cuenta Gmail por usuario en el piloto.
2. Solo creación de drafts y revisión humana; sin auto-send.
3. Identity Memory separada de Knowledge y Policy Engine.
4. No copiar el histórico de Gmail en una base persistente; procesar efímero y guardar metadatos/perfiles minimizados.
5. PoC local primero; worker automático e interfaz después; integraciones Drive/WhatsApp fuera.
6. Riesgo bloqueante: verificación de scopes restringidos y posible evaluación de seguridad Google para SaaS público.
7. No confundir OAuth con base jurídica del RGPD ni garantía técnica de imposibilidad de enviar.

## Fuente interna principal

Archivo aportado por el usuario: `Análisis de mercado y viabilidad de una plataforma de IA que responde emails y WhatsApps con la voz .pdf` (25 páginas).

Referencias clave: página 5 (intersección identidad-relación-contexto-fuentes-autonomía); páginas 9–14 (capas de producto y drafts); páginas 19–21 (privacidad y precisión); páginas 21–23 (lanzamiento draft-first y visión del sistema).

## Cómo trasladar a Jira

- Una historia/tarea Jira por documento (`MAIL-001` a `MAIL-004`).
- Descripción: propósito/alcance; criterios de aceptación: sección final de cada archivo.
- Adjuntar documentos en Jira o enlazarlos desde el repositorio `docs/product` / `docs/compliance`.
- Marcar tareas de **especificación/investigación** como resueltas; no marcar la aprobación de OAuth, tests, implementación ni asesoría como completadas.
- Dependencias inmediatas: `MAIL-005` inicialización repo y `MAIL-011` proyecto Google Cloud. La validación de política y permisos de MAIL-004 debe acompañar cada cambio de scopes.

## Riesgos todavía abiertos

Son validaciones que requieren acciones externas, no documentación adicional: Google debe verificar la app pública y confirmar el alcance de su evaluación; un asesor debe revisar condiciones legales por cliente; se necesitan DPA/condiciones de los proveedores y cotización de auditoría; se debe comprobar el acceso de cada cuenta Workspace piloto.
