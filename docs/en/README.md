# nu.vex — English documentation

[Español (primary)](../../README.md)

nu.vex is an independent communication platform created by **Pablo / ImPaul17**. It shares a Svelte 5 client between web and Tauri desktop and uses Rust/Axum with PostgreSQL for accounts, communities, text channels, invitations and durable messaging.

All releases remain **Alpha pre-releases**. The published baseline is v0.2.0-alpha.6. Changes on this feature branch are not included in that installer.

## Current client changes

The chat uses larger text, fewer decorative elements, collapsible categories, an optional member panel and a focus mode. Six recently used instance addresses can be saved locally. Sessions for different instances remain separate in memory while the client stays open. Switching instances closes the active event subscription, clears the visible workspace and reloads the target account and history.

The native desktop mediator still supports one connection per window; switching servers requires login again. Browser session caching does not reuse invalid native handles. Passwords and bearer tokens are never stored in localStorage. Remote sessions require login after a page reload. One account per instance is supported at a time; multiple accounts on the same instance and external identity providers remain planned. Only the currently selected instance has an active event subscription.

## Own-account Cloudflare deployment

The Alpha client and API are live at [nuvex-alpha.pablomerino2008.workers.dev](https://nuvex-alpha.pablomerino2008.workers.dev). Public health and instance-information requests return **200**, and the tunnel readiness endpoint confirms active connectivity. The current Worker version is `06f864db-46de-4283-bca5-a51161fb7450`, including voice. The initial four public service scenarios passed in Edge in 17.2 seconds; the subsequent two public voice scenarios passed in 10.4 seconds.

Workers serves the static SvelteKit client. The `NUVEX_API` binding connects API and health requests to the `nuvex-central-api` HTTP VPC Service, targeting Axum at `127.0.0.1:3003` through the private `nuvex-central-pc` Tunnel. The connector is running; both public HTTP and WebSocket behavior have been checked. `wrangler.jsonc` records the deployment configuration.

The local Axum process has confirmed readiness using the exact HTTPS client origin and registration enabled. Its service database is `nuvexcentral` on `127.0.0.1:55433`, in a dedicated cluster with the restricted `nuvex_app` role. Its data and credentials are separate from development and automated-test databases. PostgreSQL is not published directly to the Internet.

While the backend runs on this PC, account and messaging availability depends on the computer remaining powered on, online, and running PostgreSQL, Axum and cloudflared. The static client can remain hosted when the PC is offline, but its API will be unavailable. **No Windows service or automatic startup task has been installed.** After a PC restart, the cluster, backend and connector must be started with the PowerShell 7 scripts. The verified restart affected Axum, not the entire PC. The demo contains separate temporary sample data.

`npm run web:export` builds the client and exports `.cache/cloudflare/web`, including local fonts and a hash-based script CSP. `npm run test:cloudflare` tests the proxy behavior locally. `npm run cloudflare:deploy` uses the project's pinned Wrangler command to deploy the Worker and assets. None of those local checks alone verifies the live VPC connection.

The operational scripts require **PowerShell 7 (`pwsh`)**. `scripts/instance/init-central.ps1` prepares or reuses the service database; `start-central.ps1` starts Axum with the exact HTTPS origin and an explicit registration setting. `start-tunnel.ps1` is the connector launcher in use: it validates the pinned executable, protected token file and process identity, starts cloudflared hidden, and checks `http://127.0.0.1:20263/ready` without exposing its credential. The connector PID checked during this run was 36044; PIDs must be read from runtime state after a restart.

`backup-central.ps1` and `test-restore-central.ps1` restored a second backup containing **four synthetic accounts and four synthetic messages** from public validation into the separate database `nuvexcentral_restore_20261026_9b76e3f230fb`. Schema, fingerprints and row counts match; the receipt records `sourceModified: false`. The additional synthetic account/message transaction was rolled back. This verifies those synthetic data, not real user conversations. Credentials, backups and receipts stay in the private, Git-ignored service directory.

Another backup was taken before cleanup of the thirteen synthetic validation accounts. Only those thirteen exactly identified fixtures were removed after checking their relationships. The delivered service database contains **zero accounts and zero messages**. Pablo's account and community have not been created with invented credentials; they remain for the user's real registration and community-creation flow.

An earlier public run passed history recovery and WebSocket revocation checks. A latency race in the initial access screen was fixed in `2367978`: login/registration controls now wait for session restoration, preventing a delayed real 401 from changing a newly selected registration view. The regression fails before the fix and passes after it; the client was exported and deployed again.

The final combined run passed **four of four public scenarios in Edge in 17.2 seconds** after `2367978` and the recorded Worker deployment. It covered registration/login, invitations and two accounts exchanging messages over WebSocket, history after reload, revocation and restoration/delayed-401 regressions.

A real restart of the owned Axum process was also checked through the public API: the same session cookie recovered its account, membership and persisted message after a new process started. The tunnel remained active. After the voice upgrade, another backup with both migrations, four synthetic accounts and one message was restored successfully into a separate database. The four acceptance accounts were then removed using their exact UUIDs and relationship checks; the service is empty for initial registration. Runtime PIDs and restart, restore and cleanup receipts remain local and private; credentials, cookies and access traces are not committed. Continuous operation across a full PC restart and Pablo's official account/community remain separate items. See the Spanish [deployment guide](../web-deployment.md) and [local service guide](../local-instance.md).

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

Web voice is now published in Alpha: up to eight participants using WebRTC audio, authenticated signaling, explicit microphone permission, self mute/deafen, input/output selection, and global/per-person playback volume. Calls remain active while using text channels. Leaving, switching instances, disconnecting, or losing access stops local capture. Participant revisions prevent delayed rosters from ending a newer call. See the Spanish [voice guide](../voice.md) and [server protocol](../voice-server.md).

Two local voice scenarios passed in Edge in 7.8 seconds; the same two scenarios passed against the actual Cloudflare deployment in 10.4 seconds. Tests used synthetic microphone audio and verified inbound RTP packets in both clients, revocation, denied microphone permission, participant identity, UI channel creation, all three themes, and mobile width. Both clients ran on one PC. The native transport passed eleven unit tests; one native TLS integration test was explicitly skipped. A new desktop installer and physical microphone acceptance remain pending.

Voice currently uses peer-to-peer mesh and Cloudflare STUN. A production TURN relay, SFU, distinct-network/device acceptance, push-to-talk, speaking detection, and dedicated voice moderation remain planned. [REA research](../research/discord-voice.md) records the bounded Discord artifact analysis and native disassembly with hashes and limitations; it does not establish complete product equivalence.

Other planned capabilities include the official nu.vex community, direct/group messages, friend requests and blocking, custom roles and moderation, authorized attachment storage, video/screen sharing, external account providers, mobile apps, signed desktop updates, a community theme catalog and bot identities with scoped permissions. Federation is a separate protocol proposal, not a property of switching between independent instances.

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
