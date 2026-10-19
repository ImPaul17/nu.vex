# Release readiness

Working ledger, 19 October 2026. nu.vex has a verified source alpha for real, self-hosted text messaging. The broader communication product remains under development. [Current verification](verification-current.md) records actual commands, runner receipts, and limits; the [initial frontend record](verification.md) is historical.

| Area | Verified now | Remaining work |
| --- | --- | --- |
| Identity and typography | Supplied assets integrated; original geometry/proportions preserved; local Geist with OFL notices | Maintain asset provenance and accessible visual review |
| Open-source license | Owner approved Apache-2.0; LICENSE, NOTICE, package metadata, and font notices included | Preserve notices in distributions |
| Web shell and themes | Strict types, 12 core tests, 7 infrastructure tests, static builds, and 5 demo browser scenarios passed | Broader browser/accessibility review and complete customization roadmap |
| Real accounts and text messaging | 18 Rust tests, 14 REST/WebSocket acceptance groups, and 6 real-instance browser scenarios passed on the merged PR source | Continue compatibility, load, and upgrade testing |
| Permissions and session revocation | REST denials and actual WebSocket frame isolation passed after membership removal and logout | Scoped rosters/live presence, moderation, and more granular roles |
| Self-hosting | Actual Docker images/Compose/readiness, Nginx browser delivery, configured remote CSP/CORS, and credential-log redaction passed | Public HTTPS deployment/certificate lifecycle and administrative operations review |
| Database recovery | Native and container custom-format restore into a new database passed; 8 table fingerprints matched and source remained unchanged | Production backup scheduling, retention, and operator recovery exercises |
| Corporate deployments | Instance-owned accounts, independent domains, and explicit remote frontend trust are supported | Deploy on the operator's real infrastructure; existing corporate identity requires separate OIDC/SSO |
| Public collaboration | Source pushed to [ImPaul17/nu.vex](https://github.com/ImPaul17/nu.vex), original README history preserved; private vulnerability reporting enabled | Contributor review, version/support policy, and ongoing maintenance |
| Native client | Restricted Rust instance transport; release compilation passed on Windows x64/MSVC, Linux x64/GNU, and macOS ARM64; 10 pure transport tests and 8 real Linux debug UI groups passed against two independent databases | Windows/macOS runtime, public HTTPS operations, corporate proxy/CA validation, persistent OS credentials, installers, signing, updates, and other architectures remain separate |
| Advanced communication | Planned and separated from implemented messaging | Direct messages, uploads, notifications, voice/video, screen sharing, and improved moderation |
| Open ecosystem | Theme data validation exists; executable extensions are not loaded | Capability-based plugin SDK, bot API, mobile/PWA, and advanced customization |
| Stable production support | Early alpha with a private reporting route and explicit limits | Security review, supported-version policy, HTTPS/operator validation, and upgrade compatibility |
| Federation | Explicitly deferred | Written identity, trust, moderation, and synchronization protocol before implementation |

## Acceptance and receipts

The text-messaging milestone demonstrated two real users joining one instance community and exchanging persistent messages. Reconnect and stale-response cases passed; process restart retained history and revoked sessions; unauthorized REST operations and live subscriptions were denied. Container backup restoration matched the source database.

For PR source `2085138`, [messaging/deployment CI](https://github.com/ImPaul17/nu.vex/actions/runs/39197074771) passed all four jobs, [native release compilation](https://github.com/ImPaul17/nu.vex/actions/runs/39197074767) passed all three platform jobs, and [Linux native UI acceptance](https://github.com/ImPaul17/nu.vex/actions/runs/39197074775) passed its job. These eight checks include 18 server tests, 14 REST/WebSocket groups, six real-instance browser scenarios both directly and through Compose, and eight real native UI groups with ten pure Rust transport tests. The source was merged into `main` as `cb28e76` with an identical file snapshot. All eight checks passed again on main; [current verification](verification-current.md) records the main-branch receipts.

The local WSL failure remains an environment limitation and was not repaired by the hosted tests. Successful Docker execution occurred on the disposable Linux runner. The deployment tests used explicit HTTP loopback development mode, not a public HTTPS domain.

## Publication boundary

The alpha is a source distribution for early testing and collaboration. Native account access has been exercised in the Linux debug application; that receipt does not establish Windows/macOS interactive behavior, a signed installer, public HTTPS operations, or stable production support. Release downloads and tags must be verified in the repository's [Releases](https://github.com/ImPaul17/nu.vex/releases) before describing them as published.
