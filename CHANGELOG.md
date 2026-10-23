# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/) (pre-release only).

> ⚠️ **Solo pre-releases**: Todas las versiones son alpha/beta hasta v1.0.0.
> Formato: `v0.x.x-alpha.y` o `v0.x.x-beta.y`

---

## [Unreleased] - En desarrollo

### Added
- **MASTER_PLAN.md**: Plan maestro completo con 10 fases de implementación
- **AGENTS.md**: Guía para contribuidores (project structure, commands, style, testing, commits)
- **README.md** reescrito: Español primario, inglés secundario, badges, atribución de creador

### Changed
- Documentación principal cambiada a español con inglés como secundario

### Infrastructure
- Preparación para GitHub Actions CI/CD (pendiente configuración)

---

## [v0.2.0-alpha.6] - 2026-10-21

### Added
- Instaladores desktop descargables: Windows x64 (.exe/.msi), Linux x64 (.deb), macOS ARM64 (.dmg)
- Transporte nativo restringido para credenciales seguras (Tauri)
- Verificación de compilación en Windows x64, Linux x64, macOS ARM64
- Suite TLS de producción (14 casos HTTPS/WSS, certificado, redirect)

### Fixed
- Corrección de toolchain npm (fijado npm 11.21.1)
- Override de dependencia `cookie` temporal

### Security
- Content Security Policy estricta en tauri.conf.json
- Credenciales bearer solo en memoria nativa (no localStorage)

---

## [v0.2.0-alpha.5] - 2026-10-19

### Added
- Servicio Rust/Axum/PostgreSQL completo
- Migraciones de base de datos
- Registro/Login/Logout con rate limiting
- Comunidades, canales de texto, mensajes persistentes
- WebSocket events autenticados (tiempo real)
- Docker Compose para auto-hospedaje
- Health checks (/health/live, /health/ready)

### Changed
- Arquitectura: Cliente web (SvelteKit) ↔ Instance API (REST + WebSocket)
- Desktop: Tauri 2 host compartiendo frontend web

---

## [v0.2.0-alpha.4] - 2026-10-15

### Added
- Sistema de temas: 3 base themes (emerald, midnight, light)
- Import/Export temas JSON validados (≤16 KB)
- Custom accent color, glass opacity, border radius, density
- Validación estricta de temas (sin CSS/URLs/scripts)

### Added (Frontend)
- ChatShell: comunidades, canales, mensajes, miembros, búsqueda
- Composer con emoji picker
- Appearance modal
- Responsive layout (breakpoints 620-1600px)
- Reduced-motion support

---

## [v0.2.0-alpha.3] - 2026-10-10

### Added
- SvelteKit + Svelte 5 + TypeScript strict setup
- Tauri 2 scaffold
- Shared packages: @nuvex/core, @nuvex/tokens
- Demo mode con datos de ejemplo
- Vitest + Playwright test setup

---

## [v0.2.0-alpha.2] - 2026-10-05

### Added
- Brand assets oficiales (logos, PSD sources)
- Geist/Geist Pixel fonts (SIL OFL 1.1)
- Apache-2.0 license approved
- Repository structure (npm workspaces + Cargo workspaces)

---

## [v0.2.0-alpha.1] - 2026-10-01

### Added
- Initial repository setup
- Project initialization
- Basic folder structure

---

## Convenciones de Versionado / Versioning Conventions

| Tipo | Formato | Ejemplo |
|------|---------|---------|
| Alpha | `v0.x.x-alpha.y` | `v0.2.0-alpha.7` |
| Beta | `v0.x.x-beta.y` | `v0.3.0-beta.1` |
| Release Candidate | `v0.x.x-rc.y` | `v0.4.0-rc.1` |
| Stable (futuro) | `vx.y.z` | `v1.0.0` |

**Tags con fecha**: `v0.2.0-alpha.7-20261023`

---

## Tipos de Cambio / Change Types

- **Added** - Nuevas características
- **Changed** - Cambios en funcionalidad existente
- **Deprecated** - Funcionalidad que se eliminará
- **Removed** - Funcionalidad eliminada
- **Fixed** - Corrección de bugs
- **Security** - Correcciones de seguridad
- **Infrastructure** - CI/CD, tooling, deps, docs internas

---

## Enlaces / Links

- [Repositorio](https://github.com/ImPaul17/nu.vex)
- [Releases](https://github.com/ImPaul17/nu.vex/releases)
- [Issues](https://github.com/ImPaul17/nu.vex/issues)
- [MASTER_PLAN.md](MASTER_PLAN.md)
- [AGENTS.md](AGENTS.md)