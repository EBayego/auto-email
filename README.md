# Auto Email

**Pendientes visibles: [TODO — próximos pasos y mejoras](TODO-PROXIMOS-PASOS.md). Copias de seguridad aplazadas: primera prioridad pendiente; configuración local `BACKUP_MODE=deferred`.**

Asistente para Gmail que prepara borradores con el estilo del usuario y contexto autorizado. El titular revisa y envía desde Gmail.

Incluye autenticación, conexión OAuth a Gmail, worker, generación con fuentes, controles de privacidad, métricas y observabilidad. La preparación de producción de **MAIL-067** usa imágenes Docker y tres procesos independientes: web, worker y monitor. El destino es `auto-email.ebia.cloud`, con DNS ya creado; la VPS se ha inspeccionado en lectura y el despliegue sigue pendiente. Soporte y privacidad: `ebayego.ia@gmail.com`.

Empieza por [el despliegue específico en ebia.cloud](docs/DESPLIEGUE-VPS-EBIA.md), que enumera archivos privados preparados y variables pendientes. La [guía de producción y recuperación de MAIL-067](<docs/Resolucion Tareas Épica EPIC-10/MAIL-067-despliegue-produccion.md>) describe el procedimiento técnico. La [guía de Google OAuth de MAIL-068](<docs/Resolucion Tareas Épica EPIC-10/MAIL-068-publicacion-google-oauth.md>) recoge las autorizaciones externas previas a la apertura pública.

## Requisitos

- Node.js **24.x**; versión de referencia **24.19.0**, indicada en `.nvmrc`.
- npm **11.x**; versión de referencia **11.17.0**, indicada en `packageManager`.
- Git para trabajar con el repositorio.
- Docker Desktop con contenedores Linux para las comprobaciones SQL locales; no se necesita para arrancar Next.js.

Comprobar las versiones con `node --version`, `npm --version` y `git --version`.

## Instalación y ejecución

En PowerShell, desde la carpeta del proyecto:

```powershell
Set-Location -LiteralPath 'C:\Users\Edu\Desktop\Projects\auto-email'
npm ci
npm run check
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000). La página inicial muestra «Auto Email». Detener el servidor con `Ctrl+C`.

Para usar proveedores reales, configura `.env.local` a partir de `.env.example` y ejecuta `npm run env:check`. Conserva los secretos fuera de Git y del cliente. Las plantillas de staging y producción son referencias sin credenciales. Los tests utilizan servicios locales y datos sintéticos, sin proveedores reales.

Si el puerto está ocupado:

```powershell
npm run dev -- --port 3001
```

La instalación reproducible utiliza únicamente `package-lock.json` y npm. Para añadir dependencias, usar `npm install --save-exact <paquete>` o `npm install --save-dev --save-exact <paquete>` y versionar el lockfile.

## Comandos

| Comando                    | Función                                                  |
| -------------------------- | -------------------------------------------------------- |
| `npm run dev`              | Servidor de desarrollo                                   |
| `npm run build`            | Compilación de producción                                |
| `npm run start`            | Servidor de producción local, después del build          |
| `npm run lint`             | ESLint sin avisos permitidos                             |
| `npm run lint:fix`         | Correcciones automáticas de ESLint                       |
| `npm run typecheck`        | Generación de tipos de Next.js y comprobación TypeScript |
| `npm run test`             | Pruebas unitarias con Vitest                             |
| `npm run test:coverage`    | Pruebas unitarias con umbrales de cobertura              |
| `npm run test:integration` | Integración contra Supabase local                        |
| `npm run test:e2e`         | Regresión funcional con Chromium y Supabase local        |
| `npm run test:deployment`  | Imágenes, reinicios y restauración cifrada local         |
| `npm run worker:sync`      | Proceso de trabajo en segundo plano                      |
| `npm run ops:monitor`      | Monitor independiente y entrega de alertas               |
| `npm run production:check` | Configuración previa al despliegue                       |
| `npm run format`           | Aplicar formato a código, configuración y README         |
| `npm run format:check`     | Comprobar el formato                                     |
| `npm run check`            | Formato, lint, tipos, runner de tests y build            |

El build no sustituye al lint. `typecheck` ejecuta `next typegen` antes de `tsc`, por lo que funciona sin haber arrancado la aplicación. Los archivos generados de Next.js no se versionan.

ESLint utiliza los presets de JavaScript, TypeScript, Next.js/Core Web Vitals y React Hooks. La CI exige formato, lint, tipos, cobertura, build, SQL, integración, regresión de navegador, auditoría de dependencias de producción y recuperación con Docker.

Vitest usa el alias `@/`, fixtures sintéticos y límites de red. La ausencia de tests y el incumplimiento de los umbrales hacen fallar la validación. La integración y la regresión requieren Supabase local; instala Chromium con `npx playwright install chromium` antes de la primera ejecución end-to-end.

Prettier excluye `docs/` para conservar la documentación original sin reformatearla.

La suite SQL cubre las migraciones, permisos y aislamiento. Se ejecuta con `npm run db:check`; es independiente de Vitest y necesita la base temporal local arrancada.

## Comprobar la compilación local

Detener el servidor de desarrollo y ejecutar:

```powershell
npm run build
npm run start
```

Abrir [http://localhost:3000](http://localhost:3000). Para comprobar la respuesta desde otra terminal PowerShell:

```powershell
$response = Invoke-WebRequest -Uri 'http://localhost:3000'
$response.StatusCode
$response.Content -match '<h1[^>]*>Auto Email</h1>'
```

El resultado esperado es `200` y `True`, tanto en desarrollo como con `start`. Para otro puerto, usar `npm run start -- --port 3001` y ajustar la URL.

## Base de datos

Se utiliza un único [proyecto Supabase auto-email](https://supabase.com/dashboard/project/zbcexekelujsqkkynsog) para dev, staging y producción, por decisión del usuario. Su referencia pública está en `supabase/project.json`. Las migraciones remotas afectan siempre a ese mismo proyecto.

La base temporal de Docker sirve para reconstruir y probar el esquema sin modificar los datos remotos:

```powershell
npm run db:start
npm run db:reset
npm run db:check
```

`db:reset` elimina y reconstruye **solo la base local auto-email**, vuelve a aplicar las migraciones y carga datos sintéticos. El comando fija `--local`; no se debe añadir `--linked` ni una URL remota. Los puertos locales son API `55321`, PostgreSQL `55322`, Studio `55323` y correo de prueba `55324`.

`npm run db:types` regenera los tipos desde esa base validada, seguido de `npm run format`. `npm run db:stop` detiene los contenedores de este proyecto, conservando sus datos locales. No utilizar `supabase stop --all` para este flujo.

Las migraciones en `supabase/migrations` definen el esquema actual. Los repositorios de usuario y las operaciones privilegiadas están separados y protegidos por RLS y verificaciones de identidad. No ejecutes seeds ni resets contra el proyecto remoto compartido.

El procedimiento remoto, el modelo de datos y las restricciones se describen en [src/db/README.md](src/db/README.md).

## Organización

```text
src/
  app/        # Presentación Next.js y adaptadores HTTP
  modules/    # Módulos de dominio reutilizables por web y worker
  worker/     # Sincronización y procesamiento de trabajos
  db/         # Modelo, instrucciones y tipos generados de PostgreSQL
supabase/     # Configuración de validación, migraciones, seed y tests SQL
tests/        # Organización de pruebas de aplicación
public/       # Recursos estáticos locales
deploy/       # Imágenes, Compose, backups, rollback y plantillas operativas
docs/         # Fuentes, planificación y resoluciones de tareas
```

Los módulos siguen la separación funcional de MAIL-003. Las responsabilidades están en [src/modules/README.md](src/modules/README.md).

Las credenciales pertenecen al backend o al worker. El dominio compartido no depende de componentes React ni de rutas o APIs de sesión de Next.js. Identidad determina el estilo, conocimiento aporta evidencia y políticas autorizan acciones. No se implementarán métodos de envío de Gmail ni persistencia de cuerpos de correo por defecto.

## Documentación

- [Conector SharePoint: configuración, cobertura y operación](docs/SHAREPOINT-CONFIGURACION.md).

- [Guía maestra: configuración pendiente y puesta en marcha](docs/PUESTA-EN-MARCHA-PRODUCCION.md).
- [Decisiones de EPIC-00](<docs/Resolucion Tareas Épica EPIC-00/README.md>).
- [Arquitectura funcional MAIL-003](<docs/Resolucion Tareas Épica EPIC-00/MAIL-003-functional-architecture.md>).
- [Despliegue, backups y recuperación — MAIL-067](<docs/Resolucion Tareas Épica EPIC-10/MAIL-067-despliegue-produccion.md>).
- [Publicación de Google OAuth — MAIL-068](<docs/Resolucion Tareas Épica EPIC-10/MAIL-068-publicacion-google-oauth.md>).
- [Selección e incorporación de usuarios piloto — MAIL-069](<docs/Resolucion Tareas Épica EPIC-10/MAIL-069-preparacion-usuarios-piloto.md>).
- [Ejecución y evaluación del piloto — MAIL-070](<docs/Resolucion Tareas Épica EPIC-10/MAIL-070-ejecucion-evaluacion-piloto.md>).
- [Primera oferta comercial, cobro y costes — MAIL-071](<docs/Resolucion Tareas Épica EPIC-10/MAIL-071-primera-oferta-comercial.md>).
- [Backlog del MVP](<docs/Backlog de tareas Jira MVP.txt>).

El workflow manual `production-images.yml` puede probar y publicar las imágenes del commit revisado. No accede a la VPS. Su opción de publicación está desactivada por defecto.

## Aviso de dependencias de desarrollo

Ejecuta `npm audit --omit=dev --audit-level=high` antes de publicar una versión. Las dependencias están fijadas en el lockfile y deben revisarse periódicamente, incluidas las herramientas de desarrollo y las imágenes base.
