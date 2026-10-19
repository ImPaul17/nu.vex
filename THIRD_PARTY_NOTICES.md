# Third-party notices

This file records vendored fonts and distribution notices. nu.vex project code is licensed under [Apache-2.0](LICENSE), approved by the owner on 19 October 2026. Third-party material retains its own license. See [NOTICE](NOTICE) for attribution and the absence of a trademark grant.

## Geist and Geist Pixel

Source: the official [`geist` npm package, version 1.8.1](https://www.npmjs.com/package/geist/v/1.8.1), maintained in the [Vercel Geist font repository](https://github.com/vercel/geist-font).

Unmodified files extracted from that package:

| Package source | Distributed copy |
| --- | --- |
| `dist/fonts/geist-sans/Geist-Variable.woff2` | `apps/web/static/fonts/Geist-Variable.woff2` |
| `dist/fonts/geist-pixel/GeistPixel-Square.woff2` | `apps/web/static/fonts/GeistPixel-Square.woff2` |
| `LICENSE.txt` | `apps/web/static/fonts/LICENSE.txt` |

The package's copyright notice is:

> Copyright (c) 2023 Vercel, in collaboration with basement.studio

These fonts are licensed under the **SIL Open Font License, Version 1.1**. The complete license and copyright notice accompany the font files in [LICENSE.txt](apps/web/static/fonts/LICENSE.txt). The [upstream OFL text](https://github.com/vercel/geist-font/blob/main/OFL.txt) confirms the font project's OFL license; retain the actual package notice when redistributing this version.

The fonts are served locally. The `geist` framework integration is not installed as an application dependency, and the UI has no external font-service runtime dependency. See [branding and provenance](docs/branding.md) for file hashes and usage.

## Package dependencies

The native bridge imports the official `@tauri-apps/api` package, pinned to
2.12.4 in the npm lockfile. Its upstream license is `Apache-2.0 OR MIT`, with
copyright held by the Tauri Apps Contributors. Unmodified copies of its
[Apache license](apps/web/static/licenses/tauri-api/LICENSE-APACHE-2.0),
[MIT license and copyright notice](apps/web/static/licenses/tauri-api/LICENSE-MIT),
and [SPDX record](apps/web/static/licenses/tauri-api/LICENSE.spdx) accompany the
static client. The source is maintained in the
[official Tauri repository](https://github.com/tauri-apps/tauri/tree/dev/packages/api).

The npm dependency graph and Rust Cargo lockfiles record the dependency versions;
each dependency retains its own license and notices. These records do not
constitute a complete distribution license audit. Before distributing packaged
native binaries, review all shipped JavaScript/Rust dependencies and native
artifacts, preserve required notices, and update this file for additional
vendored material.
