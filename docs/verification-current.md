# Current verification — 19 October 2026

[PR #3](https://github.com/ImPaul17/nu.vex/pull/3) merged production-policy native HTTPS/WSS acceptance and complete reviewed frontend distribution notices. All **11 PR checks passed** at `7f9f459c12d98d9b0803fba40920ec3b32ce1b92`. The merge `683a87400b0ccda0441d2cef32943348601de159` was compared with that source using `git diff --exit-code`; the complete tracked snapshot was identical. Documentation-only follow-ups do not alter the tested program. This milestone changes the distributed frontend assets and build pipeline; the earlier published `v0.2.0-alpha.2` tag does not contain those changes. No installers have been published.

## Executed hosted receipts

| Workflow | Source commit | Executed result |
| --- | --- | --- |
| [PR messaging checks, run 39202625795](https://github.com/ImPaul17/nu.vex/actions/runs/39202625795) | `7f9f459` | All 4 jobs passed: Windows/Linux web and notice checks, Rust/PostgreSQL instance, and Compose |
| [PR native TLS, run 39202625770](https://github.com/ImPaul17/nu.vex/actions/runs/39202625770) | `7f9f459` | Both jobs passed: 14 real HTTPS/WSS/certificate/redirect cases on Windows and Linux; owned Windows CA import and removal verified |
| [PR desktop release compilation, run 39202625762](https://github.com/ImPaul17/nu.vex/actions/runs/39202625762) | `7f9f459` | Windows x64/MSVC, Linux x64/GNU, and macOS ARM64 passed |
| [PR Windows/Linux native runtime, run 39202625822](https://github.com/ImPaul17/nu.vex/actions/runs/39202625822) | `7f9f459` | Both native jobs passed: all 8 integrated groups and 2 configuration regressions on each OS; 10 transport tests, formatting, and Clippy on Linux |

The earlier Windows-runtime milestone passed all six PR checks at `2ab127b`; its merge `de858b6` had an identical complete tracked snapshot. Its [main messaging mirror](https://github.com/ImPaul17/nu.vex/actions/runs/39200591386) and [main Windows/Linux native mirror](https://github.com/ImPaul17/nu.vex/actions/runs/39200591416) also passed all six jobs. The preceding native milestone passed all eight main checks: [messaging](https://github.com/ImPaul17/nu.vex/actions/runs/39197655165), [three-platform compilation](https://github.com/ImPaul17/nu.vex/actions/runs/39197655141), and [Linux native runtime](https://github.com/ImPaul17/nu.vex/actions/runs/39197655082). These are source-specific execution receipts; an earlier green run does not establish completion of a later candidate's pending jobs.

The table cites completed PR executions. Automatic main-branch reruns are separate receipts; source equivalence was checked independently before recording the merge.

## Web, service, and database

- Strict Svelte/TypeScript checks passed with 0 errors and 0 warnings. The static production build, 12 core tests, and 7 infrastructure tests passed on Windows and Linux.
- All 5 demo scenarios passed in hosted Chromium. Local Edge also passed the 5 scenarios serially, including responsive layout, fonts/branding, themes, keyboard focus, and plain-text rendering.
- The backend passed 18 Rust tests, formatting, Clippy with warnings denied, and its locked build.
- All 14 real REST/WebSocket/restart acceptance groups passed against PostgreSQL, directly and through Nginx/Compose.
- The 6-scenario real-instance browser suite passed against the direct backend and through the built Nginx deployment. At `7f9f459`, hosted Chromium completed in 32.8 seconds directly and 20.3 seconds through Nginx; the earlier local Edge run passed in 30.3 seconds against the same backend program source.

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

## Production-policy native TLS

The [Linux job](https://github.com/ImPaul17/nu.vex/actions/runs/39202625770/job/117898640823) and [Windows job](https://github.com/ImPaul17/nu.vex/actions/runs/39202625770/job/117898640951) both completed all 14 cases against an actual PostgreSQL-backed API through private HTTPS/WSS endpoints. The real mediator was constructed with `Transport::new(false)` and the backend ran with `NUVEX_INSECURE_DEV=false`, with actual TLS and certificate verification enabled. This suite calls Rust directly; it does not launch a webview or exercise IPC. Both runs negotiated TLS 1.3; no separate TLS 1.2 compatibility claim is made.

The positive case registered a real account, created a community/channel, exchanged two persisted messages through two real WSS connections, reconnected and checked HTTPS history. Six negative cases rejected a foreign CA, an expired leaf, and a mismatched SAN separately for HTTPS and WSS. HTTPS negatives failed the handshake before any HTTP payload reached the proxy. Each WSS negative first obtained a valid HTTPS ticket, then failed its new TLS handshake before any upgrade reached the API. Six 307/308 cases rejected password, bearer and ticket redirects to HTTPS/WSS or HTTP/WS destinations with **zero destination TCP connections and zero destination requests**. Final authenticated logout also passed.

Linux scoped its generated CA to the test process and Rust children. Windows temporarily added exactly one owned public CA to `LocalMachine/Root` on the disposable GitHub-hosted administrator runner. This scope extends to processes/users on that VM. The helper refuses ordinary local/self-hosted hosts, records the exact store/run/fingerprints before addition, and verifies presence/hash after reopening the normal store. Its `always()` removal reopened the same store and verified absence; both import and cleanup passed. No local host certificate store, global registry policy or certificate-validation setting was changed. Only redacted counter summaries were uploaded; private keys, certificate fixtures and raw logs were excluded.

This is hermetic production-transport acceptance, separate from native UI execution and public-domain operation. It does not certify public DNS/ACME/renewal, an operator's reverse proxy, corporate CA/proxy/SSO configuration, macOS runtime or a signed distribution. See [the reproducible procedure](testing.md#production-policy-native-https-and-wss).

## Frontend distribution notices

Both hosted web jobs and the actual Compose image build passed all six notice-boundary tests and final distribution verification: five rendered packages, 18 JS/CSS assets and exact project/font/package license copies. The client inventory is generated from rendered Rollup modules and bound to final asset digests; it publishes no private build paths or application-source identifiers. Unknown rendered dependencies, changed metadata/text hashes, incomplete copies or altered output files fail the build. [Third-party notices](../THIRD_PARTY_NOTICES.md) records exact provenance and limits. This does not establish completion of the separate Rust/platform/installer notice audit.

## Native compilation and operational boundaries

Release binaries compiled with locked dependencies and --no-bundle for Windows `x86_64-pc-windows-msvc`, Linux `x86_64-unknown-linux-gnu`, and macOS `aarch64-apple-darwin`. Actual native UI/runtime acceptance now covers Windows and Linux debug builds. macOS interactive runtime remains unverified. No installers, signing, updates, clean installation, or other architectures were validated or published as binaries.

Native release builds require HTTPS. The integrated native UI/container scenarios used explicitly configured HTTP loopback development servers. The separate 14-case suite now verifies the actual production-policy transport over HTTPS/WSS on Windows and Linux; public HTTPS operation, certificate renewal and corporate CA/proxy/identity remain separate. The original local WSL host still fails with Wsl/Service/CreateInstance/E_FAIL; no local Docker daemon started. Successful hosted Compose execution and native Windows PostgreSQL verification are separate environments.

Clearing a local in-memory credential during reload/disposal is not server-side session revocation. Explicit successful logout revokes the session; otherwise its configured seven-day expiry still applies. See [desktop behavior and prerequisites](desktop.md) and [the transport decision](adr/0001-native-instance-transport.md).

## Corrections and publication scope

Preliminary TLS runs were not accepted as passing. The first Linux probe constructed its control client before the production transport installed Ring, causing a rustls-provider initialization panic. Reordering those test constructors fixed it without changing production crypto. The next probe exposed an unhandled `TLSSocket` `ECONNRESET`; a real local HTTPS/307/reset subprocess reproduction demonstrated the failure and verified the owned-socket error boundary and cleanup. That abort did not identify its exact case or produce a completed result. Both CurrentUser Root import approaches timed out on hosted Windows, including the no-UI API, and their owned-entry cleanup passed. The final disposable-VM LocalMachine approach passed addition, all 14 cases and removal. None of these preliminary failures was counted as TLS acceptance.

The first Windows CI attempt at `89e3b1b` stopped before launching the UI because the test helper assumed the wrong EdgeDriver CLI prefix. The official signed executable was inspected and run locally: it reports `Microsoft Edge WebDriver`, not the assumed label. Commit `2ab127b` corrected that check, added bounded diagnostics, and moved the preflight ahead of compilation; both native jobs then passed. The preliminary Windows failure was never counted as runtime acceptance. A separate local portable-PostgreSQL smoke test also caught and corrected detached Windows output-pipe handling and quoted `-D` parsing; startup, shutdown, and repeated shutdown passed without changing the existing development cluster.

The first native candidate `aff3a62` passed its 8 Linux runtime groups and 3-platform compilation. Its Compose regression found that rewriting Origin from an Nginx variable dropped an explicitly empty header. The proxy now forwards original headers, and the unchanged rejection test passed in the final Compose run. Independent source review and a deterministic reproduction also found a stale-connect race across document reload; the per-document nonce fix passed both Rust regressions and the actual native reload scenario.

An intermediate local parallel demo run had two load timeouts with module requests still pending. Subsequent serial Edge execution and hosted Chromium execution passed all 5 cases. An earlier phase's Docker health-command quoting and reconnect-helper corrections are historical and are not presented as successful intermediate runs.

Source is public in [ImPaul17/nu.vex](https://github.com/ImPaul17/nu.vex). Apache-2.0 was approved and applied; Geist retains SIL OFL 1.1, and exact reviewed frontend package notices accompany the client. GitHub CLI credentials use the system keyring and are excluded from Git. Private vulnerability reporting is enabled through [SECURITY.md](../SECURITY.md).

Voice/video, screen sharing, direct messages, uploads, notifications, OIDC/SSO, mobile/PWA delivery, and plugin execution remain future milestones. Member lists currently span joined communities and do not claim live presence. Functional acceptance does not constitute a security audit or stable production support.

The [published alpha.1 verification record](https://github.com/ImPaul17/nu.vex/blob/6c0d35900ac3b0a5f568eca8c4af40e8ab331dcd/docs/verification-current.md) and [initial frontend record](verification.md) remain historical references. See [release readiness](release-readiness.md) and [reproducible commands](testing.md) for current limits and setup.
