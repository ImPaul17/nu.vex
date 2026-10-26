# nu.vex

> **Comunicación independiente para comunidades que quieren control sobre su infraestructura.**
> *Independent communication for communities that want control over their infrastructure.*

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.80%2B-orange.svg)](https://www.rust-lang.org/)
[![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00.svg)](https://svelte.dev/)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![Pre-release](https://img.shields.io/badge/Release-Pre--release%20Alpha-yellow.svg)](https://github.com/ImPaul17/nu.vex/releases)
[![CI](https://github.com/ImPaul17/nu.vex/actions/workflows/ci.yml/badge.svg)](https://github.com/ImPaul17/nu.vex/actions/workflows/ci.yml)

---

## 🎯 Estado Actual / Current Status

**Early messaging alpha (v0.2.0-alpha.6)** — El repositorio incluye:
- Cliente web brandado (SvelteKit + Svelte 5 + TypeScript estricto)
- Servicio backend Rust/Axum/PostgreSQL con migraciones
- Stack de auto-hospedaje probado con Docker Compose
- Transporte nativo restringido para credenciales seguras (Tauri)
- Instaladores descargables sin firmar: Windows x64, Linux x64, macOS Apple Silicon

> ⚠️ **Pre-release only**: Todas las versiones son alpha/beta. No hay releases estables hasta v1.0.0.

---

## 📥 Descargas Desktop / Desktop Downloads

Descarga instaladores desde [GitHub Releases](https://github.com/ImPaul17/nu.vex/releases).
Elige un release con assets adjuntos: Windows x64 `.exe`/`.msi`, Linux x64 `.deb`, o macOS Apple Silicon `.dmg`.
Los releases Alpha antiguos solo tienen código fuente.

**Verifica `SHA256SUMS.txt` y lee las release notes antes de instalar.**

La app desktop Alpha se conecta a una instancia nu.vex hospedada por separado. **No inicia un servidor automáticamente**.
Ver [auto-hospedaje](docs/self-hosting.md) para correr tu propia instancia.
Estos paquetes tempranos son sin firmar; code signing y actualizaciones automáticas son trabajo planeado por separado.

---

## 🚀 Ejecución Local / Run Locally

**Requisitos:**
- Node.js 22.14+ (línea 22.x) o Node.js 24+
- npm `>=11.18 <12` (el proyecto fija **npm 11.21.1**)
- Para desktop: Rust/Cargo + prerequisitos Tauri (ver [guía oficial](https://v2.tauri.app/start/prerequisites/))
- Para servidor: PostgreSQL 16+

```bash
# Desde la raíz del repo - usa el npm fijado sin cambiar tu npm global
npx --yes npm@11.21.1 ci
npm run dev
```

Abre la dirección local que imprima Vite.
**Modo cuentas reales** requiere una instancia nu.vex corriendo; el dev proxy apunta a `127.0.0.1:3001`.
Ver [auto-hospedaje](docs/self-hosting.md) y [setup del servidor](apps/server/README.md).
El demo local explícito sigue disponible para explorar el diseño sin base de datos.

```bash
# Verificaciones
npm run check      # TypeScript strict check
npm test           # Unit tests (Vitest)
npm run build      # Build producción → apps/web/build
npm run test:e2e   # Playwright demo mode
npm run test:instance  # Playwright real instance mode
```

---

## 🖥️ Cliente y Modos de Instancia / Client & Instance Modes

| Característica | Demo Local | Cuentas Reales |
|---|---|---|
| Navegación comunidades/canales | ✅ | ✅ |
| Búsqueda conversación | ✅ | ✅ |
| Compositor + controles apariencia | ✅ | ✅ |
| Temas import/export validados | ✅ | ✅ |
| Mensajes persistentes | ❌ (efímeros) | ✅ |
| Presencia en vivo | ❌ (simulada) | 🔄 Planeado |
| Roles/permisos servidor | ❌ (visuales) | ✅ (enforced) |
| Voz/Vídeo | ❌ | 🔄 Fase 3 |

**Cuentas reales** pertenecen a la instancia independiente seleccionada.
Una empresa puede hospedar su propio servidor/dominio nu.vex.
Login con proveedor de identidad corporativo (OIDC/SSO) requiere integración planeada por separado; un sitio web arbitrario **no** es una instancia nu.vex.

El build de producción web usa conexiones API same-origin por defecto;
una allowlist validada en build-time puede habilitar orígenes API/WebSocket externos seleccionados,
con confianza coincidente en el servidor destino.
Ver [configuración de conexión](docs/self-hosting.md#connecting-to-other-instances).

---

## 🗺️ Mapa del Repositorio / Repository Map

```
apps/
  web/                  SvelteKit + Svelte 5 + strict TypeScript frontend
  desktop/              Tauri 2 host + transporte nativo Rust restringido
  server/               Rust/Axum service, migraciones PostgreSQL, crate Cargo independiente
packages/
  core/                 Modelos compartidos, datos demo, validación temas
  tokens/               CSS design tokens y foundations de temas compartidos
docs/                   Arquitectura, hitos, despliegue, decisiones licencia
infra/                  Builds contenedor, proxy same-origin, helpers backup/restore
tests/                  Browser integration tests (Playwright)
logo-*                  Assets de marca originales + fuentes PSD editables
```

La raíz usa npm workspaces y un solo lockfile JavaScript.
Las apps Rust tienen Cargo manifests/lockfiles separados.
`compose.yaml` combina web, API, migración explícita, y base de datos persistente privada.
El [primer CI completo](https://github.com/ImPaul17/nu.vex/actions/runs/39193292317) verificó el stack de mensajería, recuperación contenedor, y flujos browser.
Cambios posteriores necesitan sus propios resultados de runner.

---

## 🖥️ Fuente Desktop / Desktop Source

El host Tauri comparte el frontend web. Requiere Rust/Cargo y prerequisitos nativos del OS objetivo.
En Windows: MSVC build tools y WebView2; Linux y macOS tienen sus propios prerequisitos.
Sigue la [guía oficial de prerequisitos Tauri](https://v2.tauri.app/start/prerequisites/) antes de correr:

```bash
npm run desktop:dev
```

El [transporte nativo de instancia restringido](docs/adr/0001-native-instance-transport.md) mantiene credenciales bearer en memoria nativa y media operaciones API/eventos conocidas.
En source `7f9f459`, la [compilación de release pasó en Windows x64, Linux x64, y macOS ARM64](https://github.com/ImPaul17/nu.vex/actions/runs/39202625762),
y [los 8 grupos de UI nativa pasaron en Windows y Linux](https://github.com/ImPaul17/nu.vex/actions/runs/39202625822) contra dos instancias reales con PostgreSQL.
Una [suite TLS de política de producción](https://github.com/ImPaul17/nu.vex/actions/runs/39202625770) pasó 14 casos HTTPS/WSS, certificado y redirect en cada OS.
Los instaladores Alpha descargables tienen sus propios receipts de empaquetado y verificación de recursos.
Firmado, operaciones HTTPS dominio público, y runtime interactivo macOS permanecen trabajo separado.
Las [notas de toolchain local](docs/toolchain-local.md) describen limitaciones del host original.

El job runtime Windows verificó binarios WebView2/EdgeDriver firmados coincidentes,
cluster PostgreSQL aislado, y limpieza.
Ver [procedimiento test Windows](docs/desktop.md#windows-runtime-ci) para setup y límites de artefactos.

Builds normales retienen notices revisados de proyecto/font/frontend-package y verifican el inventario final del cliente.
Ver [third-party notices](../../../THIRD_PARTY_NOTICES.md) para procedencia y review pendiente de distribución nativa.

---

## 🧭 Dirección / Direction

El hito actual de mensajería demuestra dos usuarios reales en una instancia intercambiando mensajes persistentes,
con autorización, reconexión, reinicio, y checks de recuperación.
Empaquetado nativo y despliegue servidor Docker son workflows separados.
Federación requiere diseño de protocolo futuro.

- [Arquitectura y decisiones](docs/architecture.md)
- [Entorno inicial e inspección Rea](docs/environment.md)
- [Branding oficial y procedencia fuentes](docs/branding.md)
- [Prerequisitos desktop, seguridad, limitaciones build](docs/desktop.md)
- [Hitos y criterios de aceptación](docs/roadmap.md)
- [Registro actual de preparación para release](docs/release-readiness.md)
- [Empaquetado desktop y proceso release Alpha](docs/desktop.md#alpha-release-packaging)
- [Resultados verificación actual y límites](docs/verification-current.md)
- [Auto-hospedaje y recuperación](docs/self-hosting.md)
- [Contribuir y testing](CONTRIBUTING.md)
- [Comandos test y setup browser](docs/testing.md)
- [Verificación frontend histórica](docs/verification.md)
- [Reporte seguridad](SECURITY.md)
- [Licencia Apache-2.0 y política contribución](docs/licensing.md)
- [Notices fuentes third-party](../../../THIRD_PARTY_NOTICES.md)

---

## 👨‍💻 Creador / Creator

**nu.vex es creado y mantenido por [Pablo](https://github.com/ImPaul17)** (ImPaul17).

- GitHub: [@ImPaul17](https://github.com/ImPaul17)
- Repositorio: [github.com/ImPaul17/nu.vex](https://github.com/ImPaul17/nu.vex)

> *Gracias por usar nu.vex. Cada estrella, issue, y contribución ayuda a construir comunicación verdaderamente independiente.*

---

## 📄 Licencia / License

El repositorio upstream es mantenido por `ImPaul17` y **no acepta contribuciones de código externas durante la Alpha**.
Puedes construir, modificar y mantener forks independientes bajo la licencia.
Ver [política de mantenimiento](CONTRIBUTING.md).

Licenciado bajo [Apache-2.0](../../../LICENSE), aprobado por el propietario el 19 Octubre 2026.
Preserva [NOTICE](../../../NOTICE) y [third-party notices](../../../THIRD_PARTY_NOTICES.md) aplicables.
Fuentes Geist/Geist Pixel retienen SIL OFL 1.1.
No se otorgan derechos de marca ni endorsamiento oficial a proyectos derivados.

---

## 🇪🇸 En Español

**nu.vex es un proyecto abierto y auto-hospedable bajo Apache-2.0.**
El hito actual integra cuentas reales y mensajería persistente con un servidor propio;
el estado verificable y los pendientes están en el registro de preparación para publicación.

**Para iniciar el cliente:**
```bash
npx --yes npm@11.21.1 ci && npm run dev
```
Las cuentas necesitan una instancia en marcha.
La demostración local se elige expresamente y **no sustituye** las pruebas multiusuario.

Durante la Alpha, `ImPaul17` mantiene el repositorio principal y **no se aceptan contribuciones externas de código**;
la licencia permite crear y modificar forks independientes.

---

## 🇺🇸 In English

**nu.vex is an open, self-hostable project under Apache-2.0.**
The current milestone integrates real accounts and persistent messaging with a self-hosted server;
verifiable status and pending work are tracked in the release readiness ledger.

**To start the client:**
```bash
npx --yes npm@11.21.1 ci && npm run dev
```
Accounts require a running instance.
The local demo is explicitly opted-in and **does not substitute** multi-user testing.

During Alpha, `ImPaul17` maintains the upstream repository and **does not accept external code contributions**;
the license permits building and maintaining independent forks.