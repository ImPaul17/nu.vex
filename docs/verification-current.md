# Real-instance milestone verification — 19 October 2026

This record covers the transition from the initial frontend shell to a service-backed messaging client. Results below distinguish checks rerun after the latest frontend session/reconciliation corrections from earlier checks. They do not certify a production release. The [phase 0/1 record](verification.md) remains a separate historical snapshot.

## Latest frontend and infrastructure checks

These checks passed after the client corrections for session epochs, stale history responses, deleted-message reconciliation, pagination generations, and WebSocket resynchronization/backoff:

| Check actually executed | Result |
| --- | --- |
| `npm run check` | 0 errors, 0 warnings; strict TypeScript checks passed |
| `npm test` | 12 core unit tests passed |
| `node --test infra/infra.test.mjs` | 3 infrastructure boundary tests passed |
| `npm run build` | Static production frontend build passed; output `apps/web/build` |
| `npm run test:instance` with installed Edge and `NUVEX_E2E_REMOTE_URL=http://127.0.0.1:3001` | Latest real-instance browser run passed: 4 tests in 20.7 seconds |
| `npm run test:e2e` with installed Edge | Current demo browser run passed: 5 tests in 9.8 seconds |

The core suite covers client validation, demo models, and safe theme data. The infrastructure suite covers restore-name boundaries, dump metadata/hash validation, and generated script CSP. Neither suite substitutes for a running database, browser account flow, or container deployment.

## Native service and database evidence

Verification used the repository-local Windows Rust/GNU toolchain and native PostgreSQL 17.11, documented in [the toolchain record](toolchain-local.md).

| Check actually executed | Result and timing |
| --- | --- |
| Rust tests, formatting, Clippy, and server build | Earlier run passed: 14 tests, formatting/Clippy, and build; not represented as a fresh run after later frontend changes |
| `npm run test:server` / `node scripts/verify-instance.mjs` | Final native REST/restart run passed all 11 acceptance groups |
| `./scripts/dev-tools/verify-backup.ps1` | Earlier native custom-dump/new-database restore passed; fingerprints of 8 tables matched and the source was unchanged |

The 11 REST acceptance groups cover:

1. Reapplicable migrations and instance readiness.
2. Real accounts using opaque bearer tokens and HttpOnly browser sessions.
3. Missing/foreign-origin mutation denial.
4. Idempotent invitation membership and owner-action permissions.
5. Idempotent sends and prevention of deleted-message resurrection.
6. Cursor pagination of 41 visible messages and history/message bounds.
7. Browser/bearer logout revocation persisted in PostgreSQL.
8. Process restart preserving accounts, permissions, revocations, and history.
9. Membership removal immediately blocking reads/writes while retaining the account session.
10. A bound on unconsumed realtime tickets per user.
11. Bounded authentication request rates.

The harness starts and restarts its own loopback server and retains uniquely prefixed synthetic records in a dedicated development/test database. It does not provide a full browser/WebSocket or external HTTPS deployment test. The native recovery check does not execute the Docker backup/restore helpers.

## Latest real-instance browser verification

The latest four-test instance suite passed using installed Microsoft Edge, the local real backend, and the Vite frontend. It exercised two real users with login, realtime delivery, independent sessions, and the configured remote-origin bearer flow. Bearer credentials were absent from browser local/session storage, and reloading that bearer client required login again.

The other three scenarios exercised a delayed history response after realtime deletion, a delayed private workspace response after switching accounts, and pagination across history resynchronization/reconnection. These checks cover the concrete races corrected during this milestone; they are not a general network-fault or cross-browser certification. `npm run check` was repeated with the final four-test configuration and again reported 0 errors/0 warnings.

The first retest timed out after 60 seconds during registration while a production web build was running concurrently. Repeating without a concurrent build passed all four tests without further source changes. The cause of the first timeout was not established. The demo suite was subsequently rerun in Edge and passed all 5 tests in 9.8 seconds; its earlier results remain in the [initial verification record](verification.md).

## Deployment and publication boundary

- The isolated WSL Docker attempt stopped before daemon startup: Ubuntu could not start even `/bin/true`, reporting `Wsl/Service/CreateInstance/E_FAIL`. No `docker compose config`, image build, Compose startup, or container recovery drill ran locally.
- A dedicated disposable Compose CI job is prepared to build/start the real stack, reuse REST/restart checks, restore a new database, and run the browser suite through Nginx on port 8080. This source/configuration is not successful container execution. Record actual runner results after they exist.
- Tauri source/configuration inspection and native backend builds do not verify a packaged desktop client, installers, signing, or macOS/Linux behavior.
- GitHub CLI authentication as `ImPaul17` was verified using the system keyring. The public [ImPaul17/nu.vex repository](https://github.com/ImPaul17/nu.vex) already existed with README commit `2b50e46`; this does not establish publication of the current source. Source push, hosted CI results, and release downloads remain unconfirmed.
- Private vulnerability reporting was enabled and verified through GitHub's API (`enabled: true`); [SECURITY.md](../SECURITY.md) links the actual reporting form. This does not promise response deadlines or establish a security audit.
- Apache-2.0 was approved and applied; this legal/project milestone is separate from deployment and release verification.

See [release readiness](release-readiness.md) for remaining product work and [testing](testing.md) for reproducible commands and prerequisites.
