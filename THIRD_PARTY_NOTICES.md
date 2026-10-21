# Third-party notices

This file records vendored fonts and frontend distribution notices. nu.vex project code is licensed under [Apache-2.0](LICENSE), approved by the owner on 19 October 2026. Third-party material retains its own license. See [NOTICE](NOTICE) for attribution and the absence of a trademark grant. Exact project [LICENSE](apps/web/static/licenses/nuvex/LICENSE) and [NOTICE](apps/web/static/licenses/nuvex/NOTICE) copies also accompany the static/embedded frontend.

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

## JavaScript embedded in the frontend

Installed dependency categories do not determine which code is distributed.
Svelte and SvelteKit are development dependencies but their runtime code is in
the browser/native frontend. A build-only Vite hook inspects Rollup's actual
client `OutputChunk.modules`, including nonempty rendered modules and extracted
CSS, and attributes the injected Vite preload helper separately. It skips SSR
output. It emits `licenses/frontend-inventory.json` alongside the built client:
reviewed package versions, license paths, rendered-module counts, and final
JavaScript/CSS byte lengths and SHA-256 hashes. It publishes no application
source identifiers, absolute paths, timestamps, or server module details.

The current build reports five rendered packages and 18 JavaScript/CSS assets:

| Package | Installed version | License / exact retained text | Provenance |
| --- | --- | --- | --- |
| Svelte | 5.57.2 | MIT: [LICENSE.md](apps/web/static/licenses/svelte/LICENSE.md), copyright 2016–2025 Svelte Contributors | [Official npm version](https://www.npmjs.com/package/svelte/v/5.57.2), [upstream](https://github.com/sveltejs/svelte) |
| SvelteKit | 2.70.3 | MIT: [LICENSE](apps/web/static/licenses/sveltekit/LICENSE), copyright 2020 the upstream contributors | [Official npm version](https://www.npmjs.com/package/@sveltejs/kit/v/2.70.3), [upstream](https://github.com/sveltejs/kit) |
| esm-env | 1.2.2 | MIT: [LICENSE](apps/web/static/licenses/esm-env/LICENSE), copyright 2022 Benjamin McCann | [Official npm version](https://www.npmjs.com/package/esm-env/v/1.2.2), [upstream](https://github.com/benmccann/esm-env) |
| Vite preload helper | 7.3.7 | MIT: complete [LICENSE.md](apps/web/static/licenses/vite/LICENSE.md), including Vite's own bundled dependency notices | [Official npm version](https://www.npmjs.com/package/vite/v/7.3.7), [upstream](https://github.com/vitejs/vite) |
| Tauri JavaScript API | 2.12.4 | Apache-2.0 OR MIT; all three upstream files retained below | [Official npm version](https://www.npmjs.com/package/@tauri-apps/api/v/2.12.4) |

Two additional reviewed transitive dependencies have no positive rendered-module
length in this client build. Their exact installed notices are retained
conservatively: `clsx@2.1.1` ([MIT license](apps/web/static/licenses/clsx/license),
[upstream](https://github.com/lukeed/clsx)) and `devalue@5.9.4`
([MIT license](apps/web/static/licenses/devalue/LICENSE),
[upstream](https://github.com/sveltejs/devalue)). They are not counted as rendered
packages merely because they are installed. An exact package artifact's own
bundled notices, such as Vite's, are retained in full without claiming all of
those internal dependencies were themselves rendered into this application.

All copies were taken byte-for-byte from the installed packages recorded in
`package-lock.json`. [frontend-packages.json](apps/web/static/licenses/frontend-packages.json)
pins their versions, package license metadata, upstream URLs and license-file
hashes. Git preserves these files' bytes across platforms. The installed source,
reviewed hashes, static copies, and final distributed copies must agree. The
public [notice index](apps/web/static/licenses/README.txt), font license,
project notices, and package license files are copied into `apps/web/build` for
the web container and Tauri's embedded assets.

`npm run build` runs six boundary tests, creates the client inventory after
minification, then validates the final static-adapter output. The build rejects
new unreviewed rendered packages/helpers, unexpected package installations,
version/license/hash drift, missing notice copies, extra public inventory
fields, and changes to the distributed JS/CSS file set or digests. To check an
existing build directly, run `node scripts/check-frontend-notices.mjs`.

Intentional dependency updates require review of the installed license text,
metadata and any embedded upstream notices, followed by exact copy and policy
hash updates. The inventory is deterministic for a given bundle and policy; it
does not claim that every other part of the application build is reproducible.

## Tauri JavaScript API notices

The native bridge imports the official `@tauri-apps/api` package, pinned to
2.12.4 in the npm lockfile. Its upstream license is `Apache-2.0 OR MIT`, with
copyright held by the Tauri Apps Contributors. Unmodified copies of its
[Apache license](apps/web/static/licenses/tauri-api/LICENSE-APACHE-2.0),
[MIT license and copyright notice](apps/web/static/licenses/tauri-api/LICENSE-MIT),
and [SPDX record](apps/web/static/licenses/tauri-api/LICENSE.spdx) accompany the
static client. The source is maintained in the
[official Tauri repository](https://github.com/tauri-apps/tauri/tree/dev/packages/api).

The npm graph and Cargo lockfiles record dependency versions; each dependency
retains its own license and notices. Release packaging adds a readable
`notices/` resource with exact locked-crate texts, Rust toolchain copyright and
license files, project/frontend/font notices, and versioned Windows platform
texts. The [native collection procedure](docs/legal/native-distribution.md)
describes source checksums, upstream snapshots and file hashes. Each installer
is inspected to verify that this collection survives packaging.

The conservative all-target Cargo collection includes packages that may not be
linked. It is separate from a complete native payload inventory or compatibility
review. AppImage distribution is deferred pending review of its embedded runtime
and bundled Linux libraries. macOS runtime, signing/notarization, installer
updates, and further platform-specific distribution review remain separate work.
