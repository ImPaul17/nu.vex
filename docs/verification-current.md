# Current verification — 19 October 2026

The native instance milestone was merged through [PR #1](https://github.com/ImPaul17/nu.vex/pull/1). All eight PR checks passed at `20851383239a6f6ab1bbfd9e4e8bf463a4275130`. The merge commit `cb28e762b5f8e876031f15091cf075b281a079ef` was compared against that commit with `git diff --exit-code`; the complete tracked snapshot was identical. Documentation-only follow-ups do not alter the verified program source.

## Executed hosted receipts

| Workflow | Source commit | Executed result |
| --- | --- | --- |
| [Main messaging checks, run 39197655165](https://github.com/ImPaul17/nu.vex/actions/runs/39197655165) | `cb28e76` | All 4 jobs passed: Windows/Linux web checks, Rust/PostgreSQL instance, and Compose |
| [Main desktop release compilation, run 39197655141](https://github.com/ImPaul17/nu.vex/actions/runs/39197655141) | `cb28e76` | Windows x64/MSVC, Linux x64/GNU, and macOS ARM64 passed |
| [Main Linux native runtime, run 39197655082](https://github.com/ImPaul17/nu.vex/actions/runs/39197655082) | `cb28e76` | 10 transport tests and all 8 integrated native acceptance groups passed |

All eight main-branch checks passed. The preceding PR runs also passed: [messaging](https://github.com/ImPaul17/nu.vex/actions/runs/39197074771), [three-platform compilation](https://github.com/ImPaul17/nu.vex/actions/runs/39197074767), and [native runtime](https://github.com/ImPaul17/nu.vex/actions/runs/39197074775). These receipts concern actual execution, not merely configured workflow files.

## Web, service, and database

- Strict Svelte/TypeScript checks passed with 0 errors and 0 warnings. The static production build, 12 core tests, and 7 infrastructure tests passed on Windows and Linux.
- All 5 demo scenarios passed in hosted Chromium. Local Edge also passed the 5 scenarios serially, including responsive layout, fonts/branding, themes, keyboard focus, and plain-text rendering.
- The backend passed 18 Rust tests, formatting, Clippy with warnings denied, and its locked build.
- All 14 real REST/WebSocket/restart acceptance groups passed against PostgreSQL, directly and through Nginx/Compose.
- The 6-scenario real-instance browser suite passed against the direct backend and through the built Nginx deployment. On main, hosted Chromium completed in 32.3 seconds directly and 20.0 seconds through Nginx; local Edge passed in 30.3 seconds against the updated native Windows backend.

The browser scenarios cover separate real accounts, bidirectional messaging, persistent history, deletion, login/logout, a remote bearer session that never enters browser storage, and reconnection. Regressions cover delayed history after deletion, stale private responses after account switching, pagination across resync, failed reconnect recovery, and actual WebSocket frames after membership/session revocation. A later authorized control frame demonstrates that preceding unauthorized messages were skipped on the same connection.

Native bearer acceptance additionally checks explicit JSON login/registration without Origin or Cookie, absent Set-Cookie responses, rejected empty/null/duplicate/foreign Origins, incompatible WebSocket ticket audiences, one-use tickets, limits, current membership, and logout revocation of sockets and pending tickets.

The Compose job built the pinned production images, started migrations/API/Nginx and PostgreSQL, checked readiness and restricted database privileges, and verified real restart persistence. A custom-format backup restored into a new database matched fingerprints for all 8 tables; the source remained unchanged. Its CSP/remote-origin scenario used a CI-only second loopback binding on port 8081, with actual cross-origin bearer and bidirectional WebSocket traffic. Synthetic invitation/ticket secrets were absent from actual proxy logs.

## Real native execution

The Linux acceptance launched the compiled **debug Tauri binary with bundled frontend assets**, using external tauri-driver/WebKitWebDriver under Xvfb. It did not run the UI in Vite or replace native IPC with a mock. Two distinct test databases backed two real instances on loopback ports 3001 and 3002.

All 8 acceptance groups passed:

1. Real UI connection, registration, invitation, and PostgreSQL-backed workspace.
2. Direct webview fetch rejected with an observed connect-src CSP violation while Node could reach the same API.
3. Native appearance exposes validated data-only JSON for manual copying, without credentials or filesystem/download permissions.
4. Native sends arrive at another authenticated account through a real WebSocket; committed replies reach the native UI.
5. Actual API process restart preserves history and native reconnection converges.
6. Logout, document reload, and native process restart clear local credentials. The document nonce rotates; a stale document's high-order connect is rejected, and normal login still works.
7. A second independently backed instance has isolated account/workspace state and no authentication data in browser storage.
8. Actual IPC rejects stale handles, unknown routes, and ungranted window commands; authentication DTOs omit bearer tokens.

The 10 pure transport tests also cover delayed authentication, old 401 responses, failed/successful logout, both stale-document selection orders, redirects, response bounds, and real HTTP header behavior. Formatting and Clippy passed for both the transport crate and Tauri adapter on Linux CI. The runtime uses direct connections with platform certificate validation; it does not implement system/environment HTTP proxy support.

## Native compilation and operational boundaries

Release binaries compiled with locked dependencies and --no-bundle for Windows `x86_64-pc-windows-msvc`, Linux `x86_64-unknown-linux-gnu`, and macOS `aarch64-apple-darwin`. Native UI/runtime acceptance currently covers Linux only. No installers, signing, updates, clean installation, or other architectures were validated or published as binaries.

Native release builds require HTTPS. The executed integrated native/container scenarios used explicitly configured HTTP loopback development servers; they do not verify public HTTPS operation, certificate renewal, or a corporate CA/proxy/identity provider. The original local WSL host still fails with Wsl/Service/CreateInstance/E_FAIL; no local Docker daemon started. Successful hosted Compose execution and native Windows PostgreSQL verification are separate environments.

Clearing a local in-memory credential during reload/disposal is not server-side session revocation. Explicit successful logout revokes the session; otherwise its configured seven-day expiry still applies. See [desktop behavior and prerequisites](desktop.md) and [the transport decision](adr/0001-native-instance-transport.md).

## Corrections and publication scope

The first native candidate `aff3a62` passed its 8 Linux runtime groups and 3-platform compilation. Its Compose regression found that rewriting Origin from an Nginx variable dropped an explicitly empty header. The proxy now forwards original headers, and the unchanged rejection test passed in the final Compose run. Independent source review and a deterministic reproduction also found a stale-connect race across document reload; the per-document nonce fix passed both Rust regressions and the actual native reload scenario.

An intermediate local parallel demo run had two load timeouts with module requests still pending. Subsequent serial Edge execution and hosted Chromium execution passed all 5 cases. An earlier phase's Docker health-command quoting and reconnect-helper corrections are historical and are not presented as successful intermediate runs.

Source is public in [ImPaul17/nu.vex](https://github.com/ImPaul17/nu.vex). Apache-2.0 was approved and applied; Geist retains SIL OFL 1.1, and upstream Tauri API notices accompany the client. GitHub CLI credentials use the system keyring and are excluded from Git. Private vulnerability reporting is enabled through [SECURITY.md](../SECURITY.md).

Voice/video, screen sharing, direct messages, uploads, notifications, OIDC/SSO, mobile/PWA delivery, and plugin execution remain future milestones. Member lists currently span joined communities and do not claim live presence. Functional acceptance does not constitute a security audit or stable production support.

The [published alpha.1 verification record](https://github.com/ImPaul17/nu.vex/blob/6c0d35900ac3b0a5f568eca8c4af40e8ab331dcd/docs/verification-current.md) and [initial frontend record](verification.md) remain historical references. See [release readiness](release-readiness.md) and [reproducible commands](testing.md) for current limits and setup.
