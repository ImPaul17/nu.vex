# MASTER PLAN - nu.vex Platform Evolution

## Visión General / Overview

Transformar nu.vex en una **plataforma de comunicación federada/descentralizada** estilo Discord pero con:
- **Instancia centralizada** (Nuvex Community) + **auto-hospedaje** para equipos/empresas
- **Marketplace de temas** comunitario
- **Auto-actualización nativa** (Windows/Linux/macOS)
- **Multi-plataforma**: Web PWA + Desktop (Tauri) + Móvil (futuro Capacitor/React Native)
- **Integración Discord** (webhooks, bridge, OAuth)
- **Sistema completo**: Canales voz, roles, moderación, DMs, friend requests, bots
- **Personalización profunda**: Temas inmersivos, CSS custom, plugins
- **Documentación**: Español primario, inglés secundario
- **Attribution**: Creador incluido en todo

---

## FASES DE IMPLEMENTACIÓN / IMPLEMENTATION PHASES

### FASE 0: FUNDACIÓN Y DOCUMENTACIÓN (Semana 1-2) ✅ EN PROGRESO
- [x] AGENTS.md - Guía para contribuidores
- [ ] MASTER_PLAN.md - Este documento
- [ ] README.md completo en español + inglés
- [ ] CHANGELOG.md con formato convencional
- [ ] CONTRIBUTING.md en español
- [ ] LICENSE headers con atribución de creador
- [ ] Configurar GitHub Actions para CI/CD pre-release
- [ ] Versionado semántico pre-release (v0.x.x-alpha.y)

### FASE 1: UI/UX CORE - INTERFAZ MINIMALISTA Y AMIGABLE (Semana 2-4)
- [ ] Rediseño entry page (landing + login/connect)
- [ ] ChatShell: simplificar, reducir ruido visual
- [ ] Sidebar comunidades: colapsable, búsqueda, favoritos
- [ ] Canal sidebar: categorías colapsables, pins, unread badges
- [ ] Panel miembros: roles visuales, status, acciones rápidas
- [ ] Composer: adjuntos, markdown, slash commands, emoji picker mejorado
- [ ] Tema "Nuvex" por defecto + 3 base themes
- [ ] Animaciones sutiles (reduced-motion respectado)
- [ ] Accesibilidad completa (WCAG AA)
- [ ] Mobile-first responsive (breakpoints: 620, 760, 1020, 1200, 1600)

### FASE 2: SISTEMA DE CUENTAS Y MULTI-INSTANCIA (Semana 4-6)
- [ ] Registro/Login mejorado (validación, fortaleza password, 2FA futuro)
- [ ] **Selector de instancias** mejorado (guardar 6+, búsqueda, favoritos)
- [ ] **Instancia Nuvex Central** (deploy en Railway/Render/Fly.io)
- [ ] **Auto-hospedaje**: docs completas, docker-compose, scripts setup
- [ ] Migración de cuenta entre instancias (export/import)
- [ ] Múltiples sesiones simultáneas (web + desktop + móvil)
- [ ] Gestión de dispositivos/sesiones activas
- [ ] Recuperación de cuenta (email, códigos backup)

### FASE 3: CANALES AVANZADOS Y MODERACIÓN (Semana 6-10)
- [ ] **Canales de voz** (WebRTC + SFU - mediasoup/Janus)
- [ ] **Sistema de roles** jerárquico (Owner > Admin > Mod > Member > Guest)
- [ ] **Permisos granulares** por canal/categoría (ver, enviar, gestionar, voz, adjuntos)
- [ ] **Moderación**: timeout, kick, ban, purge, slowmode, audit log
- [ ] **Categorías anidadas** y canales de anuncio
- [ ] **Hilos/Threads** en canales de texto
- [ ] **Canales de solo lectura** (anuncios, reglas)
- [ ] **Webhooks** entrantes/salientes + Discord bridge

### FASE 4: MENSAJERÍA PRIVADA Y SOCIAL (Semana 10-14)
- [ ] **DMs 1:1** (cifrado en tránsito, persistencia en instancia)
- [ ] **DMs grupales** (hasta 10 personas)
- [ ] **Solicitudes de amistad** (invitación, aceptación, bloqueo)
- [ ] **Presencia rica**: estado personalizado, actividad, rich presence
- [ ] **Notificaciones push** (web push API, desktop native)
- [ ] **Menciones** (@usuario, @rol, @everyone, @here)
- [ ] **Reacciones** completas + reacciones personalizadas por instancia

### FASE 5: ARCHIVOS Y MEDIA (Semana 14-18)
- [ ] **Adjuntos**: imágenes, videos, audio, documentos, código
- [ ] **Previsualización**: inline images, video player, audio player, PDF viewer
- [ ] **Notepads/Documentos colaborativos** (TipTap/ProseMirror + Yjs)
- [ ] **Galería multimedia** por canal/comunidad
- [ ] **Cuotas de almacenamiento** por instancia/usuario
- [ ] **CDN** para assets (Cloudflare R2, S3 compatible)
- [ ] **Compresión/optimización** automática (sharp, ffmpeg.wasm)

### FASE 6: ECOSISTEMA DE BOTS Y API (Semana 18-24)
- [ ] **Gateway WebSocket** para bots (eventos, REST API)
- [ ] **Permisos de bot** (scopes, OAuth2)
- [ ] **SDK TypeScript/Rust/Python** para desarrolladores
- [ ] **Tienda de bots** comunitaria (review, ratings, verified)
- [ ] **Slash commands** + context menus + autocomplete
- [ ] **Webhooks** para integraciones externas
- [ ] **App Directory** (bots, integraciones, temas, plugins)

### FASE 7: PERSONALIZACIÓN PROFUNDA Y TEMAS (Semana 24-30)
- [ ] **Theme Engine v2**: CSS variables completas, color schemes, tipografía
- [ ] **Temas inmersivos**: fondos animados, partículas, shaders (canvas/webgl)
- [ ] **Custom CSS** por usuario (sandboxed, CSP-safe)
- [ ] **Marketplace de temas**: subir, valorar, instalar 1-click
- [ ] **Theme builder visual** (color picker, preview en vivo)
- [ ] **Importar temas** de Discord (BetterDiscord), VS Code, etc.
- [ ] **Plugins UI**: widgets, custom panels, status bar items

### FASE 8: DESKTOP NATIVO Y AUTO-ACTUALIZACIÓN (Semana 30-36)
- [ ] **Tauri v2** optimizado (sidecar, system tray, native notifications)
- [ ] **Auto-updater** (Tauri updater + GitHub Releases)
  - [ ] Verificación de firma (cosign/minisign)
  - [ ] Delta updates (bsdiff)
  - [ ] Background download + install on restart
  - [ ] Rollback automático si falla
- [ ] **Instalador Windows** (MSI + EXE, code signing futuro)
- [ ] **Linux**: .deb, .rpm, AppImage, Flatpak
- [ ] **macOS**: .dmg, notarization, Sparkle fallback
- [ ] **System tray**: minimizar, notificaciones, quick actions
- [ ] **Protocol handler**: `nuvex://` para deep links

### FASE 9: MÓVIL Y PWA (Semana 36-44)
- [ ] **PWA** completa (service worker, offline, install prompt)
- [ ] **Capacitor** wrapper para iOS/Android
- [ ] **Push notifications** (FCM/APNs via Tauri/Capacitor)
- [ ] **Biometric auth** (FaceID, TouchID, Windows Hello)
- [ ] **Share extension** (enviar a nu.vex desde otras apps)
- [ ] **Widget** pantalla de inicio (últimos mensajes, estado)

### FASE 10: FEDERACIÓN Y COMUNIDAD NUVEX (Semana 44-52)
- [ ] **Protocolo de federación** (ActivityPub? Matrix? Propio?)
- [ ] **Descubrimiento de instancias** (webfinger, nodeinfo)
- [ ] **Comunidad Nuvex Central**: foro, anuncios, soporte, marketplace temas
- [ ] **Directorio público** de instancias verificadas
- [ ] **Backup/restore** cross-instancia
- [ ] **Migración de comunidad** entre instancias

---

## PRIORIDADES INMEDIATAS / IMMEDIATE PRIORITIES (PRÓXIMAS 2 SEMANAS)

1. **MASTER_PLAN.md** ✅ (este archivo)
2. **README.md** en español/inglés con badges, screenshots, quick start
3. **CHANGELOG.md** + convenciones de commit
4. **Deploy instancia Nuvex Central** (Railway/Fly.io gratis)
5. **UI Entry Page**: limpiar, hacer más acogedora, copy en español
6. **Theme system**: documentar, añadir más presets, export/import UX
7. **GitHub Actions**: CI (check, test, build) + Release draft automático
8. **Attribution**: headers de licencia, about modal, footer

---

## STACK TECNOLÓGICO ADICIONAL / ADDITIONAL TECH STACK

| Necesidad | Tecnología Candidata | Decisión |
|-----------|---------------------|----------|
| Voice/Video SFU | mediasoup / Janus / LiveKit | **mediasoup** (Rust bindings, control total) |
| Base de datos | PostgreSQL (actual) | Mantener + Redis para cache/sessions |
| CDN/Storage | Cloudflare R2 / Tigris / MinIO | **Cloudflare R2** (gratis 10GB, S3 API) |
| Search | Meilisearch / Typesense | **Meilisearch** (open source, rápido) |
| Colab docs | Yjs + TipTap / ProseMirror | **Yjs + TipTap** (WebRTC, CRDT) |
| Push notifications | Web Push API + VAPID | Nativo + Tauri plugins |
| Mobile | Capacitor / Tauri Mobile | **Capacitor** (ecosistema Ionic, maduro) |
| Theme marketplace | Backend propio + GitHub Pages | **GitHub Pages + API** (simple, gratis) |
| Code signing | cosign / minisign / Sigstore | **Sigstore** (gratis, keyless) |

---

## ESTRUCTURA DE RAMAS / BRANCH STRATEGY

```
main (protected, solo releases pre-release)
├── develop (integración continua)
├── feature/* (nuevas features)
├── fix/* (bug fixes)
├── docs/* (documentación)
├── refactor/* (refactoring)
├── chore/* (tooling, deps, CI)
└── release/v0.x.x-alpha.y (preparación release)
```

---

## CONVENCIONES / CONVENTIONS

### Commits (Conventional Commits + español)
```
feat(ui): rediseño entry page con copy en español
fix(auth): corrección validación email en registro
docs(readme): añadir badges y quick start en español
chore(ci): configurar GitHub Actions para pre-release
refactor(theme): extraer ThemeEngine a package core
```

### Versionado
- **Pre-release únicamente**: `v0.2.0-alpha.7`, `v0.3.0-beta.1`, `v0.4.0-rc.1`
- **Sin releases estables** hasta v1.0.0
- **Fecha en tag**: `v0.2.0-alpha.7-20261023`

### Documentación
- **Español primario**: README, docs/, CHANGELOG, UI strings
- **Inglés secundario**: sección "In English" al final de cada doc
- **Código**: comentarios en inglés (estándar industria)

---

## ATRIBUCIÓN DE CREADOR / CREATOR ATTRIBUTION

Incluir en:
- `package.json` → `author: "Tu Nombre <email@dominio.com>"`
- `Cargo.toml` → `authors = ["Tu Nombre <email@dominio.com>"]`
- `LICENSE` / `NOTICE` → Apache-2.0 con copyright
- `About modal` → "Creado por [Tu Nombre]"
- `Footer` web/desktop → "© 2026 Tu Nombre. nu.vex es open source."
- `GitHub profile` → Pinned repo, bio mention
- `Release notes` → "Thanks to [Tu Nombre] for creating nu.vex"

---

## MÉTRICAS DE ÉXITO / SUCCESS METRICS

| Métrica | Target Fase 1 | Target Fase 5 | Target Fase 10 |
|---------|--------------|---------------|----------------|
| Instancias activas | 1 (central) | 10+ | 100+ |
| Usuarios registrados | 50 | 1,000 | 50,000 |
| Mensajes/día | 1,000 | 100,000 | 5M |
| Temas en marketplace | 3 base | 50+ | 500+ |
| Bots verificados | 0 | 10 | 100+ |
| Plataformas soportadas | Web + Desktop | + Mobile PWA | + iOS/Android native |
| Cobertura tests | 60% | 80% | 90% |

---

## RIESGOS Y MITIGACIÓN / RISKS & MITIGATION

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Scope creep | Muy alta | Crítico | Fases estrictas, no saltar fases |
| WebRTC complexity | Alta | Alto | Usar mediasoup, no reinventar |
| Federation design | Media | Alto | Posponer a Fase 10, research primero |
| Mobile performance | Media | Medio | PWA first, native wrapper después |
| Theme security (XSS) | Media | Crítico | CSP estricto, sandbox CSS, validación |
| Auto-update security | Baja | Crítico | Firmas criptográficas, Sigstore |
| Burnout | Alta | Crítico | Fases pequeñas, celebrear hits, docs |

---

## PRÓXIMOS PASOS INMEDIATOS / NEXT STEPS

1. **Crear MASTER_PLAN.md** ✅
2. **Reescribir README.md** en español/inglés
3. **Crear CHANGELOG.md** 
4. **Configurar GitHub Actions** (CI + Release drafter)
5. **Deploy instancia Nuvex Central** (Railway gratis)
6. **Rediseñar Entry Page** (+page.svelte)
7. **Mejorar Theme System** (más presets, mejor UX import/export)
8. **Primer commit** con todo lo anterior

---

*Documento vivo - actualizar conforme avance el proyecto*
*Last updated: 2026-10-23*