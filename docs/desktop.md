# Desktop shell

`apps/desktop` is an optional Tauri 2 host for the same SvelteKit application in
`apps/web`. It uses the operating system's title bar, resize controls, and webview.
The web application does not draw imitation window controls.

This milestone provides the desktop source, a locked Rust dependency graph, and
a restricted native instance transport. For PR #3 source `7f9f459`,
[release compilation passed on Windows, Linux, and macOS](https://github.com/ImPaul17/nu.vex/actions/runs/39202625762),
and [real Windows and Linux debug UI acceptance passed](https://github.com/ImPaul17/nu.vex/actions/runs/39202625822).
macOS interactive runtime and public HTTPS remain unverified. The repository now
also contains the reproducible Alpha packaging workflow, with the initial
downloadable release intentionally unsigned. The initial
`tauri info` inspection found WebView2 while Rust/Cargo and the Microsoft C++
build tools/SDK were unavailable. A repository-local Rust/GNU toolchain was
subsequently prepared for backend checks and desktop lockfile generation; it
does not supply the MSVC prerequisites for a supported Windows Tauri build.
The workflow creates a draft prerelease from an explicit `v0.2.0-alpha.N` tag.
It produces Windows x64 NSIS/MSI installers, Linux x64 AppImage/DEB packages,
and a macOS Apple Silicon DMG. Every upload includes `SHA256SUMS.txt`,
`RELEASE-MANIFEST.json`, `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`.
Signing, notarization, and updater metadata are separate gates.

## Development

First follow the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system. In addition to Node.js, this requires a Rust toolchain
and platform build tools. Windows requires the Microsoft C++ build tools and
WebView2; macOS requires Apple's build tools; Linux requires the documented GTK
and WebKit dependencies. The browser application can be developed independently
without these native dependencies.

From the repository root:

```sh
npx --yes npm@11.21.1 ci
npm run desktop:dev
```

Use the Node.js versions declared in the root `package.json`. To inspect the
native prerequisites and parsed Tauri configuration without compiling:

```sh
npm exec --workspace @nuvex/desktop -- tauri info
```

`tauri info` can exit successfully while reporting missing native prerequisites;
read its environment diagnostics before attempting a build.

The CLI starts the root `npm run dev` command, which serves only the web workspace,
then opens `http://127.0.0.1:5173` in the native window, matching the web development
listener. Keep that port available.
The Tauri hooks run in `apps/desktop`; `npm --prefix ../..` selects the repository
root explicitly. The root `dev` script must remain web-only to avoid recursion.

To compile a native binary once prerequisites are installed:

```sh
npm run desktop:build
```

The build hook runs the root web build and embeds `apps/web/build`. This follows
Tauri's [static SvelteKit integration](https://v2.tauri.app/start/frontend/sveltekit/).
The application has no embedded Node.js server and does not host the Rust
communication server. Docker deployment is a separate server concern.

The JavaScript CLI and direct Rust dependencies are pinned. The generated
`apps/desktop/src-tauri/Cargo.lock` fixes the native dependency graph across
platforms. Its initial version was generated with Cargo 1.99.1 and read through
`cargo metadata --locked --offline --no-deps`; this resolves metadata without
compiling the native application. Commit lockfile changes with intentional
dependency updates and use `--locked` for native builds.

## Native compilation CI

The separate [desktop compile workflow](../.github/workflows/desktop.yml) runs
on `windows-2022`, `ubuntu-24.04`, and `macos-15` hosted runners. It uses
Rust 1.99.1, explicitly selects the MSVC toolchain on Windows, installs Linux
WebKit/GTK build prerequisites, checks Apple's command-line tools, and records
the actual Rust host. Linux/macOS use the runner's native host without assuming
an architecture. Runner labels and architectures follow the
[GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The workflow installs npm dependencies with `npx --yes npm@11.21.1 ci` and invokes
the local pinned Tauri CLI from `apps/desktop`:

```sh
node ../../node_modules/@tauri-apps/cli/tauri.js build --ci --no-bundle -- --locked
```

The configured build hook first builds the static client. `--no-bundle` skips
installers, and `--locked` is forwarded to Cargo; see the
[official CLI reference](https://v2.tauri.app/reference/cli/#build). The workflow
has read-only repository permissions and no release or artifact-upload step.
It runs for relevant source/configuration changes and can be started manually.

The [run for commit `7f9f459`](https://github.com/ImPaul17/nu.vex/actions/runs/39202625762)
completed successfully in all three jobs. The logs record the actual hosts and
built release binaries:

| Runner | Rust host reported by the job | Built binary |
| --- | --- | --- |
| `windows-2022` | `x86_64-pc-windows-msvc` | `target/release/nuvex-desktop.exe` |
| `ubuntu-24.04` | `x86_64-unknown-linux-gnu` | `target/release/nuvex-desktop` |
| `macos-15` | `aarch64-apple-darwin` | `target/release/nuvex-desktop` |

Each used Rust 1.99.1 and Cargo's locked dependency graph. This verifies release
compilation for those hosts; it does not establish native window behavior,
account/instance connectivity, other CPU architectures, installers, signing,
or update support. The workflow did not upload or publish those binaries.
Runtime and distribution checks remain separate.

## Alpha release packaging

The [desktop release workflow](../.github/workflows/release.yml) runs only for
an explicit `v*` tag or a manual dispatch with an existing Alpha tag. It uses
the repository-pinned Node and Rust toolchains, generates platform icon
derivatives from the supplied `logo-app.png`, builds only the requested native
bundles, verifies the expected installer extensions, and records SHA-256
digests. The workflow then creates or updates a **draft prerelease** so the
artifacts can be inspected before publication.

For the first downloadable Alpha, create and push:

```sh
git tag v0.2.0-alpha.5
git push origin v0.2.0-alpha.5
```

The resulting release is unsigned. Windows SmartScreen and macOS Gatekeeper
may warn; users should verify `SHA256SUMS.txt` before installing. The desktop
client still requires a separately operated nu.vex instance and does not bundle
the server.

The Tauri configuration keeps the installer version at numeric `0.2.0` because
the Windows MSI metadata format rejects semver prerelease identifiers. The
Alpha identity is carried by the repository tag, package metadata, release
notes, and manifest.

## Native instance connection milestone

The [accepted transport decision](adr/0001-native-instance-transport.md) selects a
Rust mediator for one chosen instance per local window. It exposes known API
operations and bounded event packets, stores bearer credentials only in native
memory, strips tokens from IPC authentication responses, and invalidates stale
connections on instance/account changes. It does not introduce keychain storage,
generic HTTP requests, or unrestricted OS integrations.

The six custom commands are `nuvex_document`, `nuvex_connect`, `nuvex_request`,
`nuvex_events`, `nuvex_events_control`, and `nuvex_dispose`. The read-only document
handshake returns a Rust-owned UUID captured once by the loaded frontend module.
Reload/reset rotates that nonce. Connection selection validates the nonce and
selection order atomically, so queued work from an old document cannot displace
the current connection with a larger old order. Request/stream generations guard
later responses; handles and nonces are state identifiers rather than credentials.

Reload/disposal clears the local credential reference; it does not revoke the
server session. Explicit successful logout revokes that session, which otherwise
has its server-defined seven-day expiry. The current mediator uses direct
connections and does not honor system/environment HTTP proxies.

The current webview blocks downloads and `window.open`. Native appearance
therefore offers **Ver JSON**: a read-only, validated theme document you can copy
and save manually as a `.json` file. This uses no OS save/clipboard permissions;
the web client's **Exportar** download is unchanged. Platform certificate
validation is used, but corporate CA/proxy integration has not been verified.

The native webview loads local scripts/fonts/styles and permits only the IPC
network endpoints it needs. It cannot directly fetch arbitrary instance APIs.
Rust performs the actual REST/WebSocket connections with TLS verification and
redirects disabled. Release builds require HTTPS; debug builds allow loopback
HTTP for development/test instances. The native transport supplies no fabricated
Origin or browser cookie; its server contract uses explicit originless bearer
authentication and audience-bound short-lived realtime tickets.

Only the local main window receives the custom command permissions. Remote
navigation, frames, form submissions, arbitrary native commands, and general
filesystem/shell access remain restricted. Themes cannot acquire these grants.
The global public Tauri API remains disabled. Follow the official
[capability model](https://v2.tauri.app/security/capabilities/) and
[CSP guidance](https://v2.tauri.app/security/csp/); a native mediator still needs
caller validation and does not eliminate the impact of compromised UI code.

The Linux job in the [runtime workflow](../.github/workflows/desktop-runtime.yml) builds
the real debug application, runs transport/adapter formatting, unit tests and
Clippy, and launches `scripts/verify-desktop.mjs` through WebKitWebDriver,
`tauri-driver` 2.1.0, and Xvfb. Node uses the real WebDriver protocol without a
WDIO dependency or mocked IPC. Two isolated PostgreSQL databases and owned API
processes exercise native UI accounts, bidirectional events, restart/persistence,
logout, real document refresh with an old-nonce rejection followed by successful
UI login, instance changes, storage boundaries, a no-cors fetch rejected with an
actual `connect-src` CSP violation, copyable theme JSON, and rejected IPC
operations. See [testing](testing.md#linux-native-runtime-acceptance).

The [Linux runtime job for `7f9f459`](https://github.com/ImPaul17/nu.vex/actions/runs/39202625822/job/117898733280)
passed formatting, ten pure Rust transport tests, two configuration regression
tests, Clippy, native/server builds, and all eight integrated UI groups. This includes a real document refresh,
rotated nonce, rejected old-document selection, and subsequent successful UI
login. Windows debug acceptance has its own receipt below. macOS runtime,
public HTTPS deployment, installers, signing, and updates remain separate.
The dedicated TLS integration test remains ignored in the ordinary Rust test
command and has its own successful acceptance receipt below.

## Windows runtime CI

The same [runtime workflow](../.github/workflows/desktop-runtime.yml) defines
a separate `windows-2022` job using MSVC Rust 1.99.1, bundled debug assets, and
the real WebView2 application. The [Windows job for PR source `7f9f459`](https://github.com/ImPaul17/nu.vex/actions/runs/39202625822/job/117898732935)
passed both configuration regression tests and all eight real native UI groups.
The [same source's Linux job](https://github.com/ImPaul17/nu.vex/actions/runs/39202625822/job/117898733280)
also passed. These are bundled debug-runtime results, separate from release
compilation and the production-policy TLS fixture.

The job installs `tauri-driver` 2.1.0 into the disposable runner and uses
[`windows-webdriver.ps1`](../scripts/ci/windows-webdriver.ps1) to find an already
installed WebView2 runtime through Microsoft's registered runtime ID. It checks
the executable's Microsoft Authenticode signature and file version, downloads
the exact matching x64 EdgeDriver from Microsoft's versioned HTTPS endpoint,
rejects redirects, and extracts only the expected executable. Driver signature,
file version, and reported version must agree before it is used. It does not
install/update WebView2. The selected runtime folder and explicit driver path
are passed to the test process. This follows the
[Microsoft WebView2 driver requirements](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver)
and [Tauri's manual setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/).

[`windows-postgres.ps1`](../scripts/ci/windows-postgres.ps1) creates a fresh
PostgreSQL 17.11 cluster under its dedicated `RUNNER_TEMP` directory, binds only
`127.0.0.1:55433`, and provisions two databases with a restricted application
role. The EDB revision-5 archive is verified against the SHA-256 pin recorded in
that helper before extraction/execution. This is a project integrity pin for an
HTTPS acquisition, not an independent vendor signature. No Windows service is
installed and existing cluster directories are never replaced.

The helper generates separate administrative/application passwords, masks them
in CI, restricts its files to the runner identity, and removes the bootstrap
password file. Cleanup runs even after failure; it stops a recognized cluster
only after checking its manifest, PID data/port, exact executable and `-D`
argument, and the recorded control-binary hash. It never stops processes by
name or deletes another database. Private database/process logs remain outside
uploaded artifacts. The shared harness uploads only a redacted result summary
and an eligible screenshot of synthetic workspace data.

Both native jobs run `scripts/verify-desktop-config.test.mjs`. Its two regression
cases use synthetic passwords to ensure malformed or identical database URLs
fail before launching binaries without printing credentials. Both passed in the
linked Windows and Linux jobs. macOS runtime,
public HTTPS operations, installers, signing, and updates remain separate work.

## Production-policy TLS acceptance

The [native TLS workflow](../.github/workflows/native-tls.yml) and
[test instructions](testing.md#production-policy-native-https-and-wss) add
independent HTTPS/WSS acceptance for the actual Rust mediator on Windows/Linux.
For source `7f9f459c12d98d9b0803fba40920ec3b32ce1b92`, the
[Linux job](https://github.com/ImPaul17/nu.vex/actions/runs/39202625770/job/117898640823)
and [Windows job](https://github.com/ImPaul17/nu.vex/actions/runs/39202625770/job/117898640951)
both passed fourteen cases with TLS 1.3. It uses
`Transport::new(false)`, so the same HTTPS-only policy used by release builds is
tested without enabling debug HTTP or disabling certificate validation. The
backend also runs with `NUVEX_INSECURE_DEV=false`. It does not require a webview
or broaden the application's CSP or IPC permissions.

The fourteen-case fixture includes real authenticated HTTPS/WSS messaging and
reconnection, three password-bearing HTTPS certificate negatives, three WSS
certificate negatives after valid HTTPS ticket issuance, 307/308 password,
bearer and ticket redirect checks with zero destination TCP connections, and
final logout. Existing OpenSSL 3 creates a private test CA and genuine expired,
wrong-SAN and foreign-CA leaves; no host-clock change is used.

Linux supplies the fixture CA only to the test process. Earlier Windows
CurrentUser Root imports timed out after two minutes with both `X509Store.Add`
and a `NO_UI` API, without establishing TLS acceptance or directly observing a
consent dialog. The verified helper
temporarily trusts its owned synthetic CA in **LocalMachine/Root** only on an
administrator-verified, disposable GitHub-hosted Windows runner. This is a
broader temporary trust scope for that runner's processes; it does not authorize
local or self-hosted trust changes or modify policy/registry settings.

A version-2 marker records the exact store, CI run ID, thumbprint and SHA-256
before Add. Two-minute Add/Remove limits and postcondition checks bound the
operations, and always-run cleanup removes only that owned entry. The Windows
receipt passed both the reopened Add/hash check and Remove/absence check.
Results upload only a redacted summary, never
keys/certificates/private fixture files or logs.

The successful receipts follow preliminary fixture failures in Ring-provider
initialization, Node TLS socket error handling, and the Windows CurrentUser
imports. Those failed runs are not passing evidence; details are in the
[testing record](testing.md#production-policy-native-https-and-wss).
Public domains and certificate lifecycle, corporate proxy/CA behavior, macOS
runtime and signed distribution remain separate checks. The same source's
bundled Windows/Linux UI and three-platform release compilation also passed,
with their distinct receipts recorded above.

## Branding and distribution

`src-tauri/icons/icon.png` is an unchanged copy of the supplied `logo-app.png`.
`icon.ico` is a packaging derivative containing 16, 24, 32, 48, 64, 128, and 256 px
PNG frames, resized with nearest-neighbor sampling to preserve the source's pixel
geometry, colors, alpha, and proportions. The supplied source remains untouched.
The ICO also supplies the Windows executable resource required by Tauri's build
helper; it is not evidence that the native application has compiled.

Installer bundling is deliberately disabled (`bundle.active: false`). Before a
distribution milestone, validate the icon in actual native windows, prepare a
macOS `.icns` derivative and platform icon sizes from the same approved artwork,
review the provisional `org.nuvex.desktop` application identifier, choose installer
targets, and configure release signing and platform CI. Icon preparation follows
the [official Tauri icon format guidance](https://v2.tauri.app/develop/icons/).

The embedded frontend now carries exact project/font/package notices and a
build-derived client inventory. Its six boundary tests and final static-copy
verification run with every normal web/desktop build. See
[third-party notices](../THIRD_PARTY_NOTICES.md); this does not complete the
separate audit of Rust crates, platform runtimes or installer distributions.
For the same `7f9f459` source, the
[messaging/deployment run](https://github.com/ImPaul17/nu.vex/actions/runs/39202625795)
passed all four jobs, including six frontend-notice boundary tests and an
inventory of five rendered packages and eighteen JS/CSS assets.
