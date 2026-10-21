# Native distribution notices

The release-only Tauri configuration includes generated `notices/` resources.
Development and compile-only configurations do not require this collection.
Generate it after fetching the complete committed desktop lockfile, without a
target filter:

```sh
cargo fetch --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
node scripts/native-notices.mjs --target x86_64-pc-windows-msvc --output apps/desktop/src-tauri/target/native-notices
```

Use the same pinned toolchain/CARGO_HOME as the subsequent build. The output
directory must be empty. Pass `--config src-tauri/tauri.release.conf.json` to
Tauri from `apps/desktop`. The `target/` output is generated, not source-controlled.
`--cargo-home`, `--rustc`, `--sysroot`, and `--rustc-version` allow an explicit
toolchain location; the last two are intended for reproducible fixtures or a
recorded toolchain, not invented version claims.

After extracting or installing an actual bundle, locate its `notices/inventory.json`
and verify that directory, including the exact complete file set:

```sh
node scripts/native-notices.mjs --verify /path/to/installed/notices
```

Missing, extra, altered or linked files fail verification. This checks copied
resource integrity; it does not add missing payload license analysis.

## What the collection establishes

The script retains a conservative union of every crates.io package in the
committed desktop Cargo.lock, including build and other-target packages.
It verifies each cached `.crate` SHA-256 against Cargo.lock, parses regular
tar members without extracting them, and compares copied text bytes with both
the authenticated archive and Cargo's extracted-source checksums when Cargo
records them (new caches may omit that file). Normalized
package identities and declared license expressions come from that archive.
Unknown sources, absent full texts, changed bytes, unsafe paths, links and
unsupported archive formats fail instead of silently dropping material.

All discovered complete LICENSE/LICENCE/COPYING/NOTICE/COPYRIGHT/UNLICENSE files,
license directories and declared license-file paths are preserved, including
ring's referenced nested texts. Upstream alternative licenses are retained
without changing their declared expressions. For tarballs that omit upstream
license files, `crate-supplements/policy.json` binds checked-in full texts to the
exact crate checksum and VCS commit where available. Any explicit license
selection must be an alternative actually offered by the authenticated manifest;
it is recorded separately from the unchanged upstream expression. Snapshots and
canonical license texts retain distinct source URLs. The project, static frontend
and font notices are copied together. Rust's installed `COPYRIGHT.html`,
`COPYRIGHT-library.html`, and complete `share/doc/rust/licenses/` tree accompany
them. The inventory records names, versions, checksums, relative notice paths
and output digests without publishing Cargo home or other absolute source paths.

Each crate record provides a direct HTTPS URL to the complete unmodified source
archive and its lockfile SHA-256, including for dependencies with source access
requirements. Users can obtain that exact source and check its digest.

The collection includes material conservatively; it is not proof that every
listed crate is linked. Filename discovery cannot establish all source-header
or vendor exceptions, and copying texts alone cannot establish compatibility or
fulfil every possible source-availability obligation. This is an engineering
notice collection, not a claim of complete distribution review.

## Windows source snapshots

`native-platform/sources.json` records the full Microsoft WebView2 SDK loader
text and versioned NSIS/nsis_tauri_utils texts, source URLs, sizes and SHA-256
values. They are unmodified snapshots from the earlier source investigation.
The collector verifies these bytes and includes them for Windows targets.
The WebView2 loader text covers SDK 1.0.3800.47 selected by webview2-com-sys
0.39.1; it is not a license for an independently downloaded or embedded runtime.

These snapshots do not inventory the actual NSIS plugin's compiled transitive
dependencies, Microsoft CRT, MSI/WiX payload, WebView2 bootstrapper/runtime or
future tool versions. Bind and review actual payload identities before claiming
those areas complete. Keep the NSIS COPYING file intact, including its different
compression terms and linking exception; its presence does not mean every named
compression module was selected.

## Linux AppImage and Debian packages: remaining payload gate

Cargo and Rust toolchain notices do not describe AppImage's ELF runtime or the
shared libraries copied by linuxdeploy/AppImage tooling. A release-specific
inspection must enumerate the actual AppDir, ELF dependencies and embedded
runtime, record their exact identities/hashes and distribution sources, retain
their complete notices and satisfy applicable source/relinking requirements.
Do not infer that all host packages ship, or that every dependency remains a
system prerequisite. Debian package dependencies also differ from libraries
actually copied inside an AppImage. This collector does not implement that
payload inventory and must not be presented as clearing this gate.

## Acceptance after bundling

Inspect each actual installer/image, install on an isolated runner, and verify
that the complete readable `notices/` tree and inventory digests survive
installation. Validate application functionality and bounded uninstall behavior
separately. Hash consistency and successful collection do not establish code
signing, native runtime support, legal approval or a complete binary audit.
