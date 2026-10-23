nu.vex native notice candidates
==============================

STATUS: UNREVIEWED. NOT APPROVED FOR DISTRIBUTION.

A successful collection job verifies build/source evidence and gathers notice
candidates for maintainer review. It does not approve new dependencies, choose an
acceptable license, establish license compatibility, or make an installer ready
for publication. The project's approved Apache-2.0 license remains unchanged.

WHAT WAS CHECKED

The collector observes the actual Windows x64/MSVC Tauri release compilation,
including fresh and newly compiled Cargo artifacts. It matches those packages
with locked, platform-filtered Cargo metadata, records the build tools/command
and executable digest, and classifies target and host-build/proc-macro roles.
A package can have multiple roles. Dev-only metadata does not establish release
use. These are compilation observations, not the complete set of code retained
after linking or LTO; a host build dependency may also generate shipped code.

For registry packages, copied notice bytes are checked against the crate archive
whose SHA-256 matches Cargo.lock. Texts are preserved without normalization.
Recursive LICENSE/LICENCE/COPYING/COPYRIGHT/NOTICE/UNLICENSE filename discovery
and declared license-file paths identify candidates. This does not prove that
all applicable notices, file-header exceptions, nonstandard named files, or
source-availability obligations have been found. Declared license expressions
are upstream metadata, not reviewed license selections.

CONTENTS AND LIMITS

candidate.json indexes package identities, observed roles/features, declared
licenses, build/source digests, and every copied notice's relative path/hash.
All collected package records remain unreviewed. notices/ contains exact
project notices and selected upstream crate texts, including nested candidates.

The frontend inventory is referenced by digest for this build; its inventory
and complete frontend/font notice files are not copied into this artifact.
The Cargo package list must not be described as the frontend dependency graph.

No executable, installer, crate archive, raw Cargo metadata/diagnostics,
build-script environment output, source checkout, or private process log is
included. Those build intermediates remain outside the artifact. Original
upstream notice texts may contain addresses, URLs, or other upstream statements;
they are preserved source material, not sanitized application content or trusted
HTML. Read them as text rather than automatically executing/rendering them.

NEXT DISTRIBUTION GATES

1. Review each applicable license and notice requirement, including AND/OR
   expressions and nested vendor/file-header exceptions. Record explicit
   reviewed identities, sources, versions and text hashes. A future distribution
   gate must reject unreviewed changes; this candidate-gathering milestone does
   not implement that approval policy.
2. Combine the separately verified frontend/font notices with the reviewed
   native collection in a readable installed notice tree.
3. Review actual Windows payloads outside this Cargo candidate scope: Microsoft
   WebView2 loader/SDK notices, linked Microsoft CRT components, and selected
   NSIS stub/compressor/plugins plus the plugin's own dependencies. A
   preinstalled WebView2 Runtime does not eliminate the static loader's notice.
   Redistributing a runtime/bootstrapper would need its own payload review.
4. Bind the reviewed collection to the exact installer payload, install it on an
   isolated runner, and verify the local notice tree and hashes. No broader
   WebView CSP or IPC permissions are needed to provide installed notice files.
   Signing, updates and installer publication remain separate milestones.

A passing collection job does not complete the native distribution review.
Consult the repository verification record and the collection's source/build
digests for its exact revision and execution scope.
