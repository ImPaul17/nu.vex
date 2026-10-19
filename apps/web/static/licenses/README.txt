nu.vex frontend notices

This directory is included unchanged in the static web client and the frontend
embedded by Tauri. The same web build is copied into the web container.

nuvex/LICENSE and nuvex/NOTICE contain the project's Apache-2.0 terms/notices.
The two bundled Geist font files have their separate OFL terms at
../fonts/LICENSE.txt (served at /fonts/LICENSE.txt).

frontend-packages.json records reviewed installed package versions, provenance,
and hashes of exact license-file copies in this directory. It can include
reviewed dependencies that the current client build removes as unused.

frontend-inventory.json is generated for each client build from Rollup's
rendered chunk modules and final JavaScript/CSS assets. It records the actual
package evidence and output hashes without publishing application source paths,
server module details, absolute filesystem paths, or timestamps. Injected Vite
preload helpers are attributed to Vite. Its complete installed LICENSE.md,
including Vite's own dependency notices, is retained without alteration.

This frontend inventory is not a complete audit of native Rust crates, platform
webviews, installers, operating-system libraries, or build-tool distributions.
