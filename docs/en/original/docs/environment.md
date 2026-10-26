# Initial repository and tool inventory

Observed on Windows during the phase 0/1 milestone, 19 October 2026. This is an inventory snapshot, not a cross-platform build certification. Paths specific to the developer's user profile are intentionally omitted.

## Starting workspace

The directory initially contained eight brand assets and no application code, package manifest, lockfile, or `.git` directory. Git was available as a command, but the folder was not initially an initialized repository. Original brand assets were preserved while an npm workspace was introduced. See [branding](branding.md) for asset identity, geometry, transparency, and font provenance.

The initial milestone subsequently initialized a local Git repository on `main`, before source commits or publication. Source was later published to [ImPaul17/nu.vex](https://github.com/ImPaul17/nu.vex); the initial inventory below remains a record of the starting environment.

| Tool | Observation | Consequence |
| --- | --- | --- |
| Node.js | `v22.14.0` | Frontend toolchain available |
| npm | Host command initially `11.4.2`; project manager subsequently pinned to `11.21.1` | Use the pinned manager for dependency installation and lockfile changes |
| Git | Command available; initial directory had no `.git` | No pre-existing tracked history to inspect |
| `rustc`, Cargo | Not found on the inspected `PATH` | Native Rust/Tauri compilation cannot be claimed from this inventory |
| Docker | Not found on the inspected `PATH` | Container builds and Compose execution require separate verification |

Not appearing on the initial `PATH` does not prove that software is absent from the entire machine. This initial assessment preceded the subsequent repository-local toolchain work. Rust/Cargo 1.99.1, rustup 1.29.1, a GNU Windows compiler, and PostgreSQL 17.11 were later prepared under ignored project-local paths. See [the local toolchain record](toolchain-local.md) for exact provenance, helpers, paths, and actual checks. No disassembler installation or global toolchain reassignment was required. Local WSL Docker execution remains blocked; a subsequent hosted Compose verification succeeded.

A later isolated Docker verification attempt acquired official Engine 29.9.1, Compose 5.6.0, and Buildx 0.38.0 binaries for WSL. The Ubuntu host then failed to start even `/bin/true` with `Wsl/Service/CreateInstance/E_FAIL` (error 6, step 2), including after one bounded recovery attempt. No Docker daemon started, and no `compose config`, image build, or stack startup ran in that local attempt. This is an external host/runtime blocker, not an observed image-build failure. The native Windows PostgreSQL verification is separate and remains valid.

The subsequent [hosted CI run for `4265617`](https://github.com/ImPaul17/nu.vex/actions/runs/39193292317) passed all four jobs, including actual container builds/startup, REST/restart acceptance, an 8-table new-database restore, and the then-current four-scenario browser suite through Nginx. The later [run for `c0f8cda`](https://github.com/ImPaul17/nu.vex/actions/runs/39193801672) passed all four jobs too, including five browser scenarios, controlled remote-origin CSP/bearer/WebSocket checks, and Nginx credential-redaction checks. This verifies a disposable HTTP loopback deployment, not an external HTTPS topology or a Tauri desktop runtime. See [current verification](verification-current.md) for subsequent receipts.

## Toolchain and dependency decisions

The root manifest supports Node `^22.14.0 || >=24.0.0` and npm `>=11.18.0 <12`, with `packageManager: npm@11.21.1`. Bootstrap from the root without a global package-manager update:

```sh
npx --yes npm@11.21.1 ci
```

The initial npm 11.4.2 installation did not correctly apply a root override through a workspace dependency. npm documents this problem in [issue #9659](https://github.com/npm/cli/issues/9659); its [v11 backport #9673](https://github.com/npm/cli/pull/9673) fixes propagation across linked packages and was included in the 11.18 release. Pinning 11.21.1 makes dependency resolution consistent locally and in CI. Ordinary script execution can continue through `npm run` after dependencies have been installed by the pinned manager.

The frontend pins **SvelteKit 2.70.3**, **Svelte 5.57.2**, and **Vite 7.3.7**. SvelteKit 3.0.0 was evaluated through registry metadata (`npm view @sveltejs/kit@3.0.0 engines --json`) and requires Node `>=22.17`, above the inspected host's 22.14.0. Keep the compatible Kit 2/Vite 7 combination for this milestone rather than changing the host runtime implicitly. Reassess the framework major version when the Node baseline is deliberately raised and the static/Tauri integrations can be reverified.

The root override pins transitive **`cookie` to 0.7.2**. [GHSA-pxg6-pf52-xh8x](https://github.com/advisories/GHSA-pxg6-pf52-xh8x) affects versions below 0.7.0; the selected override includes that fix. It was introduced for the initial static frontend dependency graph, independently of the later Rust service's session implementation. This override is dependency maintenance, not evidence that authentication has been verified.

Keep direct dependency versions and package-manager metadata pinned, commit lockfile changes with manifest changes, and use the pinned manager for installs and updates. On framework upgrades, review the override: remove it only when the upstream dependency graph resolves a patched compatible version without it, then run checks, tests, the production build, `npm ls cookie`, and the dependency advisory check with the pinned manager. Record actual results separately; do not preserve overrides indefinitely without review or treat a clean advisory report as an application security audit.

## Rea integration

The user explicitly requested inspection of the installed Rea integration. Its installed skill documentation was read and the connected MCP server's actual `binary_session` operation was called with an empty argument object to inspect the existing session. No target was opened or executed.

The response reported:

- Rea package/server version **6.4.0** and skill version **37**.
- A catalog of **170 MCP tools**, **127 CLI commands**, and **6 prompts**.
- No active analysis target.
- Ghidra: `not_configured`, with `GHIDRA_INSTALL_DIR` missing.
- Hopper: unsupported on the current `win32` host.
- IDA: not configured, with `REA_IDA_MCP_CONFIG` absent.

The advertised catalog includes target-free artifact/managed inspection and JavaScript/browser-related tools. Catalog presence is not proof that every analysis provider is configured or that every target can be analyzed. Browser/CDP operations require an explicit appropriate endpoint; no browser attachment or CDP readiness was established by the session inventory.

### Scope and limits

Rea is an optional development investigation tool, not a nu.vex runtime dependency, backend, build system, or UI framework. No invented Rea commands or private APIs are used by the project. No third-party application's binaries, source, private API, traffic, or runtime was inspected. The task did not require opening a disassembler or installing Ghidra.

Ordinary source inspection and implementation use normal repository tools. If later work needs shipped-artifact or runtime evidence, choose a tool that is actually advertised by the connected server, supply the authorized target, and check the provider requirements for that operation. Preserve the resulting evidence and limitations rather than treating a tool-count inventory as an analysis result.

## Verification boundary

The initial inventory alone did not establish successful application checks. Subsequent frontend/browser, native backend, REST/restart, and native database recovery results are recorded separately in [current verification](verification-current.md), with their timing and scope. Tauri distribution and container workflows retain their own verification boundaries. See [contribution and testing instructions](../CONTRIBUTING.md) and [desktop build limitations](desktop.md).
