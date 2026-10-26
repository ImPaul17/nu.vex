# Arquitectura

[Inicio](../README.md) · [English](en/README.md) · [Diseño técnico anterior completo](en/original/docs/architecture.md)

nu.vex es un cliente compartido y un servidor independiente por instancia. Creado y dirigido por Pablo / ImPaul17.

```mermaid
flowchart LR
  W[Web y navegador móvil] -->|REST y WebSocket| I[Instancia elegida: Rust / Axum]
  D[Escritorio Tauri] --> T[Transporte Rust restringido]
  T -->|HTTPS / WSS| I
  I --> P[(PostgreSQL)]
  W --> L[Preferencias y direcciones locales]
```

## Cliente compartido

`apps/web` usa SvelteKit, Svelte 5 y TypeScript estricto. La ruta `/` conecta con instancias reales; `/demo` usa datos efímeros de `packages/core`. `ChatShell.svelte` presenta comunidades, canales y mensajes; `InstanceApi` concentra validación de datos y operaciones del servidor. Los temas comparten variables de `packages/tokens` y solo admiten preferencias JSON validadas.

El escritorio incorpora el mismo cliente en Tauri 2. El transporte nativo restringe destinos y operaciones, verifica TLS y conserva tokens en memoria Rust. La [decisión ADR 0001](adr/0001-native-instance-transport.md) conserva el razonamiento del diseño.

## Ciclo de vida de varias instancias

En web, la ruta de acceso mantiene un máximo de seis conexiones durante la ejecución. El mediador de escritorio conserva una sola conexión por ventana y exige un nuevo inicio de sesión al cambiar. Cada conexión conserva sus propias credenciales. Al cambiar se cierra la suscripción activa, se invalida el trabajo pendiente de la sesión anterior y se obtiene de nuevo la cuenta, las comunidades y el historial del destino. Los mensajes anteriores se descartan del estado visible antes de cargar el siguiente servidor.

Solo hay una suscripción activa a la vez. Volver a una instancia recupera los eventos mediante el arranque de su espacio y la reconciliación del historial. No se reciben notificaciones en segundo plano de todas las instancias. Las credenciales remotas desaparecen al recargar; no se exportan junto con preferencias o direcciones.

Las direcciones recientes se validan y normalizan: HTTPS, HTTP solo local, sin credenciales, rutas, consultas ni fragmentos. Se guardan nombre, origen y fecha de uso. Una entrada dañada no bloquea las demás.

## Cuenta y autorización

Una cuenta pertenece a una instancia. El servidor registra y autentica con correo/contraseña, sesiones revocables e invitaciones. El propietario crea canales e invitaciones. Un miembro puede leer y enviar en sus comunidades y eliminar sus propios mensajes. La autorización se comprueba en Rust y PostgreSQL.

El navegador usa cookie en el mismo origen y token en memoria para instancias externas. CORS y la política de conexión del despliegue deben permitir el origen concreto. Tauri gestiona credenciales en su transporte nativo. Nunca se guardan contraseñas ni tokens en `localStorage`.

No hay todavía inicio con Discord u otros proveedores, vinculación entre cuentas, privados, amistades, roles personalizados ni un inicio global de Nuvex. Tendrán permisos y revocación propios.

## Persistencia y tiempo real

Axum y PostgreSQL mantienen el historial con orden estable y paginación por cursor. Los envíos incluyen un identificador de cliente para tolerar reintentos sin duplicar mensajes persistidos. Los eventos WebSocket usan tickets de corta duración y se reconcilian después de reconectar. El cliente protege la vista frente a respuestas tardías, sesiones sustituidas y mensajes ya borrados.

## Instancia oficial y autoalojamiento

La instancia oficial ejecutará el mismo servidor que las instalaciones independientes. Su diferencia será operativa: administración, admisión a la comunidad, cuotas, copias y moderación. Requiere infraestructura persistente. La exportación estática del cliente no incluye PostgreSQL ni ejecuta Axum.

`compose.yaml` integra web, proxy, backend, migraciones y base privada. `infra` proporciona CSP y herramientas de copia/restauración. Claves, contraseñas y configuración se suministran por entorno. Consulta [autoalojamiento](self-hosting.md).

## Extensiones previstas

Archivos necesitarán almacenamiento autorizado y cuotas. Voz/vídeo necesitarán señalización, TURN y SFU. Bots tendrán identidades y permisos propios. Los temas comunitarios conservarán un formato declarativo. Las actualizaciones tendrán firmas verificables y canal Alpha.

Cambiar entre instancias **no implementa federación**: hoy no hay comunicación entre sus servidores. La [hoja de ruta](roadmap.md) fija la aceptación de cada capacidad.
