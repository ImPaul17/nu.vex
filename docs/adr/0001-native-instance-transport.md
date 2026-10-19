# ADR 0001: Native instance connections through a restricted Rust transport

Status: accepted for the next native milestone; implementation and runtime verification are separate. Date: 19 October 2026. The previously published source alpha and its three-platform compilation receipts do not certify this new transport.

## Context and alternatives

The same original Svelte client must connect to independently operated instances from a bundled Tauri application. The webview currently loads local application code and has no reason to fetch executable code from an instance. Corporate SSO, persistent native credentials, and native plugins are separate features.

| Option | Benefit | Cost and trust boundary |
| --- | --- | --- |
| Permit all HTTPS/WSS connections in the webview CSP | Reuses browser fetch/WebSocket with less native code | Broadens data exfiltration paths; bearer credentials live in JavaScript; a browser origin policy still needs a real native authentication design |
| Build one client with an explicit instance-origin allowlist | Small, reviewable network policy for managed deployments | Each operator needs its own build; switching independently hosted instances requires rebuilding |
| Restrict the webview to IPC and mediate selected-instance requests in Rust | One downloadable client can select instances while tokens stay in native memory | Adds a privileged network component whose routing, caller checks, cancellation, and input limits must be tested |

We choose the restricted Rust mediator. This does not make compromised frontend code harmless: it could still request the operations granted to the current window and read data returned to it. Keep message rendering plain, theme imports inert, capabilities narrow, and remote navigation disabled.

## Decision

- One canonical selected origin and one opaque connection handle per authorized local window. Production/release builds require HTTPS; debug builds may opt into literal loopback HTTP for isolated development and CI. Credentials, paths, queries, fragments, redirects, and arbitrary URL schemes cannot turn an instance selector into a generic proxy.
- IPC accepts known API routes/methods and validated identifiers, bounded JSON bodies, and a bounded event channel. JavaScript cannot supply arbitrary headers or a destination URL for each request. Rust verifies TLS, disables redirects, bounds requests/responses/streams, and returns safe error DTOs.
- Bearer credentials stay in Rust memory and are removed from authentication responses before IPC delivery. They are not stored in browser storage, a keychain, files, exported themes, or logs. Process/document replacement, disposal, logout, and instance changes invalidate the applicable connection state. No persistent credential feature is delivered here.
- A monotonically ordered selection and session generation prevent stale requests, streams, and callbacks from replacing the new instance/account. Handles are identifiers, not bearer credentials. Cancel old work and recheck its generation before publishing results.
- The webview's network policy permits the IPC endpoints required by Tauri and local development tooling where applicable. It does not grant arbitrary `https:`/`wss:` networking. Scripts/fonts remain local; frames and form submissions remain blocked.
- Application commands are explicitly included in `AppManifest::commands`, granted only to the intended local `main` window, and checked again by the command handler. Do not grant remote capabilities, generic window creation, filesystem, shell, or general HTTP plugin access. Tauri documents that custom application commands are otherwise available by default across application windows; see [capabilities](https://v2.tauri.app/security/capabilities/). Follow the [CSP guidance](https://v2.tauri.app/security/csp/) and validate the actual application runtime.

The native API consists of `nuvex_connect`, `nuvex_request`, `nuvex_events`, `nuvex_events_control`, and `nuvex_dispose`. The event channel carries ordered bounded packets, not native socket objects or session secrets. Its acknowledgements provide a bound on queued messages. The pure Rust `apps/desktop/transport` crate owns network/state policy; `src-tauri` adapts it to the actual window and IPC system.

Clearing local memory on reload/disposal is not server-side revocation. The opaque server session can remain valid until its seven-day expiry; explicit successful logout revokes it. The current native client uses direct connections (`no_proxy`), so system/environment HTTP proxy support is not implemented. Corporate proxy/certificate policy and persistent OS credential storage require separate work.

## Server contract

Native requests do not copy or fabricate an `Origin` header. Cookie-authenticated browser mutations retain the exact-origin policy. Missing Origin is a distinct transport case: authenticated native mutations require a validated explicit bearer credential and no Cookie header. Native login/registration require JSON and explicit bearer transport; their responses do not set browser cookies. A present opaque, malformed, duplicate, or foreign Origin does not qualify as absent.

Realtime uses the existing short-lived single-use ticket flow. The server derives a ticket audience from the authenticated ticket request: browser-origin and originless-bearer tickets are not interchangeable. Native ticket issuance uses Bearer without Origin/Cookie; the native WebSocket handshake carries only its ticket, without Origin/Cookie/Authorization. The server still checks session validity, membership, connection limits, and revocation. No long-lived bearer is put into a WebSocket URL.

## Verification and consequences

The proposed Linux acceptance launches the compiled debug application through an external `tauri-driver` and WebKitWebDriver under Xvfb. It loads bundled frontend assets, uses real IPC and two independent PostgreSQL-backed instances, and has no mocked native transport. Node's built-in fetch drives the [WebDriver wire protocol](https://www.w3.org/TR/webdriver2/); the [official Tauri example](https://v2.tauri.app/develop/tests/webdriver/example/webdriverio/) supplies the `tauri:options.application` capability.

One integrated scenario covers real UI registration/membership, messages in both directions between native and independent HTTP/WebSocket accounts, restart/persistence, logout/relogin, process restart without saved credentials, second-instance isolation, rejected stale handles/routes/ungranted window IPC, and authentication responses without tokens. The direct-fetch check uses no-cors/omitted credentials and requires an actual `connect-src` CSP violation for the target, with Node confirming endpoint availability before/after. Appearance exports a read-only validated JSON view for manual copying while downloads remain blocked. Rust unit tests and Clippy cover the mediation boundary separately.

This workflow is newly implemented and runtime results remain pending until a real CI receipt exists. Windows/macOS retain their separate compilation checks. Direct external-driver automation is supported on Windows/Linux; see [manual setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/) and [CI prerequisites](https://v2.tauri.app/develop/tests/webdriver/ci/). macOS automation is possible through WebdriverIO's optional embedded driver, requiring a separately reviewed test-only plugin; it is not included in this milestone. A browser-only mock of invoke does not satisfy native runtime acceptance.

Keychain integration, certificate/client-proxy policy for enterprise deployments, other native architectures, installers/signing/updates, and external HTTPS operations require later decisions and checks.
