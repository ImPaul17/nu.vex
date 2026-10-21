# Release readiness

Working ledger, 21 October 2026. nu.vex has a verified source alpha for real, self-hosted text messaging. The broader communication product remains under development. [Current verification](verification-current.md) records actual commands, runner receipts, and limits; the [initial frontend record](verification.md) is historical.

| Area | Verified now | Remaining work |
| --- | --- | --- |
| Identity and typography | Supplied assets integrated; original geometry/proportions preserved; local Geist with OFL notices | Maintain asset provenance and accessible visual review |
| Open-source license | Owner approved Apache-2.0; LICENSE, NOTICE, package metadata, and font notices included | Preserve notices in distributions |
| Frontend distribution notices | Exact project/font/package copies and client-only Rollup inventory; hosted build passed six boundary tests and final-copy/hash validation for five rendered packages and eighteen JS/CSS assets | Native Rust/platform/installer notices require separate review |
| Web shell and themes | Strict types, 12 core tests, 7 infrastructure tests, static builds, and 5 demo browser scenarios passed | Broader browser/accessibility review and complete customization roadmap |
| Real accounts and text messaging | 18 Rust tests, 14 REST/WebSocket acceptance groups, and 6 real-instance browser scenarios passed on the merged PR source | Continue compatibility, load, and upgrade testing |
| Permissions and session revocation | REST denials and actual WebSocket frame isolation passed after membership removal and logout | Scoped rosters/live presence, moderation, and more granular roles |
| Self-hosting | Actual Docker images/Compose/readiness, Nginx browser delivery, configured remote CSP/CORS, and credential-log redaction passed | Public HTTPS deployment/certificate lifecycle and administrative operations review |
| Database recovery | Native and container custom-format restore into a new database passed; 8 table fingerprints matched and source remained unchanged | Production backup scheduling, retention, and operator recovery exercises |
| Corporate deployments | Instance-owned accounts, independent domains, and explicit remote frontend trust are supported | Deploy on the operator's real infrastructure; existing corporate identity requires separate OIDC/SSO |
| Public collaboration | Source pushed to [ImPaul17/nu.vex](https://github.com/ImPaul17/nu.vex), original README history preserved; private vulnerability reporting enabled | Owner-maintained Alpha; no external code contributions are accepted. Keep access/protection settings verified; define version/support policy |
| Native client | Restricted Rust instance transport; release compilation passed on Windows x64/MSVC, Linux x64/GNU, and macOS ARM64; 8 real debug UI groups passed on both Windows and Linux against two independent databases; 10 pure transport tests passed on Linux; Alpha packaging is being verified for Windows NSIS/MSI, Linux DEB, and macOS ARM64 DMG bundles with hashes | macOS runtime, public HTTPS operations, corporate proxy/CA validation, persistent OS credentials, signing, notarization, updates, and other architectures remain separate |
| Native TLS | Fourteen real HTTPS/WSS cases passed on Windows and Linux with TLS 1.3, production transport policy and secure API mode; six certificate and six redirect negatives passed | Public-domain HTTPS/certificate lifecycle and corporate proxy/CA validation remain separate |
| Advanced communication | Planned and separated from implemented messaging | Direct messages, uploads, notifications, voice/video, screen sharing, and improved moderation |
| Open ecosystem | Theme data validation exists; executable extensions are not loaded | Capability-based plugin SDK, bot API, mobile/PWA, and advanced customization |
| Stable production support | Early alpha with a private reporting route and explicit limits | Security review, supported-version policy, HTTPS/operator validation, and upgrade compatibility |
| Federation | Explicitly deferred | Written identity, trust, moderation, and synchronization protocol before implementation |

## Acceptance and receipts

The text-messaging milestone demonstrated two real users joining one instance community and exchanging persistent messages. Reconnect and stale-response cases passed; process restart retained history and revoked sessions; unauthorized REST operations and live subscriptions were denied. Container backup restoration matched the source database.

For PR source `2085138`, [messaging/deployment CI](https://github.com/ImPaul17/nu.vex/actions/runs/39197074771) passed all four jobs, [native release compilation](https://github.com/ImPaul17/nu.vex/actions/runs/39197074767) passed all three platform jobs, and [Linux native UI acceptance](https://github.com/ImPaul17/nu.vex/actions/runs/39197074775) passed its job. These eight checks include 18 server tests, 14 REST/WebSocket groups, six real-instance browser scenarios both directly and through Compose, and eight real native UI groups with ten pure Rust transport tests. The source was merged into `main` as `cb28e76` with an identical file snapshot. All eight checks passed again on main; [current verification](verification-current.md) records the main-branch receipts.

The local WSL failure remains an environment limitation and was not repaired by the hosted tests. Successful Docker execution occurred on the disposable Linux runner. The deployment tests used explicit HTTP loopback development mode, not a public HTTPS domain.

For PR source `2ab127b`, [Windows and Linux runtime CI](https://github.com/ImPaul17/nu.vex/actions/runs/39199859768)
passed both jobs, with all eight real UI groups and two credential-safe
configuration regression cases on each platform. Windows used signed
WebView2/EdgeDriver 131.0.2903.86 and PostgreSQL 17.11 with two isolated,
restricted-role databases; its owned-cluster cleanup also passed. The separate
[messaging/deployment run](https://github.com/ImPaul17/nu.vex/actions/runs/39199859761)
passed all four jobs. Subsequent main-branch receipts are recorded in
[current verification](verification-current.md). Procedure and limits are in
[native testing](testing.md#windows-native-runtime-acceptance).

For PR #3 source `7f9f459c12d98d9b0803fba40920ec3b32ce1b92`, the
[native TLS run](https://github.com/ImPaul17/nu.vex/actions/runs/39202625770)
passed both Windows and Linux jobs, each with fourteen cases and TLS 1.3.
The positive flow used two actual WSS connections, reconnect, persistent history
and logout. Six certificate negatives and six 307/308 redirect checks passed;
redirect destinations received zero TCP connections or HTTP requests. Summaries
record production transport policy enabled, API insecure development mode off,
and no mocked TLS. The separate
[messaging/deployment run](https://github.com/ImPaul17/nu.vex/actions/runs/39202625795)
passed all four jobs, including the new frontend-distribution notice checks.
The same source's [Windows/Linux native runtime run](https://github.com/ImPaul17/nu.vex/actions/runs/39202625822)
passed both jobs, each with eight real UI groups and two configuration regression
tests. Linux also passed formatting, Clippy and ten pure Rust transport tests;
the separate TLS integration is ignored in that ordinary unit-test command.
The same source's [release compilation](https://github.com/ImPaul17/nu.vex/actions/runs/39202625762)
passed on Windows x64/MSVC, Linux x64/GNU and macOS ARM64. All eleven PR checks
passed across messaging/deployment, native UI, native TLS and release compilation.
The frontend changes affect the distributed assets/build and must not be
treated as an identical application snapshot of the earlier alpha; the current
receipts above establish this source's verification.
See [PR #3](https://github.com/ImPaul17/nu.vex/pull/3),
[TLS testing](testing.md#production-policy-native-https-and-wss), and
[third-party notices](../THIRD_PARTY_NOTICES.md). No complete native dependency
or installer-license audit is claimed by the frontend inventory.

Windows temporarily trusted one owned CA in the disposable hosted runner's
LocalMachine/Root store; import/hash and removal/absence checks passed. Linux
used a process-local CA. Setup, ownership guards and preliminary fixture
failures are recorded in [testing](testing.md#production-policy-native-https-and-wss).
These fixtures do not establish a corporate CA or public HTTPS deployment.

## Publication boundary

The alpha is an early testing and collaboration distribution. Native account
access has been exercised in Windows and Linux debug applications; those
receipts do not establish macOS interactive behavior, a signed installer,
public HTTPS operations, or stable production support. The first downloadable
release is prepared by the [desktop packaging workflow](desktop.md#alpha-release-packaging)
as a draft prerelease. Only a reviewed GitHub Release with its hashes and
manifest should be described as published.
