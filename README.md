# nu.vex

An independent communication platform being built for communities that want control over their own infrastructure. Original code and branding; no proprietary Discord code, private APIs, or assets.

**Estado actual / Current status:** early messaging alpha. The repository includes the branded client, a Rust/Axum/PostgreSQL service, migrations, a tested self-hosting stack, and a restricted native instance transport. Actual frontend/server/browser/container, native compilation, and Windows/Linux native UI results are recorded in [current verification](docs/verification-current.md). The desktop release workflow prepares unsigned Windows, Linux, and macOS Alpha installers from tagged commits; publication and remaining production/product work are tracked in [release readiness](docs/release-readiness.md).

## Desktop downloads

Download installers from [GitHub Releases](https://github.com/ImPaul17/nu.vex/releases).
Choose a release with attached Windows x64 `.exe`/`.msi`, Linux x64 `.deb`, or
macOS Apple Silicon `.dmg` assets. Older source-only Alpha releases do not have
installers. Verify `SHA256SUMS.txt` and read the release notes before installing.

The desktop Alpha connects to a separately hosted nu.vex instance. It does not
start a server automatically. See [self-hosting](docs/self-hosting.md) to run
your own instance. These early packages are unsigned; macOS Intel, AppImage,
code signing and automatic updates are separate planned work.

## Run locally

Use Node.js 22.14+ within the 22.x line, or Node.js 24+. Dependency installation requires npm `>=11.18 <12`; the project pins **npm 11.21.1**. From the repository root, this command uses the pinned manager without changing your globally installed npm:

```sh
npx --yes npm@11.21.1 ci
npm run dev
```

Open the local address printed by Vite. Real account mode requires a running nu.vex instance; local development proxies the API to `127.0.0.1:3001`. See [self-hosting](docs/self-hosting.md) and [server setup](apps/server/README.md). The explicitly selected local demo remains available to explore the design without a database.

The initial host's npm 11.4.2 can run the scripts after installation, but must not generate this workspace's dependency tree: older npm loses dependency overrides across workspace links. The [toolchain and dependency decision](docs/environment.md) records the fix, selected SvelteKit/Vite versions, and temporary `cookie` override.

```sh
npm run check
npm test
npm run build
```

The production web build is written to `apps/web/build`. Verification covers strict types, core/infrastructure tests, real accounts and permissions, browser delivery/reconnection, and container recovery. Browser integration uses `npm run test:e2e` for the demo and `npm run test:instance` for real accounts. See [testing instructions](docs/testing.md) for setup and [the verification record](docs/verification-current.md) for actual results, commits, and limits.

## Client and instance modes

- Displays community navigation, categorized channels, a conversation, a member list, and a user panel.
- Provides community/channel navigation, conversation search, a composer, and appearance controls with validated theme import/export.
- Connects account and community operations to a selected nu.vex instance; server-backed integration is part of the current verification milestone.
- Uses the supplied nu.vex branding, shared emerald/mint tokens, responsive layouts, and reduced-motion styles.

Demo users, presence, and message history are sample data only in the explicit demo. Its messages/communities/channels are ephemeral and do not synchronize between users. Real mode lists members visible through joined communities; live presence and a roster scoped to the selected community remain planned.

Real accounts belong to the selected independently operated instance. A company can host its own nu.vex server/domain. Existing corporate identity-provider login requires the separately planned OIDC/SSO integration; an arbitrary company website is not a nu.vex instance. The production web container defaults to same-origin API connections; a validated build-time allowlist can enable selected external API/WebSocket origins, with matching destination-server trust. See [connection configuration](docs/self-hosting.md#connecting-to-other-instances). Voice/video, uploads, plugins, and distribution readiness remain in the release ledger.

## Repository map

```text
apps/
  web/                  SvelteKit + Svelte 5 + strict TypeScript frontend
  desktop/              Tauri 2 host and restricted Rust instance transport
  server/               Rust/Axum service, PostgreSQL migrations, independent Cargo crate
packages/
  core/                 Shared models, demo data, theme validation
  tokens/               Shared CSS design tokens and theme foundations
docs/                   Architecture, milestones, deployment and license decisions
infra/                  Container builds, same-origin proxy, backup/restore helpers
tests/                  Browser integration tests
logo-*                  Original supplied brand assets and editable PSD sources
```

The root uses npm workspaces and a single JavaScript lockfile. The Rust applications have separate Cargo manifests/lockfiles. `compose.yaml` combines web, API, explicit migration startup, and a private persistent database. The [first complete CI run](https://github.com/ImPaul17/nu.vex/actions/runs/39193292317) verified the messaging stack, container recovery, and browser flows. Later changes need their own runner results.

## Desktop source

The Tauri host shares the web frontend. It requires Rust/Cargo and the native prerequisites for the target OS. On Windows these include the MSVC build tools and WebView2; Linux and macOS have their own prerequisites. Follow the [official Tauri prerequisite guide](https://v2.tauri.app/start/prerequisites/) before running:

```sh
npm run desktop:dev
```

The [restricted Rust instance transport](docs/adr/0001-native-instance-transport.md) keeps bearer credentials in native memory and mediates known API/event operations. At source `7f9f459`, [release compilation passed on Windows x64, Linux x64, and macOS ARM64](https://github.com/ImPaul17/nu.vex/actions/runs/39202625762), and [all eight native UI groups passed on Windows and Linux](https://github.com/ImPaul17/nu.vex/actions/runs/39202625822) against two real PostgreSQL-backed instances. A separate [production-policy TLS suite](https://github.com/ImPaul17/nu.vex/actions/runs/39202625770) passed fourteen HTTPS/WSS, certificate and redirect cases on each OS. Installers, signing, public-domain HTTPS operations and macOS interactive runtime remain separate work. The [local toolchain notes](docs/toolchain-local.md) describe the original host limitations.

The Windows runtime job verified matching signed WebView2/EdgeDriver binaries,
an isolated PostgreSQL cluster, and cleanup. See the [Windows test procedure](docs/desktop.md#windows-runtime-ci)
for setup and artifact boundaries.

Normal builds retain reviewed project/font/frontend-package notices and verify
the final client inventory. See [third-party notices](THIRD_PARTY_NOTICES.md)
for provenance and the remaining native-distribution review.

## Direction

The current messaging milestone demonstrates two real users on one instance exchanging persistent messages, with authorization, reconnect, restart, and recovery checks. Native packaging and Docker server deployment are separate workflows. Federation requires a future protocol design.

- [Architecture and decisions](docs/architecture.md)
- [Initial environment and Rea inspection](docs/environment.md)
- [Official branding and font provenance](docs/branding.md)
- [Desktop prerequisites, security, and build limitations](docs/desktop.md)
- [Milestones and acceptance criteria](docs/roadmap.md)
- [Current release-readiness ledger](docs/release-readiness.md)
- [Desktop packaging and Alpha release process](docs/desktop.md#alpha-release-packaging)
- [Current verification results and limits](docs/verification-current.md)
- [Self-hosting and recovery](docs/self-hosting.md)
- [Contributing and testing](CONTRIBUTING.md)
- [Test commands and browser setup](docs/testing.md)
- [Historical frontend verification](docs/verification.md)
- [Security reporting](SECURITY.md)
- [Apache-2.0 license and contribution policy](docs/licensing.md)
- [Third-party font notices](THIRD_PARTY_NOTICES.md)

## License

The upstream repository is maintained by `ImPaul17` and is not accepting
external code contributions during the Alpha. You can build, modify and
maintain independent forks under the license. See the [maintenance policy](CONTRIBUTING.md).

Licensed under [Apache-2.0](LICENSE), approved by the owner on 19 October 2026. Preserve [NOTICE](NOTICE) and applicable [third-party notices](THIRD_PARTY_NOTICES.md). Geist/Geist Pixel fonts retain SIL OFL 1.1. No trademark rights or official endorsement are granted to derivative projects.

## En español

nu.vex es un proyecto abierto y autoalojable bajo Apache-2.0. El hito actual integra cuentas reales y mensajería persistente con un servidor propio; el estado verificable y los pendientes están en el registro de preparación para publicación. Para iniciar el cliente ejecuta `npx --yes npm@11.21.1 ci` y `npm run dev`; las cuentas necesitan una instancia en marcha. La demostración local se elige expresamente y no sustituye las pruebas multiusuario. Durante la Alpha, `ImPaul17` mantiene el repositorio principal y no se aceptan contribuciones externas de código; la licencia permite crear y modificar forks independientes.
