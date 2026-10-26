# Phase 0/1 verification — 19 October 2026

Historical record of the initial frontend milestone, before the subsequent server/account work and owner approval of Apache-2.0. These results apply to that milestone's code, not automatically to later changes. See [current verification](verification-current.md), [release readiness](release-readiness.md), and the [approved license](licensing.md).

Executed on Windows with Node 22.14.0. Dependency installation used npm 11.21.1 temporarily through `npx`; the globally installed npm 11.4.2 was not replaced.

| Check actually executed | Result |
| --- | --- |
| `npx --yes npm@11.21.1 ci` | Clean lockfile install succeeded |
| `npm run check` | Svelte diagnostics: 0 errors, 0 warnings; strict TypeScript check of core and test/config files succeeded |
| `npm test` | 12 unit tests passed |
| `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:e2e` | 5 browser integration tests passed using installed Edge |
| `npm run build` | Static production build succeeded; output `apps/web/build` |
| `npx --yes npm@11.21.1 audit --json` | 0 reported vulnerabilities at verification time |
| `npm exec --workspace @nuvex/desktop -- tauri info` | Exit 0; configuration and frontend paths recognized |
| Brand asset comparison | Five frontend copies match the supplied originals by SHA-256 |

Browser scenarios cover local send/reset/channel isolation, escaped hostile markup, search, local community/channel creation, empty replies, emoji dismissal, theme import/export and persistence, adaptive accent-button text, modal focus restoration, mobile focus containment/restoration, reduced motion, local font/brand loading, and page overflow. Desktop screenshots used 1440 × 940; mobile used 390 × 844. Screenshots and failure traces are generated under ignored `test-results/`.

The production output was also opened and inspected in the Codex in-app browser at `http://127.0.0.1:4173/`. `npm run preview` starts this loopback-only inspection server; it is not a production messaging deployment. A preview is useful only while its process is running.

## Issues resolved during verification

- An invalid component prop was replaced with Svelte's keyed-block syntax.
- Empty replies cannot send their quoted text alone; reply prefixes count toward the message length limit.
- Emoji and mobile channel navigation restore keyboard focus. Channel drawers contain focus while open; long names are truncated without losing their accessible name.
- Accent buttons choose black/white text by relative luminance, while keyboard focus uses a separate theme token.
- npm 11.4.2 lost the `cookie` override across a workspace link. The pinned manager and a targeted dependency update resolved `cookie@0.7.2`, removing the reported advisory. See [the environment record](environment.md).
- Playwright's matching default Chromium was not installed. The successful local run used existing Edge; CI is configured to install matching Chromium. The initial browser-launch failure was an environment issue and is not counted as a passed run.

The root Git repository was initialized on branch `main`. No commits, remote, push, or publication were created. Original PNG/SVG/PSD source assets remain in place.

## Not verified or not implemented

- Native Tauri compilation/execution and installers: Rust/Cargo/rustup and Windows MSVC/SDK prerequisites are unavailable in the inspected environment. WebView2 is present. The native configuration is a scaffold, with installer bundling disabled.
- macOS/Linux builds, mobile applications, and cross-browser compatibility beyond the actual browser checks above.
- GitHub Actions execution: the workflow exists but has not run on GitHub.
- Authentication, real users, server authorization, durable history, realtime delivery, uploads, calls, plugins, federation, and Docker/Compose execution. These belong to subsequent milestones.
- Full screen-reader or WCAG certification. The tests cover specific keyboard/contrast behaviors, not a complete accessibility audit.

The advisory result is time-dependent and does not constitute an application security audit. The project license was unapproved at the time of these checks; the owner subsequently selected Apache-2.0. See [testing](testing.md) to repeat checks against the current code and [the roadmap](roadmap.md) for acceptance criteria.
