# Alojar tu propia instancia

[Inicio](../README.md) · [Guía técnica completa en inglés](en/original/docs/self-hosting.md)

Cada instancia administra sus cuentas, comunidades y datos. Instalar el cliente de Windows no inicia un servidor.

## Con Docker Compose

Necesitas Docker Engine y Compose en una máquina con almacenamiento persistente. Copia `.env.example` a `.env` y configura:

- `POSTGRES_PASSWORD`: contraseña administrativa aleatoria.
- `NUVEX_DATABASE_PASSWORD`: otra contraseña distinta, de al menos 64 caracteres hexadecimales.
- `NUVEX_ALLOWED_ORIGIN`: origen exacto del cliente, por ejemplo `https://chat.ejemplo.org`, sin barra final.
- `NUVEX_REGISTRATION_OPEN`: `true` solo cuando quieras permitir nuevas cuentas.
- `NUVEX_INSECURE_DEV=false` en producción.

Genera cada contraseña por separado; no reutilices un secreto. No publiques `.env`, volcados, registros de credenciales ni salidas de `docker compose config` que las incluyan.

```sh
docker compose config --quiet
docker compose build
docker compose up --detach --wait --wait-timeout 180
```

La base queda en una red interna. El paso de migraciones termina antes de arrancar Axum; la web espera a que la API esté lista. Solo se publica la web en `127.0.0.1:8080` por defecto.

## HTTPS y proxy

Sitúa un proxy TLS delante del puerto web. [Caddyfile.example](../infra/Caddyfile.example) es una base. El dominio debe resolver al servidor. Configura el origen HTTPS real en el entorno.

El proxy debe preservar Origin, sobrescribir la IP real y no publicar el puerto de PostgreSQL o del backend. Solo deben confiarse redes de proxy explícitas. `NUVEX_TRUSTED_PROXIES` acepta CIDR concretos; no acepta redes universales. Consulta [infraestructura](../infra/README.md) y el [contrato del servidor](../apps/server/README.md).

Para probar únicamente en este equipo, usa `NUVEX_ALLOWED_ORIGIN=http://127.0.0.1:8080` y `NUVEX_INSECURE_DEV=true`. Este modo solo permite orígenes de bucle local.

## Conectar con otras instancias

Configura `NUVEX_CONNECT_ORIGINS` con orígenes exactos separados por comas y reconstruye la imagen web. La CSP incorpora sus fuentes HTTPS y WSS. No admite rutas, credenciales, comodines ni parámetros. Se permiten hasta 16 entradas y 2048 bytes.

Cada destino debe ejecutar nu.vex y aceptar el origen del cliente en `NUVEX_ALLOWED_ORIGIN`. Una web corporativa arbitraria no es una instancia. Cada servidor admite actualmente un único origen de navegador; usar clientes web de varios orígenes requerirá una ampliación explícita de esa política.

El cliente guarda hasta seis direcciones y mantiene sesiones remotas en memoria. No copia cuentas entre servidores. La instancia oficial necesita la misma infraestructura y controles que cualquier otra.

## Migrar, actualizar y recuperar

Antes de cambiar versión, realiza una copia y prueba su restauración en una base distinta. No modifiques migraciones ya aplicadas. Revisa las notas Alpha y conserva una versión anterior de las imágenes.

`infra/backup-db.mjs` crea copias y comprobantes. `infra/restore-db.mjs` exige un destino explícito y salvaguardas de restauración. Las instrucciones detalladas, las variables requeridas y los ejemplos de simulación están en [copias y recuperación](en/original/docs/self-hosting.md). No ejecutes una restauración contra la base activa sin revisar y autorizar el destino.

La prueba de aceptación debe registrar dos cuentas, unirlas a una comunidad por invitación, intercambiar mensajes, reiniciar, verificar el historial y restaurar una copia en otro destino. Estado ejecutado: [verificación](verification-current.md).
