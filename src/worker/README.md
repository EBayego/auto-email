# Worker

Directorio reservado para el futuro proceso Node.js de procesamiento de correo. MAIL-029 incorporará su ejecución periódica; MAIL-005 no arranca ningún proceso de fondo.

El worker compondrá los módulos de `src/modules/` y la infraestructura de `src/db/`. Debe comprobar la propiedad de cada recurso, aplicar las mismas políticas que la web y mantener las credenciales fuera del navegador. El dominio compartido no debe depender del runtime de Next.js.
