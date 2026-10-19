# Current verification — 19 October 2026

Windows native acceptance was merged through [PR #2](https://github.com/ImPaul17/nu.vex/pull/2). All six PR checks passed at `2ab127bfa5f60fc73e4327326cbf202ed6c5659c`. The merge commit `de858b61a5f550a3b2f1e5775245b8df2725b219` was compared against that commit with `git diff --exit-code`; the complete tracked snapshot was identical. Application sources and dependency lockfiles are unchanged from the published `v0.2.0-alpha.2`; this milestone adds runtime verification and safe test provisioning. Documentation-only follow-ups do not alter the verified program source.

## Executed hosted receipts

| Workflow | Source commit | Executed result |
| --- | --- | --- |
| [PR messaging checks, run 39199859761](https://github.com/ImPaul17/nu.vex/actions/runs/39199859761) | `2ab127b` | All 4 jobs passed: Windows/Linux web checks, Rust/PostgreSQL instance, and Compose |
| [Main desktop release compilation, run 39197655141](https://github.com/ImPaul17/nu.vex/actions/runs/39197655141) | `cb28e76` | Windows x64/MSVC, Linux x64/GNU, and macOS ARM64 passed |
| [PR Windows/Linux native runtime, run 39199859768](https://github.com/ImPaul17/nu.vex/actions/runs/39199859768) | `2ab127b` | Both native jobs passed: all 8 integrated groups and 2 configuration regressions on each OS; 10 transport tests, formatting, and Clippy on Linux |

The six current PR checks passed before integration; their tested snapshot matches the merge. Automatic main reruns are separate receipts. The unchanged application and dependency graphs retain the earlier three-platform release compilation result. The preceding native milestone also passed all eight main checks: [messaging](https://github.com/ImPaul17/nu.vex/actions/runs/39197655165), [three-platform compilation](https://github.com/ImPaul17/nu.vex/actions/runs/39197655141), and [Linux native runtime](https://github.com/ImPaul17/nu.vex/actions/runs/39197655082). These receipts concern actual execution, not merely configured workflow files.

## Web, service, and database

- Strict Svelte/TypeScript checks passed with 0 errors and 0 warnings. The static production build, 12 core tests, and 7 infrastructure tests passed on Windows and Linux.
- All 5 demo scenarios passed in hosted Chromium. Local Edge also passed the 5 scenarios serially, including responsive layout, fonts/branding, themes, keyboard focus, and plain-text rendering.
- The backend passed 18 Rust tests, formatting, Clippy with warnings denied, and its locked build.
- All 14 real REST/WebSocket/restart acceptance groups passed against PostgreSQL, directly and through Nginx/Compose.
- The 6-scenario real-instance browser suite passed against the direct backend and through the built Nginx deployment. In the current PR, hosted Chromium completed in 32.1 seconds directly and 19.1 seconds through Nginx; the earlier local Edge run passed in 30.3 seconds against the same backend program source.

The browser scenarios cover separate real accounts, bidirectional messaging, persistent history, deletion, login/logout, a remote bearer session that never enters browser storage, and reconnection. Regressions cover delayed history after deletion, stale private responses after account switching, pagination across resync, failed reconnect recovery, and actual WebSocket frames after membership/session revocation. A later authorized control frame demonstrates that preceding unauthorized messages were skipped on the same connection.

Native bearer acceptance additionally checks explicit JSON login/registration without Origin or Cookie, absent Set-Cookie responses, rejected empty/null/duplicate/foreign Origins, incompatible WebSocket ticket audiences, one-use tickets, limits, current membership, and logout revocation of sockets and pending tickets.

The Compose job built the pinned production images, started migrations/API/Nginx and PostgreSQL, checked readiness and restricted database privileges, and verified real restart persistence. A custom-format backup restored into a new database matched fingerprints for all 8 tables; the source remained unchanged. Its CSP/remote-origin scenario used a CI-only second loopback binding on port 8081, with actual cross-origin bearer and bidirectional WebSocket traffic. Synthetic invitation/ticket secrets were absent from actual proxy logs.

## Real native execution

Both Windows and Linux acceptance launched the compiled **debug Tauri binary with bundled frontend assets** through tauri-driver 2.1.0. Linux used WebKitWebDriver under Xvfb. Windows used the actual preinstalled WebView2 runtime 131.0.2903.86 and its matching Microsoft Edge WebDriver, with valid Microsoft signatures and exact file/CLI versions checked before use. No replacement runtime was installed. The harness checked the bundled `http://tauri.localhost` Windows origin and `tauri://localhost` Linux origin; it did not run the UI in Vite or replace native IPC with a mock.

Two distinct PostgreSQL 17.11 test databases backed two real instances on loopback ports 3001 and 3002. Windows acquired the EDB revision 5 portable archive with the reviewed repository SHA-256 pin, started a fresh SCRAM cluster on port 55433 with private ACLs and a non-admin application role, authenticated to both databases, and stopped that exact owned cluster after acceptance. The digest is an integrity pin, not a vendor signature. Linux used the isolated PostgreSQL service container. Only synthetic screenshots and redacted summaries were uploaded; raw logs and database credentials were excluded.

All 8 acceptance groups passed on each operating system:

1. Real UI connection, registration, invitation, and PostgreSQL-backed workspace.
2. Direct webview fetch rejected with an observed connect-src CSP violation while Node could reach the same API.
3. Native appearance exposes validated data-only JSON for manual copying, without credentials or filesystem/download permissions.
4. Native sends arrive at another authenticated account through a real WebSocket; committed replies reach the native UI.
5. Actual API process restart preserves history and native reconnection converges.
6. Logout, document reload, and native process restart clear local credentials. The document nonce rotates; a stale document's high-order connect is rejected, and normal login still works.
7. A second independently backed instance has isolated account/workspace state and no authentication data in browser storage.
8. Actual IPC rejects stale handles, unknown routes, and ungranted window commands; authentication DTOs omit bearer tokens.

The 10 pure transport tests also cover delayed authentication, old 401 responses, failed/successful logout, both stale-document selection orders, redirects, response bounds, and real HTTP header behavior. Formatting and Clippy passed for both the transport crate and Tauri adapter on Linux CI. Two subprocess regression tests passed on each host: malformed or identical database URLs fail before starting any binaries and do not expose credentials in diagnostics. The runtime uses direct connections with platform certificate validation; it does not implement system/environment HTTP proxy support.

## Native compilation and operational boundaries

Release binaries compiled with locked dependencies and --no-bundle for Windows `x86_64-pc-windows-msvc`, Linux `x86_64-unknown-linux-gnu`, and macOS `aarch64-apple-darwin`. Actual native UI/runtime acceptance now covers Windows and Linux debug builds. macOS interactive runtime remains unverified. No installers, signing, updates, clean installation, or other architectures were validated or published as binaries.

Native release builds require HTTPS. The executed integrated native/container scenarios used explicitly configured HTTP loopback development servers; they do not verify public HTTPS operation, certificate renewal, or a corporate CA/proxy/identity provider. The original local WSL host still fails with Wsl/Service/CreateInstance/E_FAIL; no local Docker daemon started. Successful hosted Compose execution and native Windows PostgreSQL verification are separate environments.

Clearing a local in-memory credential during reload/disposal is not server-side session revocation. Explicit successful logout revokes the session; otherwise its configured seven-day expiry still applies. See [desktop behavior and prerequisites](desktop.md) and [the transport decision](adr/0001-native-instance-transport.md).

## Corrections and publication scope

The first Windows CI attempt at `89e3b1b` stopped before launching the UI because the test helper assumed the wrong EdgeDriver CLI prefix. The official signed executable was inspected and run locally: it reports `Microsoft Edge WebDriver`, not the assumed label. Commit `2ab127b` corrected that check, added bounded diagnostics, and moved the preflight ahead of compilation; both native jobs then passed. The preliminary Windows failure was never counted as runtime acceptance. A separate local portable-PostgreSQL smoke test also caught and corrected detached Windows output-pipe handling and quoted `-D` parsing; startup, shutdown, and repeated shutdown passed without changing the existing development cluster.

The first native candidate `aff3a62` passed its 8 Linux runtime groups and 3-platform compilation. Its Compose regression found that rewriting Origin from an Nginx variable dropped an explicitly empty header. The proxy now forwards original headers, and the unchanged rejection test passed in the final Compose run. Independent source review and a deterministic reproduction also found a stale-connect race across document reload; the per-document nonce fix passed both Rust regressions and the actual native reload scenario.

An intermediate local parallel demo run had two load timeouts with module requests still pending. Subsequent serial Edge execution and hosted Chromium execution passed all 5 cases. An earlier phase's Docker health-command quoting and reconnect-helper corrections are historical and are not presented as successful intermediate runs.

Source is public in [ImPaul17/nu.vex](https://github.com/ImPaul17/nu.vex). Apache-2.0 was approved and applied; Geist retains SIL OFL 1.1, and upstream Tauri API notices accompany the client. GitHub CLI credentials use the system keyring and are excluded from Git. Private vulnerability reporting is enabled through [SECURITY.md](../SECURITY.md).

Voice/video, screen sharing, direct messages, uploads, notifications, OIDC/SSO, mobile/PWA delivery, and plugin execution remain future milestones. Member lists currently span joined communities and do not claim live presence. Functional acceptance does not constitute a security audit or stable production support.

The [published alpha.1 verification record](https://github.com/ImPaul17/nu.vex/blob/6c0d35900ac3b0a5f568eca8c4af40e8ab331dcd/docs/verification-current.md) and [initial frontend record](verification.md) remain historical references. See [release readiness](release-readiness.md) and [reproducible commands](testing.md) for current limits and setup.
