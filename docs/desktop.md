# Desktop shell

`apps/desktop` is an optional Tauri 2 host for the same SvelteKit application in
`apps/web`. It uses the operating system's title bar, resize controls, and webview.
The web application does not draw imitation window controls.

This milestone provides the desktop source, a locked Rust dependency graph, and
a restricted native instance transport under implementation. Earlier native
compilation passed on Windows, Linux, and macOS in the
[CI run for `6620201`](https://github.com/ImPaul17/nu.vex/actions/runs/39194068585).
The new transport's native runtime behavior remains **unverified**. The initial
`tauri info` inspection found WebView2 while Rust/Cargo and the Microsoft C++
build tools/SDK were unavailable. A repository-local Rust/GNU toolchain was
subsequently prepared for backend checks and desktop lockfile generation; it
does not supply the MSVC prerequisites for a supported Windows Tauri build.
There are no desktop installers or signed release artifacts yet.

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

The [run for commit `6620201`](https://github.com/ImPaul17/nu.vex/actions/runs/39194068585)
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

## Native instance connection milestone

The [accepted transport decision](adr/0001-native-instance-transport.md) selects a
Rust mediator for one chosen instance per local window. It exposes known API
operations and bounded event packets, stores bearer credentials only in native
memory, strips tokens from IPC authentication responses, and invalidates stale
connections on instance/account changes. It does not introduce keychain storage,
generic HTTP requests, or unrestricted OS integrations.

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

The new [Linux runtime workflow](../.github/workflows/desktop-runtime.yml) builds
the real debug application, runs transport/adapter formatting, unit tests and
Clippy, and launches `scripts/verify-desktop.mjs` through WebKitWebDriver,
`tauri-driver` 2.1.0, and Xvfb. Node uses the real WebDriver protocol without a
WDIO dependency or mocked IPC. Two isolated PostgreSQL databases and owned API
processes exercise native UI accounts, bidirectional events, restart/persistence,
logout, instance changes, storage boundaries, a no-cors fetch rejected with an
actual `connect-src` CSP violation, copyable theme JSON, and rejected IPC
operations. See [testing](testing.md#linux-native-runtime-acceptance).

This workflow definition and test source are not a passed native runtime run.
Runtime verification is pending, and Windows/macOS runtime, production HTTPS,
installers, signing, and updates remain separate from Linux debug acceptance.

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
