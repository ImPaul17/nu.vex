# Desktop shell

`apps/desktop` is an optional Tauri 2 host for the same SvelteKit application in
`apps/web`. It uses the operating system's title bar, resize controls, and webview.
The web application does not draw imitation window controls.

This milestone provides the source scaffold. Native compilation and runtime
behavior have **not** been verified. The initial `tauri info` check parsed the
configuration successfully and found WebView2 on Windows, but Rust, Cargo,
rustup, and the Microsoft C++ build tools/SDK were unavailable. There are no
desktop installers or signed release artifacts yet.

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
then opens `http://localhost:5173` in the native window. Keep that port available.
The Tauri hooks run in `apps/desktop`; `npm --prefix ../..` selects the repository
root explicitly. The root `dev` script must remain web-only to avoid recursion.

To compile a native binary once prerequisites are installed:

```sh
npm run desktop:build
```

The build hook runs the root web build and embeds `apps/web/build`. This follows
Tauri's [static SvelteKit integration](https://v2.tauri.app/start/frontend/sveltekit/).
The application has no embedded Node.js server and does not host the future Rust
communication server. Docker deployment is a separate server concern.

The JavaScript CLI and direct Rust dependencies are pinned. Generate and commit
`apps/desktop/src-tauri/Cargo.lock` on the first successful native build, then use
`cargo check --locked` from that directory to validate the resolved Rust graph.
Until that lockfile exists, native transitive dependency resolution is not pinned.

## Security boundary

The host registers no Rust application commands and includes no Tauri plugins.
Its one explicit capability grants no permissions. The global public Tauri API
is disabled. OS features such as filesystem access, shell execution, clipboard,
notifications, and automatic updates must be added individually with a concrete
permission model and tests.

The production CSP loads local scripts, fonts, and styles and blocks network
connections, frames, objects, and form submissions. Inline styles support the
design-token controls; arbitrary scripts remain blocked. The development CSP
additionally permits the local Vite websocket and development inline scripts.
Tauri's CSP nonce/hash injection remains enabled. See the official
[capability model](https://v2.tauri.app/security/capabilities/) and
[CSP guidance](https://v2.tauri.app/security/csp/).

The messaging MVP will need a reviewed CSP change for the user's selected HTTPS
instance and WSS endpoint. Do not solve that by granting unrestricted network
access or loading remote application code into a privileged webview. Native
capabilities must never be granted to community themes or plugins.

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
