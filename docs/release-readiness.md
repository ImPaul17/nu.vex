# Release readiness

Working ledger, 19 October 2026. The objective is a maintainable open-source communication product with real accounts, independently operated instances, public collaboration, and verified distribution. The existence of source files does not complete that objective. [Current verification](verification-current.md) separates the latest frontend rerun, earlier native checks, and checks awaiting repetition; phase 0/1 results are preserved in [historical verification](verification.md).

| Area | Current state | Evidence required to complete the milestone |
| --- | --- | --- |
| Original identity and local typography | Integrated in the initial shell; source copies/font notices recorded | Preserve hashes/provenance through builds |
| Open-source license | **Approved: Apache-2.0**; official LICENSE and project NOTICE included | Keep package metadata and distribution notices consistent |
| Frontend shell and safe themes | Latest session/reconciliation changes passed type checks (0 errors/0 warnings), 12 core tests, 3 infrastructure tests, the static build, 4 real-instance and 5 demo browser tests in Edge | Maintain accessibility/platform checks and execute the production deployment/browser workflow |
| Real accounts and persistent messaging | Final native REST/restart run passed 11 groups; current browser run passed 4 tests including two users, real bearer login/reload behavior, and 3 race regressions | Verify hosted/Compose deployment and keep restart/recovery coverage current |
| Permissions and membership | Native REST acceptance passed owner-action denials, membership removal, blocked reads/writes, and session revocation | Keep live-subscription/reconnect revocation coverage and hosted deployment checks current |
| Self-hosting files | Dockerfiles, Compose, explicit migrator, proxy and operational helpers implemented; disposable Compose CI job prepared; local Docker attempt blocked before daemon start by WSL host failure | Actual image builds, Compose startup, recovery/browser acceptance, HTTPS and secrets checks on a working container host |
| Database recovery | Native PostgreSQL custom dump/new-database restore passed with matching fingerprints of 8 tables and unchanged source; infrastructure boundary tests also passed | Execute the container helpers and Compose recovery drill; verify restored instance behavior |
| Company deployments | Instance/domain configuration is the supported model | Deploy a company-owned instance with real local accounts and HTTPS |
| Enterprise identity | OIDC/SSO is planned separately | Protocol design, identity-provider integration, account linking/group mapping and security tests |
| GitHub collaboration/publication | Source commit `1b27096` pushed to the public [repository](https://github.com/ImPaul17/nu.vex); original README history preserved; private reporting enabled/verified; [first CI run](https://github.com/ImPaul17/nu.vex/actions/runs/39193181647) started | Resolve actual runner failures and record the final verified commit/results |
| Desktop distribution | Source scaffold; repository-local Rust/GNU backend toolchain works, while Tauri release toolchain remains separate | Actual Windows/macOS/Linux desktop builds, clean install/runtime checks, icons, signing and updates |
| Media and attachments | Planned | Real uploads, DMs, notification behavior, moderation, voice/video/screen-share/device tests |
| Extensions and APIs | Planned | Versioned bot API/SDK, isolated plugin capability model, compatibility and revocation tests |
| Mobile/PWA | Planned; responsive web shell is not a complete PWA/mobile app | Cache/security design and real platform-specific build/runtime checks |
| Federation | Explicitly deferred | Written identity/trust/moderation/synchronization protocol before implementation |
| Security support and stable release | Private [reporting route](../SECURITY.md) enabled and verified; pre-release without a security audit or production support claim | Supported-version/release policy, threat review and current dependency notices |

The native server's earlier verification also passed 14 Rust tests, formatting, Clippy, and a build. Those results and the 8-table native restore are retained as earlier evidence, rather than being represented as newly executed after each frontend change. No Docker daemon started during the blocked WSL attempt, and no Compose run or hosted CI result is recorded yet.

## Messaging MVP exit scenario

Use two independent browser sessions and two real instance accounts. Create/join a community through the implemented membership flow, exchange messages in both directions, reconnect a dropped client without duplicate persisted sends, restart the service, and verify history. Deny unauthorized reads/writes/subscriptions, including after membership removal. Restore the database into a new isolated instance and repeat the checks.

This scenario must use service-backed data; the explicit local demo cannot satisfy it. API tests, screenshots, a static build, and a successful `tauri info` each provide narrower evidence. None proves the whole product complete.

## Publication boundary

Apache-2.0 approval permits applying that license now. It does not imply that a GitHub remote exists, that authenticated access has been obtained, that a push happened, or that releases were published. Record the actual repository URL and CI results only after those actions succeed. Do not invent release downloads or label unverified native packages as available.
