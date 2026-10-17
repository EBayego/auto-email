# Auto Email

Asistente para Gmail que preparará borradores con el estilo del usuario y contexto autorizado. El titular siempre revisará y enviará desde Gmail.

Este repositorio contiene la base técnica de **MAIL-005** y el esquema Supabase de **MAIL-006**: Next.js con App Router, TypeScript estricto, estructura modular, herramientas de calidad y migraciones de base de datos. La autenticación web, los clientes de proveedores, el worker y las pantallas de configuración se implementarán en sus tickets correspondientes.

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

La base **no requiere variables de entorno ni credenciales**. No es necesario copiar `.env.example`. MAIL-009 añadirá los proveedores y la validación de su configuración. Los archivos `.env*` están ignorados por Git, salvo `.env.example`.

Si el puerto está ocupado:

```powershell
npm run dev -- --port 3001
```

La instalación reproducible utiliza únicamente `package-lock.json` y npm. Para añadir dependencias, usar `npm install --save-exact <paquete>` o `npm install --save-dev --save-exact <paquete>` y versionar el lockfile.

## Comandos

| Comando                | Función                                                  |
| ---------------------- | -------------------------------------------------------- |
| `npm run dev`          | Servidor de desarrollo                                   |
| `npm run build`        | Compilación de producción                                |
| `npm run start`        | Servidor de producción local, después del build          |
| `npm run lint`         | ESLint sin avisos permitidos                             |
| `npm run lint:fix`     | Correcciones automáticas de ESLint                       |
| `npm run typecheck`    | Generación de tipos de Next.js y comprobación TypeScript |
| `npm run test`         | Runner Vitest; actualmente **cero tests**                |
| `npm run format`       | Aplicar formato a código, configuración y README         |
| `npm run format:check` | Comprobar el formato                                     |
| `npm run check`        | Formato, lint, tipos, runner de tests y build            |

El build no sustituye al lint. `typecheck` ejecuta `next typegen` antes de `tsc`, por lo que funciona sin haber arrancado la aplicación. Los archivos generados de Next.js no se versionan.

ESLint 10 utiliza los presets de JavaScript, TypeScript, Next.js/Core Web Vitals y React Hooks mediante plugins compatibles. Se ajustó la elección inicial de ESLint 9 al comprobar que esa rama estaba fuera de soporte. Next.js tiene desactivada la generación automática de `AGENTS.md`; las convenciones propias se definirán en MAIL-010.

Vitest está preparado con entorno Node y el alias `@/`. Hasta MAIL-010, `test` utiliza `--passWithNoTests`: un resultado correcto acredita que el runner puede ejecutarse, **no cobertura funcional**. MAIL-010 incorporará la suite relevante, fixtures, CI y `AGENTS.md`, y retirará esa opción. Véase [tests/README.md](tests/README.md).

Prettier excluye `docs/` para conservar la documentación original sin reformatearla.

Hay además **47 pruebas SQL** de MAIL-006. Se ejecutan con `npm run db:check`; son independientes del runner Vitest y necesitan la base temporal local arrancada.

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

Las tablas son `users`, `gmail_accounts`, `user_settings` y `processing_runs`. RLS está activada y los permisos iniciales de datos son exclusivamente de servidor; MAIL-007/008 incorporarán la sesión y los repositorios. El arranque de Next.js continúa sin requerir secretos.

El procedimiento remoto, el modelo de datos y las restricciones se describen en [src/db/README.md](src/db/README.md).

## Organización

```text
src/
  app/        # Presentación Next.js y futuros adaptadores HTTP
  modules/    # Módulos de dominio reutilizables por web y worker
  worker/     # Futuro proceso de fondo; sin ejecución implementada
  db/         # Modelo, instrucciones y tipos generados de PostgreSQL
supabase/     # Configuración de validación, migraciones, seed y tests SQL
tests/        # Organización de pruebas de aplicación
public/       # Recursos estáticos locales
docs/         # Fuentes, planificación y resoluciones de tareas
```

Los módulos siguen MAIL-003: `auth`, `gmail`, `workflow`, `classifier`, `identity`, `knowledge`, `source-router`, `policy`, `response`, `validator` y `analytics`. Sus directorios vacíos se conservan mediante `.gitkeep`; las responsabilidades están en [src/modules/README.md](src/modules/README.md).

Las credenciales pertenecen al backend o al worker. El dominio compartido no depende de componentes React ni de rutas o APIs de sesión de Next.js. Identidad determina el estilo, conocimiento aporta evidencia y políticas autorizan acciones. No se implementarán métodos de envío de Gmail ni persistencia de cuerpos de correo por defecto.

## Documentación

- [Decisiones de EPIC-00](<docs/Resolucion Tareas Épica EPIC-00/README.md>).
- [Arquitectura funcional MAIL-003](<docs/Resolucion Tareas Épica EPIC-00/MAIL-003-functional-architecture.md>).
- [Plan de MAIL-005](<docs/Planes de Implementación EPIC-01/MAIL-005-plan-implementacion.md>).
- [Resolución y verificaciones de MAIL-005](<docs/Resolucion Tareas Épica EPIC-01/MAIL-005-repository-nextjs.md>).
- [Resolución y verificaciones de MAIL-006](<docs/Resolucion Tareas Épica EPIC-01/MAIL-006-supabase-schema.md>).
- [Backlog del MVP](<docs/Backlog de tareas Jira MVP.txt>).

El repositorio es local. La publicación remota y el despliegue se gestionarán cuando se defina su destino.

## Aviso de dependencias de desarrollo

La auditoría completa detecta una vulnerabilidad de `braces` a través del plugin de ESLint de Next.js y sus dependencias de búsqueda de archivos. A fecha de 15/10/2026, el [aviso oficial no tiene una versión corregida](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). No se deben pasar patrones de búsqueda no confiables a esas herramientas. La auditoría `npm audit --omit=dev` no detectó vulnerabilidades en las dependencias de producción durante esta entrega; esto no sustituye futuras revisiones.
