# Testing

MAIL-005 instala Vitest y prepara el alias `@/` hacia `src/` con entorno Node. El runner descubre `src/**/*.test.ts`, `src/**/*.test.tsx` y sus equivalentes dentro de `tests/`.

Actualmente hay **cero tests de aplicación en Vitest**. `npm run test` ejecuta `vitest run --passWithNoTests`; su salida correcta no acredita comportamiento de negocio ni cobertura. No se añaden pruebas triviales sobre una página estática solo para producir un resultado verde.

MAIL-006 incorpora **47 tests SQL pgTAP** en `supabase/tests/mail006_schema.test.sql`: integridad de relaciones, unicidad, valores por defecto, estados, timestamps, permisos, RLS y borrados en cascada. Después de `npm run db:start` y `npm run db:reset`, se ejecutan con `npm run db:check`. Necesitan Docker y la base temporal local; no se incluyen en `npm run check` para mantener la verificación de la aplicación independiente de la base de datos.

MAIL-010 incorporará las primeras pruebas relevantes, fixtures sintéticos, dobles de proveedores y CI. Al introducir la suite se retirará `--passWithNoTests`. Los tickets con lógica de negocio deberán probar sus casos relevantes, incluidos fallos y restricciones; no se utilizarán cuentas, credenciales ni correos reales en fixtures.

En esta entrega, la verificación consiste en formato, lint, typecheck, compilación, instalación reproducible y comprobación HTTP de la página en desarrollo y producción local. El procedimiento está en el README de la raíz.
