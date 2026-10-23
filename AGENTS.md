# Repository Guidelines

## Project Structure & Module Organization

```
nu.vex/
apps/
  web/           # SvelteKit + Svelte 5 frontend (TypeScript, strict mode)
  desktop/       # Tauri 2 desktop app (Rust + web frontend)
  server/        # Rust/Axum/PostgreSQL backend API
packages/
  core/          # Shared models, theme validation, demo data (TypeScript)
  tokens/        # Shared CSS design tokens (theme.css)
docs/            # Architecture, milestones, deployment, licensing
infra/           # Docker Compose, proxy, backup/restore helpers
tests/           # Browser integration tests (Playwright)
logo-*           # Brand assets (PNG, SVG, PSD sources)
```

## Build, Test, and Development Commands

- Install dependencies (pinned npm 11.21.1):
  `npx --yes npm@11.21.1 ci`
- Run dev server (web + API proxy):
  `npm run dev`
- Type-check entire workspace:
  `npm run check`
- Run unit tests (Vitest):
  `npm test`
- Run browser E2E tests (Playwright):
  `npm run test:e2e`        # demo mode
  `npm run test:instance`   # real instance mode
- Build production web client:
  `npm run build`
- Run desktop app (requires Rust/Cargo + Tauri prerequisites):
  `npm run desktop:dev`
- Run server (requires PostgreSQL):
  `cargo run --manifest-path apps/server/Cargo.toml`

## Coding Style & Naming Conventions

- TypeScript: Strict mode, explicit types for public APIs, `type` over `interface` for primitives
- Svelte: Use `let` for mutable state, `$state`/`$derived` runes (Svelte 5), `bind:` for two-way
- Rust: Standard `cargo fmt`/`cargo clippy`, `snake_case` for functions/variables, `PascalCase` for types
- CSS: Custom properties for theming (`--accent`, `--glass`, `--radius`), `data-theme` attribute on root
- File naming: `kebab-case` for components (`MessageItem.svelte`), `camelCase` for utilities (`api.ts`)
- Imports: Use `@nuvex/core` and `$lib/` aliases; avoid relative imports beyond one level

## Testing Guidelines

- Unit tests: Vitest in `packages/core/src/*.test.ts` and alongside source files
- E2E tests: Playwright in `tests/` with separate demo/instance configs
- Coverage: Core models, theme validation, and demo logic must have tests
- Run single test file: `npx vitest run packages/core/src/themes.test.ts`

## Commit & Pull Request Guidelines

- Commit messages: Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
  - Example: `feat: add theme import/export with JSON validation`
- Scope: Keep commits focused; separate refactoring from feature work
- Pre-release: All releases are pre-release (alpha); version format `v0.x.x-alpha.y`
- PR requirements:
  - Run `npm run check && npm test` before pushing
  - Include screenshots for UI changes
  - Link related issues/docs
  - Spanish primary, English secondary for user-facing text

## Security & Configuration Tips

- Instance connections: HTTPS required (HTTP only on localhost); CORS locked to configured origin
- Credentials: Never stored in localStorage; native transport keeps tokens in Rust memory
- Environment: Copy `.env.example` to `.env` for server; never commit secrets
- Rate limiting: Built-in on auth, messages, and WebSocket connections
- Content Security Policy: Strict CSP in `tauri.conf.json`; no inline scripts in production

## Architecture Overview

- Client (SvelteKit) <-> Instance API (REST + WebSocket) via `InstanceApi` service
- Desktop uses restricted native transport (`native.ts`) for secure token storage
- Server (Axum) handles auth, communities, channels, messages, real-time events
- Database: PostgreSQL with migrations in `apps/server/migrations/`
- Themes: Data-only JSON (validated <=16 KB); no CSS/URLs/scripts allowed
- Federation: Not implemented; each instance is independent

## Agent-Specific Instructions

- Never commit to `main` directly; use feature branches
- Prefer editing existing components over creating new ones when possible
- Document user-facing changes in Spanish first, then English
- Test both demo mode and real instance mode for messaging features
- Verify theme changes work in all three base themes (emerald, midnight, light)