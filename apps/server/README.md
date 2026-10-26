# Servidor de nu.vex

[Documentación principal](../../README.md) · [Contrato completo en inglés](../../docs/en/original/apps/server/README.md)

Servidor Rust/Axum con PostgreSQL: registro, sesiones opacas revocables, comunidades, invitaciones, canales de texto, historial persistente y WebSocket autenticado. Voz, archivos reales, privados y federación siguen en la [hoja de ruta](../../docs/roadmap.md).

## Ejecutar

El entorno preparado usa Rust 1.99.1 y PostgreSQL 17. El manifiesto declara Rust 1.89 como mínimo de dependencias; ese mínimo no se ha probado por separado. No existe alternativa SQLite. El binario no carga automáticamente archivos `.env`.

En Windows con las herramientas locales preparadas:

```powershell
. ./scripts/dev-tools/enter.ps1
./scripts/dev-tools/postgres.ps1 -Action start
$env:NUVEX_ALLOWED_ORIGIN = 'http://127.0.0.1:5173'
$env:NUVEX_INSECURE_DEV = 'true'
$env:NUVEX_REGISTRATION_OPEN = 'true'
cargo run --locked --manifest-path apps/server/Cargo.toml -- --migrate
cargo run --locked --manifest-path apps/server/Cargo.toml
```

En otros entornos exporta las mismas variables. `NUVEX_DATABASE_URL` es obligatoria; mantén la contraseña en un gestor de secretos o entorno, fuera del historial.

| Variable | Función |
| --- | --- |
| NUVEX_DATABASE_URL | Conexión PostgreSQL, obligatoria |
| NUVEX_BIND | Dirección de escucha; 127.0.0.1:3001 por defecto |
| NUVEX_ALLOWED_ORIGIN | Origen exacto HTTPS de la web; HTTP solo en desarrollo local |
| NUVEX_INSTANCE_NAME | Nombre público; nu.vex por defecto, 1–80 caracteres |
| NUVEX_REGISTRATION_OPEN | Registro cerrado por defecto |
| NUVEX_INSECURE_DEV | false por defecto; true solo para bucle local |
| NUVEX_MIGRATE_ON_START | false; preferir el paso explícito --migrate |
| NUVEX_TRUSTED_PROXIES | CIDR de proxies concretos autorizados para X-Real-IP |
| RUST_LOG | Filtro de registros, sin cuerpos ni credenciales |

## Contrato

Todas las rutas de aplicación usan `/api/v1` y JSON camelCase. Los errores devuelven `{error:{code,message}}`. Las rutas de salud son `/health/live` y `/health/ready`.

| Ruta | Operación |
| --- | --- |
| GET /instance | Nombre, versión, registro y métodos de acceso |
| POST /auth/register, /auth/login | Crear cuenta o iniciar sesión |
| GET /auth/me; POST /auth/logout | Perfil propio y revocación de sesión |
| GET /bootstrap | Cuenta, comunidades y miembros visibles |
| POST /communities | Crear comunidad con canal general |
| POST /communities/{id}/channels | Crear canal; solo propietario |
| POST /communities/{id}/invites | Invitación con caducidad; solo propietario |
| POST /invites/{code}/join | Unirse con una cuenta de esta instancia |
| DELETE /communities/{id}/members/{userId} | Retirar miembro; solo propietario |
| GET, POST /channels/{id}/messages | Historial paginado y envío con clientId UUID |
| DELETE /channels/{channelId}/messages/{messageId} | Eliminar tu propio mensaje |
| POST /events/ticket; GET /events | Ticket de corta duración y WebSocket |

El cliente web del mismo origen usa cookie HttpOnly, SameSite=Lax, Secure en producción y siete días de duración. El transporte remoto usa `transport: bearer` y devuelve un token que se mantiene en memoria. La base guarda hashes de sesión. El servidor exige Origin exacto para mutaciones de navegador; los clientes nativos sin Origin ni Cookie usan Bearer explícito.

Los tickets WebSocket duran 30 segundos y son de un solo uso. Origin y audiencia del ticket no se pueden intercambiar. Los eventos vuelven a comprobar sesión y membresía. El cliente debe reconciliar historial al reconectar; una cola saturada recibe `resync.required` y se cierra.

Límites: mensajes de 1–4000 unidades UTF-16; 120 envíos por cuenta/minuto; 30 intentos de acceso por IP/15 minutos; hasta 20 sesiones por cuenta. El perfil de presencia no mide actividad en vivo. Los roles visuales no sustituyen la autorización por comunidad.

Los cuerpos, respuestas, límites de cola/conexión y reglas de idempotencia están documentados íntegramente en el [contrato secundario](../../docs/en/original/apps/server/README.md). Las pruebas y el estado de ejecución están en [pruebas](../../docs/testing.md).

## Verificar

```sh
cargo fmt --manifest-path apps/server/Cargo.toml -- --check
cargo clippy --locked --manifest-path apps/server/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path apps/server/Cargo.toml
```
