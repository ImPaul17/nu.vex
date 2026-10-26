# Pruebas

[Inicio](../README.md) · [Referencia técnica completa](en/original/docs/testing.md)

Usa bases y cuentas sintéticas separadas de producción. Las pruebas modifican cuentas, comunidades e historial.

## Cliente y modelos

```sh
npm run check
npm test
npm run build
node --test infra/infra.test.mjs
npm run test:e2e
```

La suite de modelos usa `node:test` mediante `tsx`. Playwright necesita su navegador instalado o un navegador compatible existente. En este Windows se usa Edge:

`npm test` también ejecuta `tests/voice-lifecycle.test.ts`: cancelación de permiso, respuesta de alta tardía, selección de micrófono concurrente, cierre de pistas y orden de los listados de participantes. Son pruebas de ciclo de vida sin micrófono físico.

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
```

La suite comprueba aislamiento por canal, renderizado de texto no confiable, borrado de demo al recargar, temas válidos e inválidos, foco, creación local y móvil a 390 × 844. La ampliación cubre categorías, concentración y capturas de los tres temas.

## Instancia real

Primero inicia PostgreSQL, aplica migraciones y arranca el servidor según [su guía](../apps/server/README.md). `npm run test:instance` inicia/reutiliza el cliente de desarrollo y exige API en `127.0.0.1:3001`.

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
$env:NUVEX_E2E_REMOTE_URL = 'http://127.0.0.1:3001'
$env:NUVEX_E2E_SECOND_INSTANCE = 'http://127.0.0.1:3002'
npm run test:instance
```

La segunda variable es opcional para las pruebas anteriores. La prueba de cambio entre servidores exige `NUVEX_E2E_SECOND_INSTANCE` y se omite expresamente si falta. Para que demuestre independencia, el segundo servidor debe usar otra base PostgreSQL y aceptar el origen de la web.

Se comprueban cuentas reales, invitaciones, entrega bidireccional, persistencia al recargar, revocación, WebSocket y respuestas tardías. La prueba ampliada alterna entre dos cuentas en bases diferentes, verifica que no se mezclen mensajes y que cerrar una sesión no cierre la otra.

`NUVEX_E2E_BASE_URL` permite apuntar al despliegue web real sin iniciar Vite. No ejecutes estas pruebas contra un servicio con datos de usuarios.

## Voz

`npm run test:voice` necesita una instancia migrada que admita canales de voz. Usa un dispositivo de audio sintético del navegador y permisos limitados a esos contextos de prueba. Verifica paquetes WebRTC recibidos por ambos clientes, controles locales, expulsión y micrófono denegado. La [guía de voz](voice.md) contiene el recorrido y sus límites.

Las trazas de esta suite permanecen en `.cache/voice-playwright`; las capturas revisables se escriben en `test-results/voz-*.png`. Si ejecutas varias suites simultáneamente, utiliza directorios `--output` distintos fuera de la carpeta que limpie otra suite. Las trazas pueden contener credenciales sintéticas.

## Rust, contenedores y escritorio

```sh
cargo fmt --manifest-path apps/server/Cargo.toml -- --check
cargo test --locked --manifest-path apps/server/Cargo.toml
cargo clippy --locked --manifest-path apps/server/Cargo.toml --all-targets -- -D warnings
npm run test:server
```

Los verificadores `verify-compose.mjs`, `verify-native-tls.mjs` y `verify-desktop.mjs` tienen requisitos distintos. No los sustituyas por un build web. La [referencia anterior](en/original/docs/testing.md) conserva todos los parámetros y comprobantes de CI.

Las capturas y trazas locales quedan en `test-results`. Las trazas de acceso pueden contener credenciales: no las publiques. Publica solo imágenes revisadas y resúmenes sin secretos. Los resultados efectivos se registran en [verificación actual](verification-current.md).
