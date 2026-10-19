# Testing and verification

Run commands from the repository root. Use Node versions recorded in the [README](../README.md), install the committed dependency graph with `npx --yes npm@11.21.1 ci`, and report actual command results. The pinned manager avoids the workspace-override bug in older npm without changing global npm. Ordinary `npm run`/`npm test` commands below can use the host npm after that installation. Test files are implementation, not proof that a test has passed.

## Type checks, unit tests, and production build

```sh
npm run check
npm test
npm run build
```

`check` synchronizes SvelteKit's generated configuration, runs Svelte/TypeScript diagnostics, and strictly type-checks the shared core plus test/config files. `test` runs the Node test runner through `tsx` against `packages/core/src/*.test.ts`. `build` generates the static frontend in `apps/web/build`. [Current verification](verification-current.md) records actual results and their timing; the [phase 0/1 verification](verification.md) remains historical. Product and deployment gaps are tracked in [release readiness](release-readiness.md).

The core suite covers message validation and length limits, local-message creation, seed references, theme round trips, allowed values/ranges, rejected fields and injection strings, malformed JSON, and the 16 KiB UTF-8 theme limit. These client unit tests do not verify the newer server authentication or PostgreSQL persistence implementation.

For dependency changes, also inspect the resolved override and advisory report with the pinned manager:

```sh
npx --yes npm@11.21.1 ls cookie
npx --yes npm@11.21.1 audit
```

The expected current override is `cookie@0.7.2`; report the actual resolution and audit output. An advisory database check is time-dependent and is not a security audit of the application. See the [dependency policy](environment.md) before removing or updating this override.

To inspect the production web output after a successful build:

```sh
npm run preview
```

Open the address printed by the preview server. Development and preview bind to loopback by default. The preview server is for inspection, not a supported production server deployment.

## Browser integration tests

The Playwright suite in `tests/shell.spec.ts` runs a real browser against the explicit `/demo` fixture. It checks client behavior independently of the server. Install the matching Chromium browser once if it is not already installed:

```sh
npx playwright install chromium
npm run test:e2e
```

Alternatively, on Windows with an existing Microsoft Edge installation, use PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
Remove-Item Env:\PLAYWRIGHT_CHANNEL
```

`PLAYWRIGHT_CHANNEL` selects an installed browser; setting it does not install that browser. Leave it unset to use Playwright's default Chromium. On Linux CI, browser dependencies may also be needed; the configured CI workflow should use `npx playwright install --with-deps chromium` in its disposable runner.

CI must first install dependencies with `npx --yes npm@11.21.1 ci`, matching local lockfile generation. A runner's preinstalled npm version must not silently replace that step.

`playwright.config.ts` uses `http://127.0.0.1:5173` and starts `npm run dev`. Keep the port available. Locally it may reuse an existing server at that address; ensure it belongs to this checkout. CI creates its own server and rejects focused tests. Failure traces and screenshots are written under Playwright's output directories; do not commit these generated artifacts.

The current browser scenarios exercise:

- Channel isolation, plain-text rendering of hostile markup, search, and reset of local messages on reload.
- Appearance persistence, invalid theme rejection, theme export, and focus return when closing a modal.
- Local community/channel creation, emoji keyboard dismissal, and prevention of empty replies.
- Local brand/font loading and absence of uncaught page exceptions in that scenario.
- A 390 × 844 narrow layout with reduced-motion preference, channel navigation, and a page-overflow assertion.

The test named “desktop shell” checks the wide **browser layout**. It does not start Tauri or verify native window behavior. Browser integration tests run against the Vite development server; the separate production build and manual preview check provide different evidence.

### Real-instance acceptance

Use a dedicated development/test database, not a production connection string. After loading the [local toolchain](toolchain-local.md) or equivalent Rust/PostgreSQL tools, compile the server and run the REST harness:

```sh
cargo build --locked --manifest-path apps/server/Cargo.toml
npm run test:server
```

`scripts/verify-instance.mjs` needs `NUVEX_DATABASE_URL` and the compiled binary. It starts its own loopback server on port 3301 by default, uses uniquely prefixed synthetic data, and exercises restart/persistence through that process. It must not interrupt another server. Custom binary/port selection is available through `NUVEX_SERVER_BIN` and `NUVEX_VERIFY_PORT`. Read the actual report rather than treating script availability as a passed run.

The separate browser suite uses two real account sessions against the local server:

```sh
npm run test:instance
```

First run the migrated backend on `127.0.0.1:3001` with the exact allowed Vite origin, loopback development mode, and registration enabled as described in [self-hosting](self-hosting.md). The dedicated Playwright configuration starts/reuses the frontend and uses one worker. It creates synthetic accounts/communities/messages and is separate from the demo suite. The current source contains six scenarios: two-user messaging, delayed history/deletions, stale account workspace responses, pagination across resynchronization, retrying a failed reconnect reconciliation, and denying private WebSocket content after membership/session revocation. The earlier successful CI snapshots described below contained four (`4265617`) and five (`c0f8cda`) instance scenarios; the [new six-scenario pipeline](https://github.com/ImPaul17/nu.vex/actions/runs/39194668020) is still in progress at this update. Use `PLAYWRIGHT_CHANNEL=msedge` in PowerShell as above if selecting installed Edge. A successful REST run does not automatically prove this browser suite passed.

`NUVEX_E2E_REMOTE_URL` optionally selects an explicitly configured second API origin for the bearer-login browser scenario. The production web image permits same-origin connections by default. Remote origins require the explicit build-time `NUVEX_CONNECT_ORIGINS` allowlist and a matching backend allowed browser origin, as documented in [self-hosting](self-hosting.md#connecting-to-other-instances). Setting the test variable alone does not change the web CSP or server CORS policy.

### Actual Compose deployment in CI

The separate `compose` job in `.github/workflows/checks.yml` executes on an Ubuntu runner with Docker. It generates a disposable `nuvex-ci-*` deployment and independent random database secrets outside the checkout, validates Compose without printing expanded secrets, builds the production images, and waits for the database/migrator/API/Nginx stack. The [run for commit `4265617`](https://github.com/ImPaul17/nu.vex/actions/runs/39193292317) passed all four jobs with the earlier four-scenario browser suite. The later [run for `c0f8cda`](https://github.com/ImPaul17/nu.vex/actions/runs/39193801672) also passed all four jobs and includes the newer five-scenario suite, remote-origin checks, and real Nginx log checks described below. These hosted results are separate from the blocked local WSL attempt.

`scripts/verify-compose.mjs` targets only the explicitly named disposable deployment. It checks real API access and the generated production script CSP through Nginx, reuses REST/restart acceptance, checks the application's database role, and exercises the Docker backup/restore helpers into a new database with matching fingerprints of 8 tables and an unchanged source. It also checks exact CORS behavior and absence of synthetic invitation/ticket credentials in captured Nginx logs without printing those logs. Those additional assertions passed in `c0f8cda`; they are not attributed to the earlier `4265617` run. Cleanup is limited to the disposable CI project; do not run it against an operator's persistent instance.

The job sets `NUVEX_E2E_BASE_URL=http://127.0.0.1:8080` for `npm run test:instance`. With this variable, Playwright uses the existing deployment and does **not** start Vite. The ephemeral CI override also publishes the same Nginx on loopback port 8081, builds the web image with `NUVEX_CONNECT_ORIGINS=http://127.0.0.1:8081`, and sets `NUVEX_E2E_REMOTE_URL` to that origin. The `c0f8cda` Compose run passed all five browser scenarios in 17.9 seconds, including the real remote-origin bearer/WebSocket flow through the production image's controlled CSP. This is HTTP loopback verification on a disposable runner; external HTTPS and an operator's real proxy topology require separate deployment checks. See [current verification](verification-current.md) for subsequent receipts and the separate native workflow.

## Linux native runtime acceptance

The new `.github/workflows/desktop-runtime.yml` prepares a real Linux application
test, separate from both browser suites and the three-platform compilation job.
It pins Rust 1.99.1 and `tauri-driver` 2.1.0, installs WebKitWebDriver/Xvfb on the
disposable Ubuntu runner, and builds bundled frontend assets in the native debug
binary. It runs formatting, unit tests, and Clippy for both the transport crate
and Tauri adapter. Cargo's target directory is shared within that job to reuse
compilation; dependency installation and Rust builds use committed locks.

`scripts/verify-desktop.mjs` uses Node's built-in fetch to drive real WebDriver
HTTP commands, without WDIO or mocked invoke calls. It starts only owned API
processes on ports 3001/3002 and connects them to two distinct migrated test
databases. The native application registers/joins through its actual UI and
exchanges events with an independent originless-bearer HTTP/WebSocket account.
The flow checks process restart/history, logout/relogin, application restart
without persisted credentials, instance isolation, blocked direct webview fetch,
and real IPC route/generation/window-permission/token-response boundaries. Direct
fetch uses no-cors and omitted credentials and must produce both rejection and a
`securitypolicyviolation` event for `connect-src` and the requested destination;
Node checks the same endpoint before/after. This distinguishes the expected CSP
denial from a CORS-only failure. Native appearance's **Ver JSON** opens a
read-only theme document validated with the existing shared parser, without
credentials or a download. The integrated flow currently reports eight groups.

The workflow supplies `NUVEX_DESKTOP_DATABASE_URL` and
`NUVEX_DESKTOP_SECOND_DATABASE_URL` for dedicated loopback PostgreSQL databases.
The script refuses missing/equal database configurations or occupied test ports.
Optional `NUVEX_SERVER_BIN`, `NUVEX_DESKTOP_BIN`, and `NUVEX_TAURI_DRIVER_BIN`
select already compiled/installed binaries. `NUVEX_DESKTOP_API_PORT` and
`NUVEX_DESKTOP_DRIVER_PORT` change the two respective consecutive port pairs.
It never installs native host prerequisites or runs against a production database
implicitly. Synthetic test records remain; cleanup terminates only processes
the harness started. Logs/results stay under ignored `.cache/verify-desktop/`.
CI uploads only the redacted result summary and a bounded PNG of the synthetic
workspace, skipping screenshots with credential/invitation forms or dialogs.
It does not upload process logs, database configuration, or native binaries.

After preparing the explicit test databases, binaries, native driver, and display
dependencies, the Linux invocation is:

```sh
xvfb-run -a --server-args='-screen 0 1600x1200x24' node scripts/verify-desktop.mjs
```

At this update the script/workflow are implementation awaiting execution, not a
successful native runtime result. Linux debug acceptance does not verify release
HTTPS configuration, Windows/macOS runtime, installers, signing, or updates.
See the [native transport ADR](adr/0001-native-instance-transport.md),
[official manual driver setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/),
and [official CI guide](https://v2.tauri.app/develop/tests/webdriver/ci/).

## Manual interface review

Use both keyboard and pointer navigation. Check long content, empty states, readable contrast, focus indicators, modal dismissal/focus return, reduced motion, supported themes, valid and invalid imports, and narrow/wide layouts. Exercise screen-reader labeling where a screen reader is available. Imported palettes can be syntactically safe and still have poor contrast.

The automated suite is not a complete accessibility audit or a browser compatibility matrix. Record the browser, viewport, operating system, and scenarios actually checked. Future media and notification features need device and permission testing rather than only DOM assertions.

## Native, server, and deployment checks

Run the infrastructure helpers' boundary tests without Docker:

```sh
node --test infra/infra.test.mjs
```

They cover safe restore target names, archive metadata/hash verification, and script-CSP generation. They do not execute a database or a real dump/restore. See [self-hosting](self-hosting.md) for commands that require an actual Docker environment.

With the required Rust toolchain installed, backend source checks are independent of the frontend:

```sh
cargo check --locked --manifest-path apps/server/Cargo.toml
cargo test --locked --manifest-path apps/server/Cargo.toml
```

Database integration tests require a separately configured migrated PostgreSQL test database. Use the [server setup](../apps/server/README.md) and report the exact environment and scenarios executed; a compile or pure unit test is not evidence of multiuser persistence.

The Windows helper `./scripts/dev-tools/verify-backup.ps1` tests native PostgreSQL dump/restore into a new database and checks fingerprints while preserving the source. Follow its documented prerequisites and coordinate a write-free comparison window. This native test is distinct from the Docker-based `infra/backup-db.mjs`/`restore-db.mjs` helpers and must not be reported as Compose verification.

Tauri has a separate [native prerequisite and build workflow](desktop.md). A web build or browser test does not verify Rust compilation, installers, signing, or macOS/Linux behavior. Docker execution likewise needs the actual container toolchain.

The messaging milestone must satisfy PostgreSQL migration/integration tests, authentication and authorization tests, reconnect/idempotency tests, and the [two-user restart and recovery acceptance scenario](roadmap.md). A production self-hosting release also needs an executed Compose deployment and backup/restore test. Report missing prerequisites explicitly rather than listing those checks as passed; update [release readiness](release-readiness.md) with actual evidence.
