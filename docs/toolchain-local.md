# Herramientas locales de Windows

[Inicio](../README.md) · [Preparación y comprobantes completos](en/original/docs/toolchain-local.md)

El entorno preparado guarda herramientas portables bajo `.cache/toolchains`; no forman parte del repositorio. Incluye Rust/Cargo, PostgreSQL, WinLibs y GitHub CLI. No sustituye los requisitos nativos de cada plataforma.

```powershell
. ./scripts/dev-tools/enter.ps1
cargo --version
./scripts/dev-tools/postgres.ps1 -Action start
```

`enter.ps1` establece rutas locales, Cargo/Rustup y la conexión de desarrollo si está preparada. Las credenciales viven en el archivo ignorado `.cache/postgres/connection.json`; no lo imprimas ni lo subas. El clúster escucha en 127.0.0.1:55432.

`init-postgres.ps1` crea un clúster nuevo y falla si ya existe. No lo uses para sustituir datos. `postgres.ps1` permite start, stop y status. El servidor de desarrollo debe usar HTTP solo en bucle local y un origen exacto.

Edge está disponible para pruebas Playwright mediante `PLAYWRIGHT_CHANNEL=msedge`. El navegador Chromium de Playwright puede faltar; no confundas un fallo al abrirlo con un fallo de la aplicación.

Antes de verificar el backend, compila el código actual. Un ejecutable anterior en `target/debug` puede no incluir los eventos o comprobaciones presentes en las fuentes. Registra la revisión, el binario y el comando ejecutado.

La preparación detallada y sus límites históricos se conservan en [la referencia secundaria](en/original/docs/toolchain-local.md).
