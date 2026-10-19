# Native distribution notices

The Windows collector gathers review candidates from the actual Tauri release
build. It is a step toward packaging, separate from the existing
[frontend distribution inventory](../THIRD_PARTY_NOTICES.md). Hosted execution
of this new collector is pending; its configuration alone is not a passing
build or an installer release.

## Collection

The [workflow](../.github/workflows/native-notices.yml) uses Windows x64/MSVC,
Rust/Cargo 1.99.1, Node 22.14.0, npm 11.21.1 and the installed Tauri CLI 2.12.3.
On an equivalently prepared Windows development host, start from a clean
committed checkout, so the recorded revision identifies the inputs. The collector
checks that it remains clean through collection. Run:

```powershell
node --test scripts/native-build-evidence.test.mjs scripts/native-notice-files.test.mjs
node scripts/collect-native-notices.mjs
```

The collector requires the existing MSVC/Tauri prerequisites and a working
`tar`; it does not install native SDKs or additional collection dependencies.
It performs a real release build with `--no-bundle`, captures Cargo JSON and
resolves metadata with the same explicit Windows target and custom-protocol
feature. Metadata may download locked registry sources. The lockfile must not
change. Unknown sources, mismatched artifacts, incomplete build output and
missing selected dependency evidence fail collection.

The selected compilation inventory includes fresh artifacts, normal target
dependencies, build dependencies and proc-macro closures. A package can have
more than one role. Dev-only and other-platform metadata do not establish
release use. This inventory does not identify the exact code retained after
linking or every native component in the executable.

Registry notice candidates are read recursively, including legal directories
and declared license-file paths. Their exact bytes must match the `.crate`
archive whose SHA-256 is pinned by Cargo.lock. Where registry per-file checksum
metadata exists, it must also agree. Paths, links, UTF-8 and size limits are
checked; an invalid source is rejected rather than partially reported.

## Review artifact and privacy

Each run creates a new private `.cache/native-notices/<run-id>/` directory.
Raw Cargo output, metadata, build scripts' environment data and binaries remain
in its private scratch directory. The workflow uploads only the candidate JSON,
its readable README and notice texts, or a bounded failure summary. It does not
upload executables, installers or crate archives.

The structured candidate binds the actual checkout revision, toolchain,
configuration, lockfile, frontend inventory and executable digests. Package
records contain public identities, declared license expressions, observed
features/roles and relative notice paths/hashes. Raw Cargo IDs and absolute
source paths are excluded. Upstream notice texts retain their original content;
they are source material and should be read as text.

All records are explicitly **unreviewed**, including after a successful
collection. Nonstandard filenames, source-file exceptions and additional
vendor obligations still require review. The collector does not rewrite
license alternatives, select licenses or establish compatibility.

## Packaging gate

A later checked-in policy must record reviewed package identities, sources,
versions, applicable complete texts and hashes, rejecting unreviewed changes
before packaging. Combine those notices with the separately verified frontend
and font copies in a readable installed directory.

Windows payloads outside this crate-text collection include the Microsoft
WebView2 loader/SDK, applicable CRT components and selected NSIS components and
plugins. A preinstalled webview runtime does not remove the static loader's
notice requirements. These need their own exact provenance and payload review.
An installer must then be exercised on an isolated host and its installed
notice files verified. Signing, updates and publication retain their own gates.

See [release readiness](release-readiness.md) for the wider product scope and
[current verification](verification-current.md) for completed execution receipts.
