# Messaging alpha verification — 19 October 2026

The messaging alpha has passed real service-backed verification. The release program source is the same as `6620201`; `2dced51` adds a security regression and its test configuration. A subsequent documentation-only commit records these results without changing application source. This verifies an early source release, not stable production support.

## Hosted receipts

| Executed workflow | Source commit | Result |
| --- | --- | --- |
| [Messaging checks, run 39194668020](https://github.com/ImPaul17/nu.vex/actions/runs/39194668020) | `2dced51` | All 4 jobs passed: Windows web checks, Linux web checks, Rust/PostgreSQL instance, and Compose |
| [Desktop compilation, run 39194068585](https://github.com/ImPaul17/nu.vex/actions/runs/39194068585) | `6620201` | All 3 native compilation jobs passed |

The application directories (`apps/web`, `apps/server`, `apps/desktop`, `packages`) were compared between these commits and are identical. Earlier complete runs at `4265617` and `c0f8cda` are additional receipts, rather than substitutes for the final messaging run.

## Web, service, and database

- Strict Svelte/TypeScript checks passed with 0 errors and 0 warnings.
- 12 core tests and 7 infrastructure tests passed; the static production web build passed on Windows and Linux.
- 5 demo scenarios passed in Chromium on Linux. Local Edge runs also checked the responsive shell, safe themes, font/brand loading, keyboard focus, and plain-text rendering.
- 14 Rust tests, formatting, Clippy with warnings denied, and the locked server build passed on Linux.
- All 11 REST/restart acceptance groups passed against real PostgreSQL, both natively and through the container stack.
- The real-instance Chromium suite passed 6/6 in 32.0 seconds against the native backend and 6/6 in 21.5 seconds through built Nginx/Docker.

The real-instance scenarios cover two real account sessions and bidirectional delivery, persistent history, login/logout, a memory-only remote bearer session, and reload behavior. Four regressions cover delayed history after deletion, stale responses after account switching, pagination across resync/reconnection, and recovery after an aborted reconnect bootstrap. A sixth security scenario inspects actual WebSocket frames: a message sent after membership revocation is absent before a later authorized control frame; logout then closes the stream without delivering later content. REST reads/writes are also denied after revocation.

The reconnect helper explicitly closes API sockets only. Closing Vite's HMR socket had invalidated an intermediate local scenario; the corrected helper and final CI passed. An earlier local registration retest timed out while a web build ran concurrently; the cause was not established. The first hosted instance setup failed before Rust execution because of health-command quoting; the corrected and final workflows passed. Local validated browser runs used installed Edge; the default Playwright Chromium needs its separate installation.

## Executed container deployment

The Compose job built the actual pinned images, started PostgreSQL plus explicit migrations, ran the Rust API and unprivileged Nginx, and passed readiness checks. The API database role had no superuser, create-role, or create-database privileges.

It verified restart persistence and a custom-format database backup restored into a new database. Fingerprints matched for all 8 tables and the source remained unchanged. The separate earlier native Windows PostgreSQL restore also matched all 8 tables.

The built CSP preserved hashed local bootstrap scripts and permitted only the configured API/WebSocket origins. A CI-only second loopback binding on Nginx port 8081 exercised real cross-origin bearer authentication and bidirectional WebSocket delivery from the frontend on port 8080. The destination allowed the exact frontend origin. Synthetic unissued invitation/ticket values were absent from actual Nginx access/error logs.

These runs used HTTP loopback with explicit development configuration. They do not verify a public HTTPS deployment, certificate renewal, or a company's identity provider. The original local WSL host still fails with `Wsl/Service/CreateInstance/E_FAIL`; no local Docker daemon started. The successful hosted Linux execution is a separate environment.

## Native compilation

| Runner host recorded in logs | Result |
| --- | --- |
| Windows `x86_64-pc-windows-msvc` | Optimized release executable built with Rust 1.99.1 |
| Linux `x86_64-unknown-linux-gnu` | Optimized release executable built with Rust 1.99.1 |
| macOS `aarch64-apple-darwin` | Optimized release executable built with Rust 1.99.1 |

The workflow used locked npm/Cargo dependencies and `--no-bundle`. No installers or signed binaries were published. Native account transport/CSP, interactive runtime behavior, other architectures, clean installation, signing, and updates remain unverified. See [desktop documentation](desktop.md).

## Publication and remaining scope

Source is public in [ImPaul17/nu.vex](https://github.com/ImPaul17/nu.vex). Apache-2.0 was approved by the owner and applied with project/third-party notices; Geist fonts retain SIL OFL 1.1. CLI authentication used the system keyring; credentials and local datasets are excluded from Git. Private vulnerability reporting is enabled and [SECURITY.md](../SECURITY.md) links the actual form.

Voice/video, screen sharing, direct messages, uploads, notifications, OIDC/SSO, mobile/PWA delivery, and plugin execution remain future milestones. Current member lists span joined communities and do not provide live presence. The explicit local demo is not service-backed data. Functional checks do not constitute a security audit or a stable production support commitment.

See [release readiness](release-readiness.md), [reproducible test commands](testing.md), and the separate [historical phase 0/1 verification](verification.md).
