# Contributing to nu.vex

The main nu.vex repository is currently maintained solely by its owner,
`ImPaul17`. External code contributions are not being accepted during this
Alpha. The public source is available for use, modification and independent
forks under [Apache-2.0](LICENSE); it does not grant write access to this
repository or permission to create branches in it. Unsolicited pull requests
may be closed without review. Security reports remain welcome through the
[private reporting route](SECURITY.md).

The instructions below document the owner's development workflow and help
people build their own forks. Documentation may be in English or Spanish.
The product name is always **nu.vex**; technical identifiers may use `nuvex`.

The [repository maintenance record](docs/repository-maintenance.md) documents
the current access policy and protected-main checks.

## Before changing code

Read the [architecture](docs/architecture.md) and [roadmap](docs/roadmap.md), identify the current phase, and keep the change reviewable. Describe important API, data, permission, or dependency changes before implementation. Keep original supplied assets and existing work intact.

The project is an original implementation. Do not contribute proprietary source, extracted private APIs, third-party trademarks, or assets without permission. Include the origin and license of new dependencies and assets. The project uses [Apache-2.0](LICENSE); keep applicable [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md). Do not introduce a separate contributor agreement without an explicit maintainer decision.

## Development

Use the Node/npm versions documented in the [README](README.md). From the repository root:

```sh
npx --yes npm@11.21.1 ci
npm run dev
```

Use the existing npm workspace layout and lockfile. Avoid adding a task runner, package manager, state library, or network service unless a demonstrated need justifies it. Do not commit `node_modules`, build output, `.env` secrets, credentials, or local IDE state.

Use npm 11.21.1 for dependency installation, updates, and lockfile changes, including CI. `npx --yes npm@11.21.1` selects it without updating global npm. The declared supported range is npm `>=11.18 <12`; older versions can lose root overrides across workspace links. Keep exact direct versions and the lockfile together. Review the [version and override policy](docs/environment.md) before changing SvelteKit, Vite, Node requirements, or the temporary `cookie` override.

Keep shared non-UI logic in `packages/core`, presentation tokens in `packages/tokens`, and reusable Svelte components in `apps/web/src/lib`. Place OS-specific integrations in `apps/desktop`. A component should receive typed data and emit an explicit action rather than opening an implicit backend or operating-system dependency.

## Checks and tests

Before submitting a change, run these commands from the root:

```sh
npm run check
npm test
npm run build
```

`check` validates Svelte and TypeScript; `test` executes the automated unit suite; `build` creates the static production frontend. Review the actual output and report failures, warnings, and missing prerequisites. A frontend build does not verify Tauri, Docker, server security, or cross-platform installers.

Run `npm run test:e2e` for frontend demo behavior changes after installing Chromium or selecting an existing supported browser. For service or real-account client changes, run `npm run test:server` against a dedicated migrated test database and `npm run test:instance` against the running test instance. These checks create synthetic data; keep production databases separate. See the [testing guide](docs/testing.md) for prerequisites, the Windows Edge option, current scenarios, and verification boundaries.

Test critical boundaries rather than reproducing component internals. Theme imports need invalid types, unexpected keys, excessive values, and malformed JSON coverage. Maintain backend coverage for authentication, authorization, transaction boundaries, reconnect behavior, and duplicate sends against a real test database with migrations. Keep native and container verification results separate; the hosted [CI run for `c0f8cda`](https://github.com/ImPaul17/nu.vex/actions/runs/39193801672) passed its deployment snapshot, rather than automatically certifying later changes or desktop runtime behavior.

For interface changes, manually verify:

1. Wide and narrow layouts, long channel names, and long messages.
2. Keyboard-only navigation, visible focus, modal dismissal, and focus return.
3. Screen-reader names for controls, readable contrast, and reduced-motion mode.
4. Community/channel switching, local message sending, search, and empty states.
5. Theme import failures, valid export/import, and a usable reset path.

The current unit suite is not a browser accessibility audit. Record which browser and viewport you actually checked. Add integration or end-to-end tooling when the behavior being delivered requires it.

## Pull requests

Explain the concrete problem, resulting behavior, and validation performed. Include screenshots when layout changes and document user-visible limits. Mark demo behavior explicitly; never describe local state as a functioning server feature.

Use strict TypeScript, validate inputs at trust boundaries, preserve accessible labels and focus behavior, and respect reduced-motion preferences. Update the relevant docs when behavior or prerequisites change. Commit dependency lockfile changes together with their manifest change.

Use the [security reporting instructions](SECURITY.md) for sensitive vulnerabilities rather than posting credentials or exploit details in a public issue.
