# nu.vex — English documentation

[Español (primary)](../../README.md)

nu.vex is an independent communication platform created by **Pablo / ImPaul17**. It shares a Svelte 5 client between web and Tauri desktop and uses Rust/Axum with PostgreSQL for accounts, communities, text channels, invitations and durable messaging.

All releases remain **Alpha pre-releases**. The published baseline is v0.2.0-alpha.6. Changes on this feature branch are not included in that installer.

## Current client changes

The chat uses larger text, fewer decorative elements, collapsible categories, an optional member panel and a focus mode. Six recently used instance addresses can be saved locally. Sessions for different instances remain separate in memory while the client stays open. Switching instances closes the active event subscription, clears the visible workspace and reloads the target account and history.

The native desktop mediator still supports one connection per window; switching servers requires login again. Browser session caching does not reuse invalid native handles. Passwords and bearer tokens are never stored in localStorage. Remote sessions require login after a page reload. One account per instance is supported at a time; multiple accounts on the same instance and external identity providers remain planned. Only the currently selected instance has an active event subscription.

The previous ChatGPT Sites hosting is discarded at the user's request. The replacement is an **own-account Cloudflare deployment**, still pending authentication, provisioning and publication; no new Cloudflare URL has been verified yet.

The preferred architecture serves the static SvelteKit client from Workers at an assigned workers.dev URL. A private Cloudflare Tunnel and Workers VPC HTTP service connect API requests to the existing Rust/Axum server and PostgreSQL on the authorized PC. PostgreSQL will remain private and use a service database and credentials separate from the development and automated-test databases.

While the backend runs on this PC, account and messaging availability depends on the computer remaining powered on, online, and running PostgreSQL, Axum and cloudflared. The static client can remain hosted when the PC is offline, but its API will be unavailable. The demo contains temporary sample data and does not demonstrate a running central service.

The real deployment must verify HTTP authentication, WebSocket upgrades and messages, revocation, restart persistence and backup/restore through the Cloudflare path. A temporary trycloudflare.com Quick Tunnel is a development aid, not a stable production hostname. See the Spanish [deployment plan](../web-deployment.md) and the official [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Workers VPC](https://developers.cloudflare.com/workers-vpc/get-started/) and [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) documentation.

## Development

Use Node.js 22.14+ on the 22.x line, or Node.js 24+, with pinned npm 11.21.1.

```sh
npx --yes npm@11.21.1 ci
npm run dev
npm run check
npm test
npm run build
npm run test:e2e
npm run test:instance
```

Unit tests use node:test through tsx. Real-instance tests need a running backend and PostgreSQL. On Windows, set `PLAYWRIGHT_CHANNEL=msedge` to use installed Edge. The new multi-instance test also accepts `NUVEX_E2E_SECOND_INSTANCE`, pointing to a second server with an independent database.

## Product milestones

Planned capabilities include the official nu.vex community, direct/group messages, friend requests and blocking, custom roles and moderation, authorized attachment storage, WebRTC voice/video, external account providers, mobile apps, signed desktop updates, a community theme catalog and bot identities with scoped permissions. Federation is a separate protocol proposal, not a property of switching between independent instances.

The update path for the Rust/Tauri app is a signed Tauri updater, not NuGet. Signing keys, release metadata and upgrade/recovery tests must exist before automatic installation is enabled.

See the Spanish [roadmap](../roadmap.md), [architecture](../architecture.md), [UI notes](../interface.md), [hosting record](../web-deployment.md) and [verification ledger](../verification-current.md) for current acceptance and status.

## Historical technical reference

The complete previous guides are preserved here. Their test receipts apply only to the recorded revisions. Relative links resolve to either this archive or current project sources.

- [Architecture](original/docs/architecture.md)
- [Self-hosting, HTTPS and recovery](original/docs/self-hosting.md)
- [Server protocol and security](original/apps/server/README.md)
- [Desktop transport, packaging and runtime tests](original/docs/desktop.md)
- [Testing and acceptance harnesses](original/docs/testing.md)
- [Release readiness](original/docs/release-readiness.md)
- [Verification receipts](original/docs/verification-current.md)
- [Branding](original/docs/branding.md)
- [Infrastructure](original/infra/README.md)

Licensed under Apache-2.0. Preserve LICENSE, NOTICE and third-party notices. Geist fonts retain SIL OFL 1.1. The original license texts remain authoritative.
