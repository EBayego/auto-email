# TODO — Próximos pasos y mejoras

Actualizado: **2 de noviembre de 2026**. Lista de seguimiento; ninguna casilla pendiente acredita una configuración o prueba completada.

## 1. Copias de seguridad y recuperación — APLAZADO

**Primera prioridad pendiente.** Se aplazan las copias por decisión del operador para continuar la preparación del despliegue. La configuración privada local utiliza `BACKUP_MODE=deferred`: permite desplegar sin inicializar Restic ni contratar almacenamiento externo. No se ha desplegado este cambio en la VPS.

Mientras esté aplazado, no hay copia externa de la aplicación verificada ni copia previa a las migraciones mediante este procedimiento. Un borrado o una migración incorrecta puede causar pérdida de datos. La disponibilidad de la base no demuestra que se pueda recuperar el servicio.

- [ ] Elegir destino externo: ordenador/disco propio, NAS, servidor SFTP o almacenamiento compatible con Restic. Restic es gratuito; S3 no es obligatorio.
- [ ] Preparar credenciales, conectividad y copia cifrada independiente de las claves de recuperación. Para un PC que descargue las copias por SSH, adaptar primero el procedimiento actual.
- [ ] Copiar PostgreSQL, los originales de documentos de Supabase Storage y el ledger de supresiones.
- [ ] Implementar/configurar una copia independiente actualizada del ledger por cada supresión; la copia diaria puede ser anterior al último borrado.
- [ ] Inicializar y verificar el repositorio; ensayar recuperación en un destino aislado, incluyendo supresiones posteriores al backup.
- [ ] Cambiar `BACKUP_MODE=required` en la configuración que utiliza la VPS y completar los archivos de backup. El modo por defecto, si se omite la variable, es `required`.
- [ ] Activar el timer diario y comprobar fallos/antigüedad de las copias desde fuera de la VPS.
- [ ] Confirmar que el despliegue vuelve a crear una copia antes de migrar y que el plan muestra `backupBeforeMigrations=true`.

Referencias: [guía activa de despliegue](docs/DESPLIEGUE-VPS-EBIA.md), [procedimiento de recuperación](<docs/Resolucion Tareas Épica EPIC-10/MAIL-067-despliegue-produccion.md>).

## 2. Recuperación de contraseña

- [ ] Implementar solicitud, correo, callback seguro y formulario para establecer la nueva contraseña.
- [ ] Configurar plantilla y retornos de Supabase; probar enlaces caducados, reutilizados/manipulados y acceso con la nueva contraseña.

## 3. Admisión al piloto por invitación

- [ ] Cerrar el registro público también en servidor/Supabase y revisar las cuentas ya existentes.
- [ ] Implementar aceptación de invitaciones y elección de contraseña; probar el rechazo de altas no autorizadas.

## 4. SMTP de autenticación

- [x] Configurar Resend, sus tres registros DNS de `auth.ebia.cloud` y SMTP en Supabase con API key (DNS y configuración SMTP comprobados el 1 de noviembre de 2026; permisos de la clave no consultados).
- [ ] Probar recepción y confirmación de cuenta hacia un correo externo; el usuario confirma que esta prueba aún no está hecha. Revisar límites, plantillas y privacidad.

## 5. Avisos operativos

- [ ] Configurar y probar el receptor del webhook, autenticación, aceptación duradera y deduplicación; o realizar un cambio explícito que haga opcionales los avisos.
- [ ] Añadir vigilancia externa de disponibilidad. El aplazamiento de backups no elimina el requisito actual del webhook en preflight.

## 6. Google OAuth y privacidad

- [ ] Completar verificación del dominio, marca, scopes y cuentas de prueba en los paneles reales.
- [x] Completar y sincronizar los seis campos de privacidad de local y producción con las condiciones y planes confirmados el 2 de noviembre de 2026; conservar fuentes privadas.
- [ ] Mantener el aviso actualizado al cambiar proveedores, copias, alertas o tratamiento y completar las revisiones externas aplicables.
- [ ] Con HTTPS y cuentas controladas, grabar demostración y completar el expediente de MAIL-068.
- [ ] Tramitar la verificación y evaluación de seguridad/excepción aplicable antes de la apertura pública correspondiente.

## 7. Despliegue y pruebas reales

- [ ] Publicar imágenes revisadas y completar sus digests; trasladar secretos y el ledger vigente.
- [ ] Desplegar, comprobar HTTPS y probar cuentas, consentimientos, Gmail, borradores, pausa, exportación y borrado.
- [ ] Mantener visible el estado de backups aplazados hasta completar el punto 1; no declarar recuperación integral verificada.

## 8. Mejoras comerciales posteriores

- [ ] Revisar cobro/facturación y operación manual de la oferta inicial antes de vender.
- [ ] Valorar automatizar admisión, cuotas y caducidad del servicio cuando se defina ese alcance.
